import { readFile, readdir } from "node:fs/promises";
import { expireInvoices } from "../packages/database/src/expire.js";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool } from "../packages/database/src/pool.js";
import { createInvoice } from "../packages/database/src/invoices.js";
import { settleTransfer } from "../packages/database/src/settle.js";
import type {
  TokenConfig,
  DecodedTransfer,
} from "../packages/solana/src/decode.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "webhook lifecycle atomic state transitions",
  () => {
    const root = createPool(databaseUrl!);
    const schema = `lifecycle_${randomUUID().replaceAll("-", "")}`;
    const database = new URL(databaseUrl ?? "postgres://unused@localhost/test");
    database.searchParams.set("options", `-c search_path=${schema}`);
    const pool = createPool(database.href);
    const project = randomUUID();
    const suffix = randomUUID();
    const configs: TokenConfig[] = ["USDT", "USDC"].map((asset) => ({
      environment: "test",
      cluster: "localnet",
      asset,
      mint: `mint-${asset}-${suffix}`,
      recipient: `receiver-${suffix}`,
      token_account: `ata-${asset}-${suffix}`,
      genesis_hash: "test-genesis",
      decimals: 6,
    }));
    beforeAll(async () => {
      await root.query(`CREATE SCHEMA ${schema}`);
      for (const file of (await readdir("packages/database/migrations"))
        .filter((f) => f.endsWith(".sql"))
        .sort())
        await pool.query(
          await readFile(`packages/database/migrations/${file}`, "utf8"),
        );
      await pool.query(
        "INSERT INTO projects(id,name,environment) VALUES($1,'Settlement test','test')",
        [project],
      );
      for (const c of configs)
        await pool.query(
          "INSERT INTO token_configs VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            c.environment,
            c.cluster,
            c.asset,
            c.mint,
            c.recipient,
            c.token_account,
            c.genesis_hash,
            c.decimals,
          ],
        );
    });
    afterAll(async () => {
      await pool.end();
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
    });
    async function invoice(asset = "USDT") {
      return (
        await createInvoice(
          pool,
          project,
          "test",
          "localnet",
          randomUUID(),
          {
            order_id: randomUUID(),
            asset: asset as "USDT" | "USDC",
            amount: "32",
          },
          true,
        )
      ).row;
    }
    function transfer(
      row: Record<string, unknown>,
      references: string[] = [String(row.reference)],
    ): DecodedTransfer {
      return {
        path: "0",
        mint: String(row.mint),
        destination: configs.find((c) => c.mint === row.mint)!.token_account,
        amount: BigInt(String(row.payable_units)),
        references,
        blockTime: Math.ceil(Date.now() / 1000),
        slot: 123,
      };
    }
    async function state(id: string) {
      return (await pool.query("SELECT status FROM invoices WHERE id=$1", [id]))
        .rows[0].status;
    }

    const scope = { APP_ENV: "test", SOLANA_CLUSTER: "localnet" };
    const events = async (id: string) =>
      (
        await pool.query(
          "SELECT event_type,payload FROM webhook_events WHERE invoice_id=$1 ORDER BY (payload->'data'->>'invoice_version')::int",
          [id],
        )
      ).rows;
    it("emits each finalized partial/overpaid observation once with unique transfer and monotonic version", async () => {
      const row = await invoice();
      for (const [delta, eventType] of [
        [-1n, "payment.partial"],
        [-2n, "payment.partial"],
        [1n, "payment.overpaid"],
      ] as const) {
        const t = transfer(row);
        t.amount += delta;
        const sig = randomUUID();
        await Promise.all([
          settleTransfer(pool, configs[0]!, sig, t),
          settleTransfer(pool, configs[0]!, sig, t),
        ]);
        expect((await events(row.id)).at(-1)!.event_type).toBe(eventType);
      }
      const all = await events(row.id);
      expect(all.map((e) => e.payload.data.invoice_version)).toEqual([2, 3, 4]);
      expect(new Set(all.map((e) => e.payload.data.transfer_id)).size).toBe(3);
      expect(all[0]!.payload.data).toMatchObject({
        reason: "partial",
        asset: "USDT",
        received_asset: "USDT",
        finality: "finalized",
        invoice_status: "pending",
      });
      expect(await state(row.id)).toBe("pending");
      expect(
        (
          await pool.query("SELECT 1 FROM ledger_entries WHERE invoice_id=$1", [
            row.id,
          ])
        ).rowCount,
      ).toBe(0);
    });
    it("keeps unmatched and ambiguous reference transfers internal", async () => {
      const a = await invoice(),
        b = await invoice();
      const unmatched = transfer(a, []);
      unmatched.amount = 1n;
      await settleTransfer(pool, configs[0]!, randomUUID(), unmatched);
      await settleTransfer(
        pool,
        configs[0]!,
        randomUUID(),
        transfer(a, [a.reference, b.reference]),
      );
      expect(await events(a.id)).toHaveLength(0);
      expect(await events(b.id)).toHaveLength(0);
    });
    it("emits reference conflict as review with expected and received token data", async () => {
      const row = await invoice();
      const t = transfer(row);
      t.mint = configs[1]!.mint;
      t.destination = configs[1]!.token_account;
      await settleTransfer(pool, configs[1]!, randomUUID(), t);
      expect((await events(row.id))[0]).toMatchObject({
        event_type: "payment.review_required",
        payload: {
          data: {
            reason: "reference_conflict",
            asset: "USDT",
            received_asset: "USDC",
            mint: configs[0]!.mint,
            received_mint: configs[1]!.mint,
            invoice_version: 2,
          },
        },
      });
    });
    it("atomically expires only this scope and emits expiry exactly once across workers", async () => {
      const row = await invoice();
      await pool.query(
        "UPDATE invoices SET expires_at=now()-interval '2 seconds' WHERE id=$1",
        [row.id],
      );
      await Promise.all([
        expireInvoices(pool, scope),
        expireInvoices(pool, scope),
      ]);
      expect(await state(row.id)).toBe("expired");
      const all = await events(row.id);
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        event_type: "payment.expired",
        payload: {
          data: {
            invoice_version: 2,
            invoice_status: "expired",
            transfers: [],
          },
        },
      });
      expect(
        (
          await expireInvoices(pool, {
            APP_ENV: "other",
            SOLANA_CLUSTER: "localnet",
          })
        ).rowCount,
      ).toBe(0);
    });
    it("allows on-time finalized payment discovered after expiry, then review without downgrading paid", async () => {
      const row = await invoice();
      await pool.query(
        "UPDATE invoices SET created_at=now()-interval '20 seconds',expires_at=now()-interval '2 seconds' WHERE id=$1",
        [row.id],
      );
      await pool.query(
        "UPDATE payment_attempts SET activated_at=now()-interval '20 seconds' WHERE invoice_id=$1",
        [row.id],
      );
      const t = transfer(row);
      t.blockTime = Math.floor(Date.now() / 1000) - 5;
      await expireInvoices(pool, scope);
      await settleTransfer(pool, configs[0]!, randomUUID(), t);
      await settleTransfer(pool, configs[0]!, randomUUID(), t);
      const all = await events(row.id);
      expect(all.map((e) => e.event_type)).toEqual([
        "payment.expired",
        "payment.confirmed",
        "payment.review_required",
      ]);
      expect(all.map((e) => e.payload.data.invoice_version)).toEqual([2, 3, 4]);
      expect(all[2]!.payload.data).toMatchObject({
        reason: "duplicate_payment",
        invoice_status: "paid",
      });
      expect(await state(row.id)).toBe("paid");
      expect(
        (
          await pool.query("SELECT 1 FROM ledger_entries WHERE invoice_id=$1", [
            row.id,
          ])
        ).rowCount,
      ).toBe(1);
    });
    it("serializes expiry/payment races and reports truly late transfers without credits", async () => {
      const row = await invoice();
      await pool.query(
        "UPDATE invoices SET expires_at=now()-interval '2 seconds' WHERE id=$1",
        [row.id],
      );
      const t = transfer(row);
      await Promise.all([
        expireInvoices(pool, scope),
        settleTransfer(pool, configs[0]!, randomUUID(), t),
      ]);
      const all = await events(row.id);
      expect(all.map((e) => e.event_type).sort()).toEqual([
        "payment.expired",
        "payment.late",
      ]);
      expect(all.map((e) => e.payload.data.invoice_version)).toEqual([2, 3]);
      expect(await state(row.id)).toBe("expired");
      expect(
        (
          await pool.query("SELECT 1 FROM ledger_entries WHERE invoice_id=$1", [
            row.id,
          ])
        ).rowCount,
      ).toBe(0);
    });
    it("rolls back transfer, version, ledger and expiry if outbox insert fails", async () => {
      const row = await invoice();
      await pool.query(
        "UPDATE invoices SET expires_at=now()-interval '1 second' WHERE id=$1",
        [row.id],
      );
      // A scoped trigger forces failure without affecting events from other test projects.
      const name = `fail_lifecycle_${suffix.replaceAll("-", "")}`;
      await pool.query(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.invoice_id='${row.id}'::uuid THEN RAISE EXCEPTION 'outbox fixture failure'; END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON webhook_events FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      try {
        await expect(expireInvoices(pool, scope)).rejects.toThrow(
          "outbox fixture failure",
        );
        expect(await state(row.id)).toBe("pending");
        const sig = randomUUID();
        await expect(
          settleTransfer(pool, configs[0]!, sig, transfer(row)),
        ).rejects.toThrow("outbox fixture failure");
        expect(
          (
            await pool.query(
              "SELECT 1 FROM chain_transfers WHERE signature=$1",
              [sig],
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await pool.query(
              "SELECT invoice_version FROM invoices WHERE id=$1",
              [row.id],
            )
          ).rows[0].invoice_version,
        ).toBe(1);
      } finally {
        await pool.query(`DROP TRIGGER ${name} ON webhook_events`);
        await pool.query(`DROP FUNCTION ${name}()`);
      }
    });
  },
);
