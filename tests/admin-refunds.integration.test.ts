import { address } from "@solana/kit";
import * as proof from "../packages/solana/src/refund.js";
import { createInvoice } from "../packages/database/src/invoices.js";
import { settleTransfer } from "../packages/database/src/settle.js";
import type { TokenConfig } from "../packages/solana/src/decode.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createPool } from "../packages/database/src/pool.js";
import { buildApp } from "../apps/api/src/app.js";
import type { AdminAuthConfig } from "../packages/auth/src/config.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)(
  "manual refunds: audit, scope and atomic recording",
  () => {
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
        SOLANA_RPC_URL: "http://localhost:8899",
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
      vi.spyOn(proof, "verifyRefund").mockResolvedValue({
        destination_account: address(
          "3toF4H23Winv3CehGrxW7CaqMuFcbQVRfaDoa8upVLkt",
        ),
        slot: "999",
        block_time: new Date().toISOString(),
      });
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
      vi.restoreAllMocks();
      await app.close();
      await pool.end();
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
    });

    const body = (signature = "2".repeat(88), amount = "0.100000") => ({
      asset: "USDC",
      amount,
      destination: "3toF4H23Winv3CehGrxW7CaqMuFcbQVRfaDoa8upVLkt",
      signature,
      instruction_path: "0",
      reason: "Order cancelled by customer",
      destination_verification: "Confirmed through support ticket #123",
      destination_confirmed: true,
    });
    const post = (invoice: string, payload = body(), h = headers()) =>
      app.inject({
        method: "POST",
        url: `/admin/invoices/${invoice}/refunds`,
        headers: h,
        payload,
      });
    it("records finalized proof once and leaves payment, ledger and webhook unchanged", async () => {
      const before = (
        await pool.query(
          "SELECT invoice_version,status FROM invoices WHERE id=$1",
          [invoiceId],
        )
      ).rows;
      const ledger = (
        await pool.query("SELECT * FROM ledger_entries WHERE invoice_id=$1", [
          invoiceId,
        ])
      ).rows;
      const events = (
        await pool.query("SELECT * FROM webhook_events WHERE invoice_id=$1", [
          invoiceId,
        ])
      ).rows;
      const h = headers();
      const results = await Promise.all([
        post(invoiceId, body(), h),
        post(invoiceId, body(), h),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 201]);
      expect(results[0]!.json().id).toBe(results[1]!.json().id);
      expect(
        (
          await post(
            invoiceId,
            { ...body(), reason: "Different description" },
            h,
          )
        ).json().error,
      ).toBe("idempotency_conflict");
      expect(
        (
          await pool.query(
            "SELECT 1 FROM admin_audit_logs WHERE action='refund.confirmed'",
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await pool.query(
            "SELECT invoice_version,status FROM invoices WHERE id=$1",
            [invoiceId],
          )
        ).rows,
      ).toEqual(before);
      expect(
        (
          await pool.query("SELECT * FROM ledger_entries WHERE invoice_id=$1", [
            invoiceId,
          ])
        ).rows,
      ).toEqual(ledger);
      expect(
        (
          await pool.query("SELECT * FROM webhook_events WHERE invoice_id=$1", [
            invoiceId,
          ])
        ).rows,
      ).toEqual(events);
      vi.mocked(proof.verifyRefund).mockRejectedValueOnce(
        new Error("RPC offline"),
      );
      // A committed retry does not require RPC again.
      expect((await post(invoiceId, body(), h)).statusCode).toBe(200);
      expect((await post(invoiceId, body("3".repeat(88)))).statusCode).toBe(
        503,
      );
    });
    it("rejects repeated transaction instructions across invoice and project boundaries", async () => {
      const another = await createPaid();
      expect((await post(another)).json().error).toBe(
        "refund_proof_already_used",
      );
      expect(
        (
          await pool.query("SELECT 1 FROM manual_refunds WHERE invoice_id=$1", [
            another,
          ])
        ).rowCount,
      ).toBe(0);
    });
    it("serializes partial refunds and prevents exceeding credit under concurrency", async () => {
      const id = await createPaid();
      const results = await Promise.all([
        post(id, body("4".repeat(88), "0.700000")),
        post(id, body("5".repeat(88), "0.700000")),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.statusCode === 409)!.json().error).toBe(
        "refund_exceeds_payment",
      );
      expect(
        (
          await pool.query(
            "SELECT sum(amount)::text AS amount FROM manual_refunds WHERE invoice_id=$1",
            [id],
          )
        ).rows[0].amount,
      ).toBe("700000");
    });
    it("keeps mismatched, not-finalized and unavailable proofs out of records", async () => {
      vi.mocked(proof.verifyRefund).mockRejectedValueOnce(
        new proof.RefundProofMismatch(),
      );
      expect((await post(invoiceId, body("6".repeat(88)))).statusCode).toBe(
        422,
      );
      vi.mocked(proof.verifyRefund).mockRejectedValueOnce(new Error("pruned"));
      expect((await post(invoiceId, body("6".repeat(88)))).statusCode).toBe(
        503,
      );
      expect(
        (
          await pool.query("SELECT 1 FROM manual_refunds WHERE signature=$1", [
            "6".repeat(88),
          ])
        ).rowCount,
      ).toBe(0);
    });
    it("enforces role, fresh auth, CSRF and input validation", async () => {
      const url = `/admin/invoices/${invoiceId}/refunds`;
      expect(
        (
          await app.inject({
            method: "POST",
            url,
            payload: body(),
            headers: { "idempotency-key": randomUUID() },
          })
        ).statusCode,
      ).toBe(401);
      for (const role of [1, 2])
        expect((await post(invoiceId, body(), headers(role))).statusCode).toBe(
          403,
        );
      for (const overrides of [
        { origin: "https://evil.example" },
        { "x-csrf-token": "bad" },
      ])
        expect(
          (await post(invoiceId, body(), { ...headers(), ...overrides }))
            .statusCode,
        ).toBe(403);
      await pool.query(
        "UPDATE admin_sessions SET authenticated_at=now()-interval '11 minutes' WHERE object_id=$1",
        [ids[0]],
      );
      expect((await post(invoiceId)).json().error).toBe(
        "reauthentication_required",
      );
      await pool.query(
        "UPDATE admin_sessions SET authenticated_at=now() WHERE object_id=$1",
        [ids[0]],
      );
      for (const change of [
        { destination_confirmed: false },
        { amount: "0" },
        { amount: "-1" },
        { destination: "invalid" },
        { instruction_path: "01" },
        { reason: "          " },
      ])
        expect(
          (await post(invoiceId, { ...body(), ...change })).statusCode,
        ).toBe(400);
    });
    it("rejects concurrent reuse of one request identity across invoices atomically", async () => {
      const first = await createPaid(),
        second = await createPaid(),
        h = headers();
      const results = await Promise.all([
        post(first, body("7".repeat(88)), h),
        post(second, body("8".repeat(88)), h),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.statusCode === 409)!.json().error).toBe(
        "idempotency_conflict",
      );
      expect(
        (
          await pool.query("SELECT 1 FROM manual_refunds WHERE request_id=$1", [
            h["idempotency-key"],
          ])
        ).rowCount,
      ).toBe(1);
    });
    it("paginates tied timestamps without duplicate receipts and rejects a foreign cursor", async () => {
      const id = await createPaid();
      const template = (
        await pool.query(
          "SELECT id FROM manual_refunds WHERE invoice_id=$1 LIMIT 1",
          [invoiceId],
        )
      ).rows[0].id;
      await pool.query(
        `INSERT INTO manual_refunds(id,invoice_id,environment,cluster,asset,mint,source_account,destination,destination_account,amount,signature,instruction_path,slot,block_time,reason,destination_verification,tenant_id,object_id,request_id,request_hash,verified_at)
    SELECT gen_random_uuid(),$1,environment,cluster,asset,mint,source_account,destination,destination_account,1,'history-fixture-'||n,'0',slot,block_time,reason,destination_verification,tenant_id,object_id,gen_random_uuid(),'history-fixture','2026-10-17T00:00:00.123456Z' FROM manual_refunds CROSS JOIN generate_series(1,26)n WHERE id=$2`,
        [id, template],
      );
      const first = (
        await app.inject({
          url: `/admin/invoices/${id}/refunds`,
          headers: headers(),
        })
      ).json();
      expect(first.items).toHaveLength(25);
      expect(first.next_cursor).toBeTruthy();
      const next = (
        await app.inject({
          url: `/admin/invoices/${id}/refunds?before=${first.next_cursor}`,
          headers: headers(),
        })
      ).json();
      expect(next.items).toHaveLength(1);
      expect(next.next_cursor).toBeNull();
      expect(first.items.map((r: { id: string }) => r.id)).not.toContain(
        next.items[0].id,
      );
      expect(
        (
          await app.inject({
            url: `/admin/invoices/${invoiceId}/refunds?before=${first.next_cursor}`,
            headers: headers(),
          })
        ).statusCode,
      ).toBe(400);
    });
    it("scopes read and write, keeps pending invoices ineligible and lists totals for read-only", async () => {
      const pending = (
        await createInvoice(
          pool,
          projectId,
          "test",
          "localnet",
          randomUUID(),
          { order_id: randomUUID(), asset: "USDC", amount: "1" },
          true,
        )
      ).row;
      expect((await post(pending.id)).json().error).toBe(
        "refund_requires_paid_invoice",
      );
      await pool.query(
        "UPDATE invoices SET environment='staging' WHERE id=$1",
        [pending.id],
      );
      expect((await post(pending.id)).statusCode).toBe(404);
      expect(
        (
          await app.inject({
            url: `/admin/invoices/${pending.id}/refunds`,
            headers: headers(),
          })
        ).statusCode,
      ).toBe(404);
      const r = await app.inject({
        url: `/admin/invoices/${invoiceId}/refunds`,
        headers: headers(2),
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.json().items).toHaveLength(1);
      expect(r.json().totals).toEqual([{ asset: "USDC", amount: "0.100000" }]);
      expect(
        (
          await app.inject({
            url: `/admin/invoices/${invoiceId}/refunds?before=${randomUUID()}`,
            headers: headers(),
          })
        ).statusCode,
      ).toBe(400);
    });
  },
);
