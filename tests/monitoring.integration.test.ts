import { dispatchNotification } from "../packages/notifications/src/queue.js";
import { encryptSecret } from "../packages/webhooks/src/crypto.js";
import {
  runReconciliation,
  type ChainReader,
} from "../packages/monitoring/src/reconciliation.js";
import {
  checkUptime,
  updateOperationalStatus,
} from "../packages/monitoring/src/status.js";
import { createInvoice } from "../packages/database/src/invoices.js";
import { settleTransfer } from "../packages/database/src/settle.js";
import type { TokenConfig } from "../packages/solana/src/decode.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createPool } from "../packages/database/src/pool.js";
import { buildApp } from "../apps/api/src/app.js";
import type { AdminAuthConfig } from "../packages/auth/src/config.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("scheduled reconciliation and independent uptime", () => {
  const root = createPool(url!);
  const schema = `project_test_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url ?? "postgres://unused@localhost/test");
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  const pool = createPool(parsed.href);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const tokens = ids.map(() => randomBytes(32).toString("base64url"));
  const csrf = randomBytes(32).toString("base64url");
  const auth: AdminAuthConfig = {
    tenant: randomUUID(),
    clientId: randomUUID(),
    secret: "test-only-secret-unused-oidc",
    origin: "http://localhost:3100",
    allowed: {
      [ids[0]!]: "admin",
      [ids[1]!]: "operator",
      [ids[2]!]: "read-only",
    },
  };
  const app = buildApp(
    pool,
    {
      APP_ENV: "test",
      SOLANA_CLUSTER: "localnet",
      WEB_ORIGIN: auth.origin,
      ADMIN_AUTH: auth,
    },
    false,
  );
  const headers = (role = 0) => ({
    cookie: `zekivo_test_localnet_session=${tokens[role]}`,
    origin: auth.origin,
    "x-csrf-token": csrf,
    "idempotency-key": randomUUID(),
  });
  const projectId = randomUUID();
  let invoiceId: string;
  const scope = { APP_ENV: "test", SOLANA_CLUSTER: "localnet" };
  const config: TokenConfig = {
    environment: "test",
    cluster: "localnet",
    asset: "USDC",
    mint: "fixture-mint",
    recipient: "fixture-owner",
    token_account: "fixture-ata",
    genesis_hash: "fixture-genesis",
    decimals: 6,
  };
  const reader: ChainReader = {
    validate: async () => {},
    verify: async () => "verified",
  };
  async function createPaid() {
    const invoice = (
      await createInvoice(
        pool,
        projectId,
        "test",
        "localnet",
        randomUUID(),
        {
          order_id: randomUUID(),
          asset: "USDC",
          amount: "1",
        },
        true,
      )
    ).row;
    await settleTransfer(pool, config, randomUUID(), {
      path: "0",
      mint: config.mint,
      destination: config.token_account,
      amount: BigInt(invoice.payable_units),
      references: [],
      slot: 123,
      blockTime: Math.ceil(Date.now() / 1000),
    });
    return invoice.id as string;
  }
  async function due() {
    await pool.query(
      "UPDATE reconciliation_control SET next_run_at=now()-interval '1 second' WHERE environment='test' AND cluster='localnet'",
    );
  }
  async function run(r = reader, batchSize = 10) {
    await due();
    return runReconciliation(pool, scope, r, 900000, batchSize);
  }
  async function result(id: string | null) {
    return (
      await pool.query("SELECT * FROM reconciliation_runs WHERE id=$1", [id])
    ).rows[0];
  }
  beforeAll(async () => {
    await root.query(`CREATE SCHEMA ${schema}`);
    for (const file of (await readdir("packages/database/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(
        await readFile(`packages/database/migrations/${file}`, "utf8"),
      );
    await pool.query(
      "INSERT INTO projects(id,name,environment)VALUES($1,'Recon fixture','test')",
      [projectId],
    );
    await pool.query(
      "INSERT INTO token_configs VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        config.environment,
        config.cluster,
        config.asset,
        config.mint,
        config.recipient,
        config.token_account,
        config.genesis_hash,
        6,
      ],
    );
    invoiceId = await createPaid();
    for (let i = 0; i < 3; i++)
      await pool.query(
        "INSERT INTO admin_sessions(token_hash,environment,cluster,tenant_id,object_id,csrf_token,expires_at,authenticated_at)VALUES($1,'test','localnet',$2,$3,$4,now()+interval '1 hour',now())",
        [
          createHash("sha256").update(tokens[i]!).digest("hex"),
          auth.tenant,
          ids[i],
          csrf,
        ],
      );
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });
  it("checks a paid invoice/ledger/event snapshot without mutating settlement", async () => {
    const id = await run(),
      r = await result(id);
    expect(r).toMatchObject({
      status: "clean",
      invoice_count: "1",
      finding_count: "0",
      chain_checked: 1,
      chain_selected: 1,
      chain_complete: true,
      cycle_completed: true,
    });
    expect(await runReconciliation(pool, scope, reader)).toBeNull();
    expect(
      (await pool.query("SELECT status FROM invoices WHERE id=$1", [invoiceId]))
        .rows[0].status,
    ).toBe("paid");
    expect((await pool.query("SELECT 1 FROM ledger_entries")).rowCount).toBe(1);
  });
  it("treats unavailable RPC as unverifiable, holds cursor and deduplicates incident alerts", async () => {
    const unavailable: ChainReader = {
      ...reader,
      verify: async () => "unavailable",
    };
    const id = await run(unavailable);
    expect(await result(id)).toMatchObject({
      status: "unavailable",
      chain_checked: 0,
      chain_complete: false,
      cursor_end: "0",
    });
    await run(unavailable);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM notification_events WHERE event_type='monitor.alert'",
        )
      ).rowCount,
    ).toBe(1);
    await run();
    expect(
      (
        await pool.query(
          "SELECT 1 FROM notification_events WHERE event_type='monitor.recovered'",
        )
      ).rowCount,
    ).toBe(1);
  });
  it("records ledger and chain mismatches without auto-repair", async () => {
    await pool.query(
      "UPDATE ledger_entries SET amount=amount+1 WHERE invoice_id=$1",
      [invoiceId],
    );
    const id = await run({ ...reader, verify: async () => "mismatch" });
    expect((await result(id)).status).toBe("findings");
    const codes = (
      await pool.query(
        "SELECT code FROM reconciliation_findings WHERE run_id=$1",
        [id],
      )
    ).rows.map((r) => r.code);
    expect(codes).toContain("ledger_mismatch");
    expect(codes).toContain("chain_mismatch");
    expect(
      (
        await pool.query(
          "SELECT l.amount<>t.amount AS mismatch FROM ledger_entries l JOIN chain_transfers t ON t.id=l.transfer_id WHERE l.invoice_id=$1",
          [invoiceId],
        )
      ).rows[0].mismatch,
    ).toBe(true);
    await pool.query(
      "UPDATE ledger_entries l SET amount=t.amount FROM chain_transfers t WHERE t.id=l.transfer_id AND l.invoice_id=$1",
      [invoiceId],
    );
  });
  it("detects confirmed payload inconsistencies and refuses to report chain validation failure clean", async () => {
    const event = (
      await pool.query(
        "SELECT event_id,payload FROM webhook_events WHERE invoice_id=$1",
        [invoiceId],
      )
    ).rows[0];
    await pool.query(
      "UPDATE webhook_events SET payload=jsonb_set(payload,'{data,amount_received}','\"9.000000\"') WHERE event_id=$1",
      [event.event_id],
    );
    const id = await run({
      ...reader,
      validate: async () => {
        throw new Error("fixture RPC unavailable");
      },
    });
    expect(await result(id)).toMatchObject({
      status: "findings",
      chain_complete: false,
      error_code: "chain_unavailable",
    });
    expect(
      (
        await pool.query(
          "SELECT code FROM reconciliation_findings WHERE run_id=$1",
          [id],
        )
      ).rows.map((r) => r.code),
    ).toContain("confirmed_event_invalid");
    await pool.query("UPDATE webhook_events SET payload=$2 WHERE event_id=$1", [
      event.event_id,
      event.payload,
    ]);
  });
  it("persists total finding count beyond sample limit and scopes admin histories", async () => {
    const added: string[] = [];
    for (let n = 0; n < 105; n++) {
      const id = randomUUID();
      added.push(id);
      await pool.query(
        "INSERT INTO invoices(id,project_id,environment,cluster,asset,recipient,mint,order_id,base_units,payable_units,checkout_token,expires_at,status)VALUES($1::uuid,$2,'test','localnet','USDC','owner','mint',$1::text,1,$3,$1::text,now(),'paid')",
        [id, projectId, 2000000 + n],
      );
    }
    const id = await run();
    expect((await result(id)).finding_count).toBe("210");
    const response = await app.inject({
      url: `/admin/monitoring?run_id=${id}`,
      headers: headers(2),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ samples_truncated: true });
    expect(response.json().findings).toHaveLength(100);
    const foreign = (
      await pool.query(
        "INSERT INTO reconciliation_runs(environment,cluster,cursor_start)VALUES('staging','devnet',0)RETURNING id::text",
      )
    ).rows[0].id;
    expect(
      (
        await app.inject({
          url: `/admin/monitoring?run_id=${foreign}`,
          headers: headers(2),
        })
      ).statusCode,
    ).toBe(404);
    expect((await app.inject({ url: "/admin/monitoring" })).statusCode).toBe(
      401,
    );
    await pool.query("DELETE FROM invoices WHERE id=ANY($1::uuid[])", [added]);
  });
  it("leases prevent concurrent work and a replaced lease cannot commit stale results", async () => {
    await due();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      entered = new Promise<void>((resolve) => {
        started = resolve;
      });
    const running = runReconciliation(pool, scope, {
      ...reader,
      validate: async () => {
        started();
        await gate;
      },
    });
    await entered;
    expect(await runReconciliation(pool, scope, reader)).toBeNull();
    await pool.query(
      "UPDATE reconciliation_control SET locked_until=now()-interval '1 second' WHERE environment='test' AND cluster='localnet'",
    );
    const replacement = await runReconciliation(pool, scope, reader);
    release();
    const old = await running;
    expect((await result(old)).status).toBe("abandoned");
    expect((await result(replacement)).status).toBe("clean");
    expect(
      (
        await pool.query(
          "SELECT 1 FROM reconciliation_findings WHERE run_id=$1",
          [old],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("advances a bounded chain batch and restarts the history cycle at zero", async () => {
    await createPaid();
    await createPaid();
    await createPaid();
    const first = await run(reader, 2);
    expect(await result(first)).toMatchObject({
      status: "clean",
      chain_selected: 2,
      cycle_completed: false,
    });
    const end = (await result(first)).cursor_end;
    expect(BigInt(end)).toBeGreaterThan(0n);
    const last = await run(reader, 2);
    expect(await result(last)).toMatchObject({
      status: "clean",
      chain_selected: 2,
      cursor_start: end,
      cursor_end: "0",
      cycle_completed: true,
    });
  });
  it("separate uptime checks detect missing/stale workers with thresholds, cooldown and recovery", async () => {
    await checkUptime(pool, scope, true, true);
    await checkUptime(pool, scope, true, true);
    expect(
      (
        await pool.query(
          "SELECT status FROM operational_status WHERE component='scanner'",
        )
      ).rows[0].status,
    ).toBe("unknown");
    await checkUptime(pool, scope, true, true);
    expect(
      (
        await pool.query(
          "SELECT status FROM operational_status WHERE component='scanner'",
        )
      ).rows[0].status,
    ).toBe("unhealthy");
    await pool.query(
      "INSERT INTO worker_health(environment,cluster,scanner_status,last_success_at)VALUES('test','localnet','healthy',now())",
    );
    await checkUptime(pool, scope, true, true);
    expect(
      (
        await pool.query(
          "SELECT status FROM operational_status WHERE component='scanner'",
        )
      ).rows[0].status,
    ).toBe("healthy");
    await checkUptime(pool, scope, false, true);
    await checkUptime(pool, scope, false, true);
    await checkUptime(pool, scope, false, true);
    const count = (
      await pool.query(
        "SELECT count(*)::int AS count FROM notification_events WHERE source_key LIKE 'monitor:api:%'",
      )
    ).rows[0].count;
    await checkUptime(pool, scope, false, true);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM notification_events WHERE source_key LIKE 'monitor:api:%'",
        )
      ).rows[0].count,
    ).toBe(count);
    await pool.query(
      "UPDATE operational_status SET last_alert_at=now()-interval '61 minutes' WHERE component='api'",
    );
    await checkUptime(pool, scope, false, true);
    await checkUptime(pool, scope, true, true);
    expect(
      (
        await pool.query(
          "SELECT status FROM operational_status WHERE component='api'",
        )
      ).rows[0].status,
    ).toBe("healthy");
    await updateOperationalStatus(
      pool,
      scope,
      "scanner",
      null,
      "monitoring_disabled",
    );
    expect(
      (
        await pool.query(
          "SELECT status FROM operational_status WHERE component='scanner'",
        )
      ).rows[0].status,
    ).toBe("disabled");
  });
  it("independent monitor alerts can be dispatched while worker heartbeat remains stale", async () => {
    const key = "ab".repeat(32);
    await pool.query(
      "INSERT INTO notification_channels(environment,cluster,channel,enabled,config_ciphertext)VALUES('test','localnet','telegram',true,$1)",
      [
        encryptSecret(
          JSON.stringify({
            bot_token: `123456:${"a".repeat(35)}`,
            chat_id: "-100123",
          }),
          key,
        ),
      ],
    );
    await pool.query(
      "UPDATE worker_health SET updated_at=now()-interval '3 minutes'",
    );
    const before = (await pool.query("SELECT updated_at FROM worker_health"))
      .rows[0].updated_at;
    for (let n = 0; n < 3; n++) await checkUptime(pool, scope, true, true);
    let sends = 0;
    for (let n = 0; n < 50; n++)
      if (
        !(await dispatchNotification(
          pool,
          { ...scope, NOTIFICATION_ENCRYPTION_KEY: key },
          async () => {
            sends++;
          },
        ))
      )
        break;
    expect(sends).toBeGreaterThan(0);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id WHERE e.source_key LIKE 'monitor:scanner:%' AND d.channel='telegram' AND d.status='sent'",
        )
      ).rowCount,
    ).toBeGreaterThan(0);
    expect(
      (await pool.query("SELECT updated_at FROM worker_health")).rows[0]
        .updated_at,
    ).toEqual(before);
  });
  it("persists database check failures and allows a later scheduled recovery", async () => {
    await pool.query(
      "ALTER TABLE ledger_entries RENAME TO fixture_unavailable_ledger",
    );
    let id: string | null = null;
    try {
      id = await run();
    } finally {
      await pool.query(
        "ALTER TABLE fixture_unavailable_ledger RENAME TO ledger_entries",
      );
    }
    expect(await result(id)).toMatchObject({
      status: "failed",
      error_code: "database_check_failed",
    });
    expect(
      (
        await pool.query(
          "SELECT lease_token FROM reconciliation_control WHERE environment='test' AND cluster='localnet'",
        )
      ).rows[0].lease_token,
    ).toBeNull();
    const recovered = await run();
    expect((await result(recovered)).status).toBe("clean");
  });
  it("paginates immutable run history with server scope and validates query inputs", async () => {
    for (let n = 0; n < 30; n++)
      await pool.query(
        "INSERT INTO reconciliation_runs(environment,cluster,status,cursor_start)VALUES('test','localnet','clean',0)",
      );
    const first = (
      await app.inject({ url: "/admin/monitoring", headers: headers(2) })
    ).json();
    const second = (
      await app.inject({
        url: `/admin/monitoring?before_run=${first.next_cursor}`,
        headers: headers(2),
      })
    ).json();
    expect(first.runs).toHaveLength(25);
    expect(second.runs.length).toBeGreaterThan(0);
    expect(new Set([...first.runs, ...second.runs].map((r) => r.id)).size).toBe(
      first.runs.length + second.runs.length,
    );
    expect(
      (
        await app.inject({
          url: "/admin/monitoring?run_id=not-an-id",
          headers: headers(2),
        })
      ).statusCode,
    ).toBe(400);
  });
});
