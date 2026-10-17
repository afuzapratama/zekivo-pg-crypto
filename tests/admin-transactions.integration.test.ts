import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createPool } from "../packages/database/src/pool.js";
import { buildApp } from "../apps/api/src/app.js";
import type { AdminAuthConfig } from "../packages/auth/src/config.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("admin transactions and invoice history", () => {
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
  const projectId = randomUUID(),
    invoiceId = randomUUID(),
    foreignInvoice = randomUUID();
  let endpoint: string;
  const signature = "2".repeat(88);
  beforeAll(async () => {
    await root.query(`CREATE SCHEMA ${schema}`);
    for (const file of (await readdir("packages/database/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(
        await readFile(`packages/database/migrations/${file}`, "utf8"),
      );
    await pool.query(
      "INSERT INTO projects(id,name,environment)VALUES($1,'Merchant','test')",
      [projectId],
    );
    for (const invoice of [invoiceId, foreignInvoice])
      await pool.query(
        "INSERT INTO invoices(id,project_id,environment,cluster,asset,recipient,mint,order_id,base_units,payable_units,checkout_token,expires_at)VALUES($1::uuid,$2,'test','localnet','USDC','receiver','mint',$1::text,1000000,$3,$1::text,now())",
        [invoice, projectId, invoice === invoiceId ? 1000001 : 1000002],
      );
    await pool.query(
      "INSERT INTO token_configs(environment,cluster,asset,mint,recipient,token_account,genesis_hash,decimals)VALUES('test','localnet','USDC','mint','receiver','ata','genesis',6)",
    );
    endpoint = randomUUID();
    await pool.query(
      "INSERT INTO webhook_endpoints(id,project_id,url,kind,secret_ciphertext)VALUES($1,$2,'https://example.com/hook','external','fixture')",
      [endpoint, projectId],
    );
    for (let n = 0; n < 105; n++) {
      await pool.query(
        "INSERT INTO chain_transfers(environment,cluster,signature,instruction_path,slot,block_time,mint,destination,amount,invoice_id,disposition)VALUES('test','localnet',$1,$2,123,'2026-10-17T00:00:00Z','mint','ata',1000001,$3,$4)",
        [
          n < 2 ? signature : "3".repeat(88),
          String(n),
          invoiceId,
          n === 0 ? "paid" : "partial",
        ],
      );
      const event = randomUUID();
      await pool.query(
        "INSERT INTO webhook_events(event_id,invoice_id,event_type,payload,created_at)VALUES($1,$2,$3,'{}','2026-10-17T00:00:00Z')",
        [event, invoiceId, `fixture.event.${n}`],
      );
      await pool.query(
        "INSERT INTO webhook_deliveries(event_id,endpoint_id)VALUES($1,$2)",
        [event, endpoint],
      );
    }
    for (const [environment, cluster] of [
      ["test", "devnet"],
      ["staging", "devnet"],
      ["test", "localnet"],
    ])
      await pool.query(
        "INSERT INTO chain_transfers(environment,cluster,signature,instruction_path,slot,block_time,mint,destination,amount,disposition)VALUES($1,$2,$3,'0',123,now(),'other-mint','other-ata',1,'unmatched')",
        [environment, cluster, randomUUID()],
      );
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
  const get = (path: string, role = 2) =>
    app.inject({ url: path, headers: headers(role) });
  it("reads only scoped transfers, includes paid and unassigned, and paginates without duplicates", async () => {
    const idsFound: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await get(
        `/admin/transactions${cursor ? `?before=${cursor}` : ""}`,
      );
      expect(response.statusCode).toBe(200);
      const data = response.json();
      idsFound.push(...data.items.map((r: { id: string }) => r.id));
      cursor = data.next_cursor;
    } while (cursor);
    expect(idsFound).toHaveLength(106);
    expect(new Set(idsFound).size).toBe(106);
    expect(
      (await get("/admin/transactions?disposition=paid")).json().items,
    ).toHaveLength(1);
    expect(
      (await get("/admin/transactions?unassigned=true")).json().items,
    ).toHaveLength(1);
    expect(
      (await get(`/admin/transactions?project_id=${projectId}&unassigned=true`))
        .statusCode,
    ).toBe(400);
  });
  it("filters mint/asset/project and exact signature while preserving multiple instructions", async () => {
    const result = (
      await get(
        `/admin/transactions?signature=${signature}&asset=USDC&project_id=${projectId}`,
      )
    ).json();
    expect(result.items).toHaveLength(2);
    expect(result.items[0].amount).toBe("1.000001");
    expect(
      result.items
        .map((r: { instruction_path: string }) => r.instruction_path)
        .sort(),
    ).toEqual(["0", "1"]);
    expect(
      (await get("/admin/transactions?asset=USDT")).json().items,
    ).toHaveLength(0);
    expect(
      (await get("/admin/transactions?signature=invalid")).statusCode,
    ).toBe(400);
    expect(
      (await get("/admin/transactions?before=9999999999999999999")).statusCode,
    ).toBe(400);
    expect((await app.inject({ url: "/admin/transactions" })).statusCode).toBe(
      401,
    );
  });
  it("paginates all three invoice histories including equal timestamps and preserves financial state", async () => {
    const first = (await get(`/admin/invoices/${invoiceId}`)).json();
    expect(first.transfers).toHaveLength(100);
    expect(first.events).toHaveLength(100);
    expect(first.deliveries).toHaveLength(100);
    const q = new URLSearchParams({
      before_transfer: first.next_cursors.transfers,
      before_event: first.next_cursors.events,
      before_delivery: first.next_cursors.deliveries,
    });
    const next = (await get(`/admin/invoices/${invoiceId}?${q}`)).json();
    expect(next.transfers).toHaveLength(5);
    expect(next.events).toHaveLength(5);
    expect(next.deliveries).toHaveLength(5);
    expect(next.next_cursors).toEqual({
      transfers: null,
      events: null,
      deliveries: null,
    });
    for (const [key, id] of [
      ["transfers", "id"],
      ["events", "event_id"],
      ["deliveries", "id"],
    ] as const)
      expect(
        new Set([...first[key], ...next[key]].map((r) => r[id])).size,
      ).toBe(105);
    expect(
      (await pool.query("SELECT status FROM invoices WHERE id=$1", [invoiceId]))
        .rows[0].status,
    ).toBe("pending");
    expect((await pool.query("SELECT 1 FROM ledger_entries")).rowCount).toBe(0);
  });
  it("rejects history cursors belonging to a different invoice", async () => {
    const first = (await get(`/admin/invoices/${invoiceId}`)).json();
    for (const [key, cursor] of [
      ["before_transfer", first.transfers[0].id],
      ["before_event", first.events[0].event_id],
      ["before_delivery", first.deliveries[0].id],
    ])
      expect(
        (await get(`/admin/invoices/${foreignInvoice}?${key}=${cursor}`))
          .statusCode,
      ).toBe(400);
  });
});
