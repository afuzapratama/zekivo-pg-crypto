import {
  selectAsset,
  checkoutInvoice,
} from "../packages/database/src/checkout.js";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool } from "../packages/database/src/pool.js";
import { createInvoice } from "../packages/database/src/invoices.js";
import { settleTransfer } from "../packages/database/src/settle.js";
import { scanAccount } from "../packages/solana/src/watcher.js";
import { SolanaRpc } from "../packages/solana/src/rpc.js";
import type {
  TokenConfig,
  DecodedTransfer,
} from "../packages/solana/src/decode.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("finalized settlement and recovery", () => {
  const pool = createPool(databaseUrl!);
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
    await pool.query(
      "DELETE FROM webhook_events WHERE invoice_id IN (SELECT id FROM invoices WHERE project_id=$1)",
      [project],
    );
    await pool.query(
      "DELETE FROM ledger_entries WHERE invoice_id IN (SELECT id FROM invoices WHERE project_id=$1)",
      [project],
    );
    await pool.query("DELETE FROM chain_transfers WHERE mint=ANY($1::text[])", [
      configs.map((c) => c.mint),
    ]);
    await pool.query("DELETE FROM idempotency_records WHERE project_id=$1", [
      project,
    ]);
    await pool.query("DELETE FROM audit_logs WHERE project_id=$1", [project]);
    await pool.query("DELETE FROM invoices WHERE project_id=$1", [project]);
    await pool.query("DELETE FROM projects WHERE id=$1", [project]);
    for (const c of configs) {
      await pool.query("DELETE FROM scan_history_gaps WHERE token_account=$1", [
        c.token_account,
      ]);
      await pool.query("DELETE FROM scan_checkpoints WHERE token_account=$1", [
        c.token_account,
      ]);
      await pool.query("DELETE FROM token_configs WHERE mint=$1", [c.mint]);
    }
    await pool.end();
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
  it("commits paid, ledger and outbox exactly once under concurrent replay", async () => {
    const row = await invoice(),
      signature = randomUUID(),
      t = transfer(row);
    await Promise.all(
      Array.from({ length: 6 }, () =>
        settleTransfer(pool, configs[0]!, signature, t),
      ),
    );
    expect(await state(row.id)).toBe("paid");
    expect(
      (
        await pool.query("SELECT 1 FROM ledger_entries WHERE invoice_id=$1", [
          row.id,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query("SELECT 1 FROM webhook_events WHERE invoice_id=$1", [
          row.id,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it("matches a manual transfer by exact total", async () => {
    const row = await invoice("USDC");
    await settleTransfer(pool, configs[1]!, randomUUID(), transfer(row, []));
    expect(await state(row.id)).toBe("paid");
  });
  it("keeps a second payment as duplicate without a second ledger credit", async () => {
    const row = await invoice();
    await settleTransfer(pool, configs[0]!, randomUUID(), transfer(row));
    await settleTransfer(pool, configs[0]!, randomUUID(), transfer(row));
    expect(
      (
        await pool.query(
          "SELECT 1 FROM chain_transfers WHERE invoice_id=$1 AND disposition='duplicate_payment'",
          [row.id],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query("SELECT 1 FROM ledger_entries WHERE invoice_id=$1", [
          row.id,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it("does not pay partial, overpaid, late or predating transfers", async () => {
    for (const kind of ["partial", "overpaid", "late", "predates_invoice"]) {
      const row = await invoice(),
        t = transfer(row);
      if (kind === "partial") t.amount -= 1n;
      if (kind === "overpaid") t.amount += 1n;
      if (kind === "late")
        t.blockTime = Math.ceil(new Date(row.expires_at).getTime() / 1000) + 10;
      if (kind === "predates_invoice") t.blockTime -= 60;
      await settleTransfer(pool, configs[0]!, randomUUID(), t);
      expect(await state(row.id)).toBe("pending");
      expect(
        (
          await pool.query(
            "SELECT disposition FROM chain_transfers WHERE invoice_id=$1",
            [row.id],
          )
        ).rows[0].disposition,
      ).toBe(kind);
    }
  });
  it("does not fall back to amount matching when a different invoice reference exists", async () => {
    const a = await invoice(),
      b = await invoice("USDC");
    await settleTransfer(
      pool,
      configs[1]!,
      randomUUID(),
      transfer(b, [a.reference]),
    );
    expect(await state(a.id)).toBe("pending");
    expect(await state(b.id)).toBe("pending");
    expect(
      (
        await pool.query(
          "SELECT 1 FROM chain_transfers WHERE invoice_id=$1 AND disposition='reference_conflict'",
          [a.id],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("recovers an expired invoice if chain time proves payment before expiry", async () => {
    const row = await invoice();
    await pool.query("UPDATE invoices SET status='expired' WHERE id=$1", [
      row.id,
    ]);
    await settleTransfer(pool, configs[0]!, randomUUID(), transfer(row));
    expect(await state(row.id)).toBe("paid");
  });
  async function quotedInvoice() {
    return (
      await createInvoice(
        pool,
        project,
        "test",
        "localnet",
        randomUUID(),
        {
          order_id: randomUUID(),
          asset: "USDT",
          amount: "32",
          payment_options: [
            { asset: "USDT", amount: "32" },
            { asset: "USDC", amount: "31.9" },
          ],
        },
        true,
      )
    ).row;
  }
  async function attempts(id: string) {
    return (
      await pool.query(
        "SELECT * FROM payment_attempts WHERE invoice_id=$1 ORDER BY asset",
        [id],
      )
    ).rows;
  }
  it("keeps approved asset prices and reservations immutable across selection and switch-back", async () => {
    const row = await quotedInvoice(),
      before = await attempts(row.id);
    const usdc = before.find((a) => a.asset === "USDC")!;
    expect(usdc.activated_at).toBeNull();
    expect(usdc.base_units).toBe("31900000");
    const selected = await selectAsset(
      pool,
      row.checkout_token,
      "test",
      "localnet",
      "USDC",
      1,
    );
    expect(selected!.invoice_version).toBe(2);
    const view = await checkoutInvoice(
      pool,
      row.checkout_token,
      "test",
      "localnet",
      "http://localhost:3100",
    );
    expect(view).toMatchObject({
      asset: "USDC",
      amount: "31.900000",
      reference: usdc.reference,
    });
    expect(new Date(view!.expires_at as Date).getTime()).toBe(
      new Date(row.expires_at).getTime(),
    );
    await expect(
      selectAsset(pool, row.checkout_token, "test", "localnet", "USDT", 1),
    ).rejects.toThrow("changed");
    expect(
      (await selectAsset(
        pool,
        row.checkout_token,
        "test",
        "localnet",
        "USDC",
        2,
      ))!.invoice_version,
    ).toBe(2);
    await selectAsset(pool, row.checkout_token, "test", "localnet", "USDT", 2);
    expect(
      (await attempts(row.id)).map((a) => [
        a.id,
        a.reference,
        a.payable_units,
        a.expires_at,
      ]),
    ).toEqual(
      before.map((a) => [a.id, a.reference, a.payable_units, a.expires_at]),
    );
    expect(
      (await checkoutInvoice(
        pool,
        row.checkout_token,
        "test",
        "localnet",
        "http://localhost:3100",
      ))!.reference,
    ).toBe(row.reference);
  });
  it("accepts an already activated previous choice and reports the actual asset in the event", async () => {
    const row = await quotedInvoice();
    await selectAsset(pool, row.checkout_token, "test", "localnet", "USDC", 1);
    await settleTransfer(pool, configs[0]!, randomUUID(), transfer(row));
    const paid = (
      await pool.query("SELECT * FROM invoices WHERE id=$1", [row.id])
    ).rows[0];
    expect(paid).toMatchObject({
      status: "paid",
      asset: "USDT",
      invoice_version: 3,
    });
    const payload = (
      await pool.query(
        "SELECT payload FROM webhook_events WHERE invoice_id=$1",
        [row.id],
      )
    ).rows[0].payload;
    expect(payload.data).toMatchObject({
      asset: "USDT",
      invoice_version: 3,
      attempt_id: row.id,
    });
    await expect(
      selectAsset(pool, row.checkout_token, "test", "localnet", "USDC", 3),
    ).rejects.toThrow("closed");
  });
  it("serializes competing asset choices with optimistic versions", async () => {
    const row = await quotedInvoice();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        selectAsset(pool, row.checkout_token, "test", "localnet", "USDC", 1),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(5);
    expect(await attempts(row.id)).toHaveLength(2);
  });
  it("two different asset payments racing create only one credit and confirmed event", async () => {
    const row = await quotedInvoice();
    await selectAsset(pool, row.checkout_token, "test", "localnet", "USDC", 1);
    const usdc = (await attempts(row.id)).find((a) => a.asset === "USDC")!;
    await Promise.all([
      settleTransfer(pool, configs[0]!, randomUUID(), transfer(row)),
      settleTransfer(pool, configs[1]!, randomUUID(), transfer(usdc, [])),
    ]);
    expect(
      (
        await pool.query("SELECT * FROM ledger_entries WHERE invoice_id=$1", [
          row.id,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT * FROM webhook_events WHERE invoice_id=$1 AND event_type='payment.confirmed'",
          [row.id],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT disposition FROM chain_transfers WHERE invoice_id=$1 ORDER BY disposition",
          [row.id],
        )
      ).rows.map((r) => r.disposition),
    ).toEqual(["duplicate_payment", "paid"]);
  });
  it("cannot select unquoted assets or mutate a disabled/expired/review invoice", async () => {
    const fixed = await invoice();
    await expect(
      selectAsset(pool, fixed.checkout_token, "test", "localnet", "USDC", 1),
    ).rejects.toThrow("approved");
    expect(
      await selectAsset(
        pool,
        fixed.checkout_token,
        "other",
        "localnet",
        "USDT",
        1,
      ),
    ).toBeNull();
    for (const kind of ["disabled", "expired", "review"]) {
      const row = await quotedInvoice();
      if (kind === "disabled")
        await pool.query(
          "UPDATE invoices SET payment_enabled=false WHERE id=$1",
          [row.id],
        );
      if (kind === "expired")
        await pool.query(
          "UPDATE invoices SET expires_at=now()-interval '1 second' WHERE id=$1",
          [row.id],
        );
      if (kind === "review") {
        const t = transfer(row);
        t.amount -= 1n;
        await settleTransfer(pool, configs[0]!, randomUUID(), t);
      }
      await expect(
        selectAsset(
          pool,
          row.checkout_token,
          "test",
          "localnet",
          "USDC",
          kind === "review" ? 2 : 1,
        ),
      ).rejects.toThrow("closed");
    }
  });
  it("asset selection racing a finalized payment cannot overwrite paid or issue a second credit", async () => {
    const row = await quotedInvoice();
    const results = await Promise.allSettled([
      selectAsset(pool, row.checkout_token, "test", "localnet", "USDC", 1),
      settleTransfer(pool, configs[0]!, randomUUID(), transfer(row)),
    ]);
    expect(results[1]!.status).toBe("fulfilled");
    expect(
      (
        await pool.query("SELECT status,asset FROM invoices WHERE id=$1", [
          row.id,
        ])
      ).rows[0],
    ).toEqual({ status: "paid", asset: "USDT" });
    expect(
      (
        await pool.query("SELECT 1 FROM ledger_entries WHERE invoice_id=$1", [
          row.id,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it("does not settle an unactivated quote even with its exact amount", async () => {
    const row = await quotedInvoice(),
      usdc = (await attempts(row.id)).find((a) => a.asset === "USDC")!;
    await settleTransfer(pool, configs[1]!, randomUUID(), transfer(usdc, []));
    expect(await state(row.id)).toBe("pending");
    expect(
      (
        await pool.query(
          "SELECT disposition FROM chain_transfers WHERE invoice_id=$1",
          [row.id],
        )
      ).rows[0].disposition,
    ).toBe("inactive_attempt");
  });
  it("never reallocates an old choice's amount after switching away", async () => {
    const row = await quotedInvoice();
    await selectAsset(pool, row.checkout_token, "test", "localnet", "USDC", 1);
    const next = await invoice("USDT");
    expect(next.payable_units).not.toBe(row.payable_units);
    expect(
      (
        await pool.query(
          "SELECT payable_units FROM payment_attempts WHERE invoice_id=$1 AND asset='USDT'",
          [row.id],
        )
      ).rows[0].payable_units,
    ).toBe(row.payable_units);
  });
  it("does not advance a cursor when finalized transaction lookup is unavailable", async () => {
    const rpc = new SolanaRpc("http://localhost:1");
    const spy = vi
      .spyOn(rpc, "call")
      .mockImplementation(async (method) =>
        method === "getSlot"
          ? 100
          : method === "getFirstAvailableBlock"
            ? 0
            : method === "getSignaturesForAddress"
              ? [{ signature: "missing-tx", slot: 90, err: null }]
              : null,
      );
    await expect(scanAccount(pool, rpc, configs[0]!)).rejects.toThrow(
      "unavailable",
    );
    expect(
      (
        await pool.query(
          "SELECT 1 FROM scan_checkpoints WHERE token_account=$1",
          [configs[0]!.token_account],
        )
      ).rowCount,
    ).toBe(0);
    spy.mockRestore();
  });
});
