import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createPool } from "../packages/database/src/pool.js";
import { buildApp } from "../apps/api/src/app.js";
import type { AdminAuthConfig } from "../packages/auth/src/config.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("admin transfer review queue", () => {
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
  const post = (
    url: string,
    payload: Record<string, unknown>,
    extra: Record<string, string> = {},
  ) =>
    app.inject({
      method: "POST",
      url,
      payload,
      headers: { ...headers(), ...extra },
    });
  const projectId = randomUUID();
  let transferId: string;
  const invoiceId = randomUUID();
  beforeAll(async () => {
    await root.query(`CREATE SCHEMA ${schema}`);
    for (const file of (await readdir("packages/database/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(
        await readFile(`packages/database/migrations/${file}`, "utf8"),
      );
    await pool.query(
      "INSERT INTO projects(id,name,environment)VALUES($1,'Test merchant','test')",
      [projectId],
    );
    await pool.query(
      "INSERT INTO invoices(id,project_id,environment,cluster,asset,recipient,mint,order_id,base_units,payable_units,checkout_token,expires_at)VALUES($1::uuid,$2,'test','localnet','USDC','receiver','mint',$1::text,1000000,1000001,$1::text,now())",
      [invoiceId, projectId],
    );
    for (const [cluster, disposition, linked] of [
      ["localnet", "partial", true],
      ["localnet", "unmatched", false],
      ["localnet", "paid", true],
      ["devnet", "late", false],
    ]) {
      const row = (
        await pool.query(
          "INSERT INTO chain_transfers(environment,cluster,signature,instruction_path,slot,block_time,mint,destination,amount,invoice_id,disposition)VALUES('test',$1,$2,'0',123,now(),'mint','ata',500000,$3,$4)RETURNING id::text",
          [cluster, randomUUID(), linked ? invoiceId : null, disposition],
        )
      ).rows[0];
      if (disposition === "partial") transferId = row.id;
    }
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
  const get = (path: string, role = 0) =>
    app.inject({ url: path, headers: headers(role) });
  const payload = (status = "in_progress", expected_version = 0) => ({
    status,
    expected_version,
    reason: "Checked finalized transaction and contacted merchant.",
  });
  it("lists non-paid transfers in current scope, including unmatched without project", async () => {
    const response = await get("/admin/reviews");
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(2);
    expect(
      response
        .json()
        .items.map((t: { disposition: string }) => t.disposition)
        .sort(),
    ).toEqual(["partial", "unmatched"]);
    expect(
      response.json().items.find((t: { id: string }) => t.id === transferId),
    ).toMatchObject({
      amount: "0.500000",
      review_status: "open",
      review_version: 0,
    });
    expect(
      (await get(`/admin/reviews?project_id=${projectId}`)).json().items,
    ).toHaveLength(1);
    expect(
      (await get("/admin/reviews?disposition=unmatched")).json().items,
    ).toHaveLength(1);
    expect(
      (await get("/admin/reviews?status=closed")).json().items,
    ).toHaveLength(0);
  });
  it("rejects unauthenticated/read-only/CSRF/stale writes and invalid input", async () => {
    expect((await app.inject({ url: "/admin/reviews" })).statusCode).toBe(401);
    expect(
      (await post(`/admin/reviews/${transferId}`, payload(), headers(2)))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await post(`/admin/reviews/${transferId}`, payload(), {
          "x-csrf-token": "wrong",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(`/admin/reviews/${transferId}`, {
          ...payload(),
          reason: "too short",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(`/admin/reviews/${transferId}`, {
          ...payload(),
          status: "paid",
        })
      ).statusCode,
    ).toBe(400);
    await pool.query(
      "UPDATE admin_sessions SET authenticated_at=now()-interval '11 minutes' WHERE object_id=$1",
      [ids[0]],
    );
    expect(
      (await post(`/admin/reviews/${transferId}`, payload())).json().error,
    ).toBe("reauthentication_required");
    await pool.query(
      "UPDATE admin_sessions SET authenticated_at=now() WHERE object_id=$1",
      [ids[0]],
    );
  });
  it("operator records reason and atomic audit, deduplicates retries without financial mutations", async () => {
    const request = { ...headers(1), "idempotency-key": randomUUID() };
    const responses = await Promise.all([
      post(`/admin/reviews/${transferId}`, payload(), request),
      post(`/admin/reviews/${transferId}`, payload(), request),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(responses.filter((r) => r.json().replayed)).toHaveLength(1);
    const detail = (await get(`/admin/reviews/${transferId}`, 2)).json();
    expect(detail.transfer).toMatchObject({
      review_status: "in_progress",
      review_version: 1,
      disposition: "partial",
    });
    expect(detail.notes).toHaveLength(1);
    expect(detail.notes[0]).toMatchObject({
      object_id: ids[1],
      from_status: "open",
      to_status: "in_progress",
    });
    expect(
      (
        await pool.query(
          "SELECT object_id,project_id FROM admin_audit_logs WHERE action='transfer.reviewed'",
        )
      ).rows,
    ).toEqual([{ object_id: ids[1], project_id: projectId }]);
    expect(
      (await pool.query("SELECT status FROM invoices WHERE id=$1", [invoiceId]))
        .rows[0].status,
    ).toBe("pending");
    expect((await pool.query("SELECT 1 FROM ledger_entries")).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM webhook_events")).rowCount).toBe(0);
    expect(
      (
        await post(
          `/admin/reviews/${transferId}`,
          payload("closed", 1),
          request,
        )
      ).json().error,
    ).toBe("idempotency_conflict");
  });
  it("detects stale concurrent updates, closes and reopens with append-only history", async () => {
    const responses = await Promise.all([
      post(`/admin/reviews/${transferId}`, payload("closed", 1)),
      post(`/admin/reviews/${transferId}`, payload("in_progress", 1)),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      (await post(`/admin/reviews/${transferId}`, payload("closed", 2)))
        .statusCode,
    ).toBe(200);
    expect((await get("/admin/reviews")).json().items).toHaveLength(1);
    expect(
      (await get("/admin/reviews?status=closed")).json().items,
    ).toHaveLength(1);
    expect(
      (await post(`/admin/reviews/${transferId}`, payload("open", 3)))
        .statusCode,
    ).toBe(200);
    expect((await get("/admin/reviews")).json().items).toHaveLength(2);
    expect(
      (await get(`/admin/reviews/${transferId}`)).json().notes,
    ).toHaveLength(4);
  });
  it("refuses paid and foreign-cluster detail/write targets", async () => {
    const hidden = (
      await pool.query(
        "SELECT id::text FROM chain_transfers WHERE disposition='paid' OR cluster='devnet'",
      )
    ).rows;
    for (const t of hidden) {
      expect((await get(`/admin/reviews/${t.id}`)).statusCode).toBe(404);
      expect((await post(`/admin/reviews/${t.id}`, payload())).statusCode).toBe(
        404,
      );
    }
  });
  it("paginates transfers and operator notes without duplicates", async () => {
    for (let n = 0; n < 28; n++)
      await pool.query(
        "INSERT INTO chain_transfers(environment,cluster,signature,instruction_path,slot,block_time,mint,destination,amount,disposition)VALUES('test','localnet',$1,'0',123,now(),'mint','ata',1,'unmatched')",
        [randomUUID()],
      );
    const first = (await get("/admin/reviews")).json(),
      second = (await get(`/admin/reviews?before=${first.next_cursor}`)).json();
    expect(first.items).toHaveLength(25);
    expect(second.items).toHaveLength(5);
    expect(
      new Set(
        [...first.items, ...second.items].map((t: { id: string }) => t.id),
      ).size,
    ).toBe(30);
    for (let version = 4; version < 30; version++)
      expect(
        (
          await post(
            `/admin/reviews/${transferId}`,
            payload("in_progress", version),
          )
        ).statusCode,
      ).toBe(200);
    const detail = (await get(`/admin/reviews/${transferId}`)).json(),
      older = (
        await get(
          `/admin/reviews/${transferId}?before_note=${detail.next_note_cursor}`,
        )
      ).json();
    expect(detail.notes).toHaveLength(25);
    expect(older.notes).toHaveLength(5);
  });
});
