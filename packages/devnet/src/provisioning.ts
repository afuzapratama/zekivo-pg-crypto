import { address } from "@solana/kit";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { DEVNET_MOCK_USDT_MINT } from "../../solana/src/networks.js";
import { inspectMockUsdt } from "./mock-usdt.js";
import { createHash } from "node:crypto";
import type pg from "pg";
import { DevnetSetup } from "./setup.js";
import type { SolanaRpc } from "../../solana/src/rpc.js";
export async function provisionUsdc(
  pool: pg.Pool,
  rpc: Pick<SolanaRpc, "call">,
  projectId: string,
  apiKey: string,
  asset: "USDC" | "USDT" = "USDC",
  openingBalancePolicy: "require-zero" | "record-future-only" = "require-zero",
) {
  const usdc = await new DevnetSetup(rpc).inspect();
  const mockMint = address(DEVNET_MOCK_USDT_MINT);
  const [mockAta] = await findAssociatedTokenPda({
    owner: usdc.recipient,
    mint: mockMint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const mock =
    asset === "USDT" ? await inspectMockUsdt(rpc, mockMint) : undefined;
  const state = mock
    ? {
        ...mock,
        genesis: usdc.genesis,
        balance_units:
          (mock.recipient_balance as { amount: string } | undefined)?.amount ??
          "0",
      }
    : usdc;
  if (!state.ready) throw new Error("Receiving ATA is not finalized/ready");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(70102)");
    const other = await client.query(
      "SELECT 1 FROM projects WHERE environment<>'staging' UNION ALL SELECT 1 FROM token_configs WHERE environment<>'staging' OR cluster<>'devnet'",
    );
    if (other.rowCount)
      throw new Error("Database contains non-Devnet data; refusing provision");
    const existing = await client.query("SELECT * FROM token_configs");
    if (
      existing.rows.some(
        (t) =>
          !(
            (t.asset === "USDC" &&
              t.mint === usdc.mint &&
              t.token_account === usdc.ata) ||
            (t.asset === "USDT" &&
              t.mint === mockMint &&
              t.token_account === mockAta)
          ) ||
          t.recipient !== state.recipient ||
          t.genesis_hash !== state.genesis,
      )
    )
      throw new Error(
        "Existing token configuration differs; manual migration required",
      );
    const project = await client.query(
      "SELECT environment FROM projects WHERE id=$1",
      [projectId],
    );
    if (project.rows[0] && project.rows[0].environment !== "staging")
      throw new Error("Project scope mismatch");
    await client.query(
      "INSERT INTO projects(id,name,environment) VALUES($1,'Zekivo Devnet wallet tests','staging') ON CONFLICT(id) DO NOTHING",
      [projectId],
    );
    await client.query(
      "INSERT INTO api_keys(id,project_id,key_hash) VALUES(gen_random_uuid(),$1,$2) ON CONFLICT(key_hash) DO NOTHING",
      [projectId, createHash("sha256").update(apiKey).digest("hex")],
    );
    const keyOwner = await client.query(
      "SELECT project_id FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())",
      [createHash("sha256").update(apiKey).digest("hex")],
    );
    if (keyOwner.rows[0]?.project_id !== projectId)
      throw new Error("API key owner or revocation mismatch");
    await client.query(
      "INSERT INTO token_configs(environment,cluster,asset,mint,recipient,token_account,genesis_hash,decimals) VALUES('staging','devnet',$5,$1,$2,$3,$4,6) ON CONFLICT DO NOTHING",
      [state.mint, state.recipient, state.ata, state.genesis, asset],
    );
    const checkpoint = await client.query(
      "SELECT scanned_through_slot FROM scan_checkpoints WHERE environment='staging' AND cluster='devnet' AND token_account=$1",
      [state.ata],
    );
    let baseline = checkpoint.rows[0]?.scanned_through_slot;
    if (!checkpoint.rowCount) {
      const invoices = await client.query(
        "SELECT 1 FROM invoices WHERE asset=$1 UNION ALL SELECT 1 FROM payment_attempts WHERE asset=$1 LIMIT 1",
        [asset],
      );
      const anyHistory =
        openingBalancePolicy === "record-future-only"
          ? await client.query(
              "SELECT 1 FROM invoices UNION ALL SELECT 1 FROM payment_attempts LIMIT 1",
            )
          : invoices;
      if (
        anyHistory.rowCount ||
        (openingBalancePolicy === "require-zero" && state.balance_units !== "0")
      )
        throw new Error(
          "Cannot establish first scan boundary after invoices or receiving funds exist",
        );
      const head = await rpc.call<number>("getSlot", [
        { commitment: "finalized" },
      ]);
      const first = await rpc.call<number>("getFirstAvailableBlock");
      if (
        !Number.isSafeInteger(head) ||
        !Number.isSafeInteger(first) ||
        first < 0 ||
        head < first
      )
        throw new Error("Invalid Devnet history bounds");
      baseline = String(head);
      await client.query(
        "INSERT INTO scan_checkpoints(environment,cluster,token_account,signature,scanned_through_slot) VALUES('staging','devnet',$1,NULL,$2)",
        [state.ata, baseline],
      );
      await client.query(
        "INSERT INTO audit_logs(project_id,action,entity_id) VALUES($1,'devnet.initial_scan_boundary',$2)",
        [
          projectId,
          JSON.stringify({
            ata: state.ata,
            genesis: state.genesis,
            slot: head,
            first_available_slot: first,
            opening_balance_units: state.balance_units,
            opening_balance_policy: openingBalancePolicy,
            policy: "future invoices only; no historical recovery claim",
          }),
        ],
      );
    } else if (baseline == null)
      throw new Error("Existing scan boundary is unknown; do not reset it");
    await client.query("COMMIT");
    return {
      cluster: "devnet",
      asset,
      project_id: projectId,
      recipient: state.recipient,
      ata: state.ata,
      scanned_through_slot: baseline,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
