import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  decodeTransfers,
  type TokenConfig,
  type ParsedTransaction,
} from "../../solana/src/decode.js";
import { validateConfigs } from "../../solana/src/watcher.js";
import type { SolanaRpc } from "../../solana/src/rpc.js";
import { assertEnabledAssets } from "../../solana/src/networks.js";
import { type NotificationScope } from "../../notifications/src/queue.js";
import { updateOperationalStatus, writeOperationalStatus } from "./status.js";
export type RecordedTransfer = {
  id: string;
  signature: string;
  instruction_path: string;
  slot: string;
  block_time: Date | string;
  mint: string;
  destination: string;
  amount: string;
};
export type ChainReader = {
  validate: (configs: TokenConfig[]) => Promise<void>;
  verify: (
    transfer: RecordedTransfer,
    configs: TokenConfig[],
  ) => Promise<"verified" | "mismatch" | "unavailable">;
};
export function chainReader(
  rpc: Pick<SolanaRpc, "call">,
  enabledAssets?: string,
): ChainReader {
  return {
    async validate(configs) {
      assertEnabledAssets(configs, enabledAssets);
      await validateConfigs(rpc, configs);
    },
    async verify(row, configs) {
      try {
        if (
          !configs.some(
            (c) => c.mint === row.mint && c.token_account === row.destination,
          )
        )
          return "unavailable";
        const tx = await rpc.call<ParsedTransaction | null>("getTransaction", [
          row.signature,
          {
            encoding: "jsonParsed",
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          },
        ]);
        if (!tx) return "unavailable";
        const transfer = decodeTransfers(tx, configs).find(
          (t) => t.path === row.instruction_path,
        );
        return transfer &&
          transfer.mint === row.mint &&
          transfer.destination === row.destination &&
          transfer.amount === BigInt(row.amount) &&
          BigInt(transfer.slot) === BigInt(row.slot) &&
          transfer.blockTime * 1000 === new Date(row.block_time).getTime()
          ? "verified"
          : "mismatch";
      } catch {
        return "unavailable";
      }
    },
  };
}
const checks = `
 SELECT 'paid_credit_missing' AS code,'invoice' AS entity_type,i.id::text AS entity_id FROM invoices i WHERE i.environment=$1 AND i.cluster=$2 AND i.status='paid' AND NOT EXISTS(SELECT 1 FROM ledger_entries l WHERE l.invoice_id=i.id AND l.entry_type='payment')
 UNION ALL SELECT 'ledger_mismatch','invoice',i.id::text FROM ledger_entries l JOIN invoices i ON i.id=l.invoice_id JOIN chain_transfers t ON t.id=l.transfer_id LEFT JOIN payment_attempts a ON a.id=t.attempt_id WHERE i.environment=$1 AND i.cluster=$2 AND (i.status<>'paid' OR l.amount<>i.payable_units OR l.asset<>i.asset OR t.invoice_id IS DISTINCT FROM i.id OR t.environment<>i.environment OR t.cluster<>i.cluster OR t.disposition<>'paid' OR t.amount<>l.amount OR t.mint<>i.mint OR a.id IS NULL OR a.invoice_id<>i.id OR a.environment<>i.environment OR a.cluster<>i.cluster OR a.asset<>l.asset OR a.mint<>t.mint OR a.recipient<>i.recipient OR a.payable_units<>l.amount OR NOT a.payment_enabled OR a.activated_at IS NULL OR t.block_time<a.activated_at-interval '1 second' OR t.block_time>a.expires_at)
 UNION ALL SELECT 'paid_transfer_scope_invalid','transfer',t.id::text FROM chain_transfers t LEFT JOIN invoices i ON i.id=t.invoice_id WHERE t.environment=$1 AND t.cluster=$2 AND t.disposition='paid' AND (i.id IS NULL OR i.environment<>t.environment OR i.cluster<>t.cluster OR i.status<>'paid')
 UNION ALL SELECT 'paid_transfer_credit_missing','transfer',t.id::text FROM chain_transfers t WHERE t.environment=$1 AND t.cluster=$2 AND t.disposition='paid' AND NOT EXISTS(SELECT 1 FROM ledger_entries l WHERE l.transfer_id=t.id AND l.invoice_id=t.invoice_id AND l.amount=t.amount)
 UNION ALL SELECT 'confirmed_event_missing','invoice',i.id::text FROM invoices i WHERE i.environment=$1 AND i.cluster=$2 AND i.status='paid' AND NOT EXISTS(SELECT 1 FROM webhook_events e WHERE e.invoice_id=i.id AND e.event_type='payment.confirmed')
 UNION ALL SELECT 'confirmed_event_invalid','invoice',i.id::text FROM webhook_events e JOIN invoices i ON i.id=e.invoice_id WHERE i.environment=$1 AND i.cluster=$2 AND e.event_type='payment.confirmed' AND (i.status<>'paid' OR e.payload->>'event_id' IS DISTINCT FROM e.event_id::text OR e.payload->>'project_id' IS DISTINCT FROM i.project_id::text OR e.payload->>'event_type' IS DISTINCT FROM 'payment.confirmed' OR e.payload#>>'{data,invoice_id}' IS DISTINCT FROM i.id::text OR e.payload#>>'{data,cluster}' IS DISTINCT FROM i.cluster OR e.payload#>>'{data,asset}' IS DISTINCT FROM i.asset OR e.payload#>>'{data,mint}' IS DISTINCT FROM i.mint OR e.payload#>>'{data,finality}' IS DISTINCT FROM 'finalized' OR e.payload#>>'{data,amount_received}' IS DISTINCT FROM to_char(i.payable_units::numeric/1000000,'FM999999999999999999990.000000') OR NOT EXISTS(SELECT 1 FROM ledger_entries l JOIN chain_transfers t ON t.id=l.transfer_id WHERE l.invoice_id=i.id AND e.payload#>>'{data,transfers,0,signature}'=t.signature AND e.payload#>>'{data,transfers,0,instruction_path}'=t.instruction_path AND e.payload#>>'{data,transfers,0,slot}'=t.slot::text))
`;
export async function runReconciliation(
  pool: pg.Pool,
  scope: NotificationScope,
  reader: ChainReader,
  intervalMs = 900000,
  batchSize = 10,
) {
  const env = [scope.APP_ENV, scope.SOLANA_CLUSTER],
    token = randomUUID(),
    client = await pool.connect();
  let runId: string | undefined,
    start = "0",
    rows: RecordedTransfer[] = [],
    configs: TokenConfig[] = [],
    invoiceCount = "0",
    snapshot: Date | string | undefined,
    dbFindings: {
      code: string;
      entity_type: string;
      entity_id: string;
      total_count: string;
    }[] = [],
    hasMore = false;
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO reconciliation_control(environment,cluster)VALUES($1,$2)ON CONFLICT DO NOTHING",
      env,
    );
    const control = (
      await client.query(
        "UPDATE reconciliation_control SET lease_token=$3,locked_until=now()+interval '10 minutes' WHERE environment=$1 AND cluster=$2 AND next_run_at<=now() AND (locked_until IS NULL OR locked_until<=now()) RETURNING cursor_id::text",
        [...env, token],
      )
    ).rows[0];
    if (!control) {
      await client.query("COMMIT");
      return null;
    }
    start = control.cursor_id;
    await client.query(
      "UPDATE reconciliation_runs SET status='abandoned',finished_at=now(),error_code='lease_expired' WHERE environment=$1 AND cluster=$2 AND status='running'",
      env,
    );
    runId = (
      await client.query(
        "INSERT INTO reconciliation_runs(environment,cluster,cursor_start)VALUES($1,$2,$3)RETURNING id::text",
        [...env, start],
      )
    ).rows[0].id;
    await client.query("COMMIT");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='10s'");
    const meta = (
      await client.query(
        "SELECT now() AS at,count(*)::text AS count FROM invoices WHERE environment=$1 AND cluster=$2",
        env,
      )
    ).rows[0];
    snapshot = meta.at;
    invoiceCount = meta.count;
    dbFindings = (
      await client.query(
        `SELECT code,entity_type,entity_id,count(*) OVER()::text AS total_count FROM (${checks}) issues ORDER BY code,entity_id LIMIT 100`,
        env,
      )
    ).rows;
    configs = (
      await client.query<TokenConfig>(
        "SELECT * FROM token_configs WHERE environment=$1 AND cluster=$2",
        env,
      )
    ).rows;
    const batch = (
      await client.query<RecordedTransfer>(
        "SELECT id::text,signature,instruction_path,slot::text,block_time,mint,destination,amount::text FROM chain_transfers WHERE environment=$1 AND cluster=$2 AND disposition='paid' AND id>$3 ORDER BY chain_transfers.id LIMIT $4",
        [...env, start, batchSize + 1],
      )
    ).rows;
    rows = batch.slice(0, batchSize);
    hasMore = batch.length > batchSize;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (!runId) throw error;
    const failed = await pool.query(
      "UPDATE reconciliation_runs r SET status='failed',finished_at=now(),error_code='database_check_failed' WHERE r.id=$1 AND EXISTS(SELECT 1 FROM reconciliation_control WHERE environment=$2 AND cluster=$3 AND lease_token=$4 AND locked_until>now())",
      [runId, ...env, token],
    );
    await pool.query(
      "UPDATE reconciliation_control SET lease_token=NULL,locked_until=NULL,next_run_at=now()+$4*interval '1 millisecond' WHERE environment=$1 AND cluster=$2 AND lease_token=$3",
      [...env, token, intervalMs],
    );
    if (failed.rowCount)
      await updateOperationalStatus(
        pool,
        scope,
        "reconciliation",
        false,
        "database_check_failed",
        1,
      );
    return runId;
  } finally {
    client.release();
  }
  if (!runId) throw new Error("Reconciliation run was not created");
  const findings = dbFindings.map(({ code, entity_type, entity_id }) => ({
    code,
    entity_type,
    entity_id,
  }));
  let checked = 0,
    unavailable = false,
    chainMismatch = 0;
  try {
    await reader.validate(configs);
    for (const row of rows) {
      const result = await reader.verify(row, configs);
      if (result === "unavailable") {
        unavailable = true;
        findings.push({
          code: "chain_unavailable",
          entity_type: "transfer",
          entity_id: row.id,
        });
      } else {
        checked++;
        if (result === "mismatch") {
          chainMismatch++;
          findings.push({
            code: "chain_mismatch",
            entity_type: "transfer",
            entity_id: row.id,
          });
        }
      }
    }
  } catch {
    unavailable = true;
    findings.push({
      code: "chain_configuration_unavailable",
      entity_type: "scope",
      entity_id: scope.SOLANA_CLUSTER,
    });
  }
  const violations = Number(dbFindings[0]?.total_count ?? 0) + chainMismatch,
    status = violations ? "findings" : unavailable ? "unavailable" : "clean";
  const end = unavailable ? start : hasMore ? rows.at(-1)!.id : "0",
    finish = await pool.connect();
  try {
    await finish.query("BEGIN");
    const owned = await finish.query(
      "SELECT 1 FROM reconciliation_control WHERE environment=$1 AND cluster=$2 AND lease_token=$3 AND locked_until>now() FOR UPDATE",
      [...env, token],
    );
    if (!owned.rowCount) {
      await finish.query("ROLLBACK");
      return runId;
    }
    for (const f of findings)
      await finish.query(
        "INSERT INTO reconciliation_findings(run_id,code,entity_type,entity_id)VALUES($1,$2,$3,$4)",
        [runId, f.code, f.entity_type, f.entity_id],
      );
    await finish.query(
      "UPDATE reconciliation_runs SET status=$2,finished_at=now(),snapshot_at=$3,invoice_count=$4,finding_count=$5,chain_checked=$6,chain_selected=$7,chain_complete=$8,cursor_end=$9,cycle_completed=$10,error_code=$11 WHERE id=$1",
      [
        runId,
        status,
        snapshot,
        invoiceCount,
        Number(dbFindings[0]?.total_count ?? 0) +
          findings.length -
          dbFindings.length,
        checked,
        rows.length,
        !unavailable,
        end,
        !unavailable && !hasMore,
        unavailable ? "chain_unavailable" : null,
      ],
    );
    await finish.query(
      "UPDATE reconciliation_control SET lease_token=NULL,locked_until=NULL,next_run_at=now()+$4*interval '1 millisecond',cursor_id=$5 WHERE environment=$1 AND cluster=$2 AND lease_token=$3",
      [...env, token, intervalMs, end],
    );
    await writeOperationalStatus(
      finish,
      scope,
      "reconciliation",
      status === "clean",
      `reconciliation_${status}`,
      1,
    );
    await finish.query("COMMIT");
  } catch (error) {
    await finish.query("ROLLBACK");
    throw error;
  } finally {
    finish.release();
  }
  return runId;
}
