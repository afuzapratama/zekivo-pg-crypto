import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool } from "../packages/database/src/pool.js";
import { scanAccount } from "../packages/solana/src/watcher.js";
import { SolanaRpc } from "../packages/solana/src/rpc.js";
import type { TokenConfig } from "../packages/solana/src/decode.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("slot checkpoints and RPC retention", () => {
  const pool = createPool(url!);
  const accounts: string[] = [];
  function config(environment = "local"): TokenConfig {
    const c = {
      environment,
      cluster: "localnet",
      asset: "USDT",
      mint: "scanner-mint",
      recipient: "scanner-owner",
      token_account: `scanner-${randomUUID()}`,
      genesis_hash: "test",
      decimals: 6,
    };
    accounts.push(c.token_account);
    return c;
  }
  async function checkpoint(
    c: TokenConfig,
    slot: number | null,
    signature = "pruned-signature",
  ) {
    await pool.query(
      "INSERT INTO scan_checkpoints(environment,cluster,token_account,signature,scanned_through_slot) VALUES($1,$2,$3,$4,$5)",
      [c.environment, c.cluster, c.token_account, signature, slot],
    );
  }
  async function state(c: TokenConfig) {
    return (
      await pool.query(
        "SELECT * FROM scan_checkpoints WHERE token_account=$1",
        [c.token_account],
      )
    ).rows[0];
  }
  function rpc(
    head = 100,
    first = 0,
    history: { signature: string; slot: number; err: null }[] = [],
  ) {
    const client = new SolanaRpc("http://localhost:1");
    const spy = vi.spyOn(client, "call").mockImplementation(async (method) => {
      if (method === "getSlot") return head;
      if (method === "getFirstAvailableBlock") return first;
      if (method === "getSignatureStatuses") return { value: [null] };
      if (method === "getSignaturesForAddress") return history;
      if (method === "getTransaction")
        return {
          slot: history[0]!.slot,
          blockTime: 1700000000,
          meta: { err: null },
          transaction: { message: { accountKeys: [], instructions: [] } },
        };
      throw new Error(`Unexpected RPC ${method}`);
    });
    return { client, spy };
  }
  afterAll(async () => {
    await pool.query(
      "DELETE FROM scan_history_gaps WHERE token_account=ANY($1::text[])",
      [accounts],
    );
    await pool.query(
      "DELETE FROM scan_checkpoints WHERE token_account=ANY($1::text[])",
      [accounts],
    );
    await pool.end();
  });
  it("does not depend on a pruned signature when slot coverage is continuous", async () => {
    const c = config("test");
    await checkpoint(c, 90);
    const { client, spy } = rpc(100, 80, [
      { signature: "new", slot: 95, err: null },
    ]);
    const result = await scanAccount(pool, client, c);
    expect(result.historyGap).toBeUndefined();
    expect((await state(c)).scanned_through_slot).toBe("100");
    expect(
      spy.mock.calls.filter(([m]) => m === "getSignaturesForAddress")[0]![1],
    ).toEqual([
      c.token_account,
      { commitment: "finalized", limit: 100, minContextSlot: 100 },
    ]);
    expect(spy.mock.calls.some(([m]) => m === "getSignatureStatuses")).toBe(
      false,
    );
  });
  it("advances an idle account watermark even when there are no signatures", async () => {
    const c = config("test");
    await checkpoint(c, 80);
    await scanAccount(pool, rpc(100, 60).client, c);
    await scanAccount(pool, rpc(120, 95).client, c);
    expect((await state(c)).scanned_through_slot).toBe("120");
  });
  it("recovers retained local history from a pruned legacy signature and records the gap", async () => {
    const c = config();
    await checkpoint(c, null);
    const result = await scanAccount(
      pool,
      rpc(100, 50, [{ signature: "retained", slot: 95, err: null }]).client,
      c,
    );
    expect(result.historyGap).toEqual({
      previousSlot: null,
      firstAvailableSlot: 50,
    });
    expect((await state(c)).scanned_through_slot).toBe("100");
    expect(
      (
        await pool.query(
          "SELECT previous_signature,previous_slot FROM scan_history_gaps WHERE token_account=$1",
          [c.token_account],
        )
      ).rows[0],
    ).toEqual({ previous_signature: "pruned-signature", previous_slot: null });
  });
  it("records a known local history gap without deleting existing records", async () => {
    const c = config();
    await checkpoint(c, 10);
    expect(
      (await scanAccount(pool, rpc(100, 50).client, c)).historyGap
        ?.previousSlot,
    ).toBe(10);
    expect((await state(c)).signature).toBe("pruned-signature");
    expect(
      (
        await pool.query(
          "SELECT 1 FROM scan_history_gaps WHERE token_account=$1",
          [c.token_account],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("blocks gaps outside local sandbox without changing checkpoint", async () => {
    const c = config("test");
    await checkpoint(c, 10);
    await expect(scanAccount(pool, rpc(100, 50).client, c)).rejects.toThrow(
      "archive RPC",
    );
    expect((await state(c)).scanned_through_slot).toBe("10");
  });
  it("upgrades an available signature-only checkpoint using its actual slot", async () => {
    const c = config("test");
    await checkpoint(c, null);
    const { client, spy } = rpc(100, 0);
    spy.mockImplementation(async (method) =>
      method === "getSlot"
        ? 100
        : method === "getFirstAvailableBlock"
          ? 0
          : method === "getSignatureStatuses"
            ? { value: [{ slot: 90 }] }
            : [],
    );
    await scanAccount(pool, client, c);
    expect((await state(c)).scanned_through_slot).toBe("100");
  });
  it("does not advance past a missing transaction or failed pagination", async () => {
    for (const failure of ["getTransaction", "getSignaturesForAddress"]) {
      const c = config("test");
      await checkpoint(c, 80);
      const { client, spy } = rpc();
      spy.mockImplementation(async (method) => {
        if (method === failure) throw new Error("RPC unavailable");
        return method === "getSlot"
          ? 100
          : method === "getFirstAvailableBlock"
            ? 0
            : [{ signature: "new", slot: 95, err: null }];
      });
      await expect(scanAccount(pool, client, c)).rejects.toThrow(
        "RPC unavailable",
      );
      expect((await state(c)).scanned_through_slot).toBe("80");
    }
  });
  it("processes all pages and includes every transaction in the boundary slot", async () => {
    const c = config("test");
    await checkpoint(c, 90);
    const { client, spy } = rpc();
    const seen: string[] = [];
    spy.mockImplementation(async (method, params) => {
      if (method === "getSlot") return 200;
      if (method === "getFirstAvailableBlock") return 0;
      if (method === "getSignaturesForAddress") {
        const options = params![1] as { before?: string };
        return options.before
          ? [
              { signature: "same-slot-extra", slot: 90, err: null },
              { signature: "old", slot: 50, err: null },
            ]
          : Array.from({ length: 100 }, (_, i) => ({
              signature: `sig-${i}`,
              slot: 189 - i,
              err: null,
            }));
      }
      if (method === "getTransaction") {
        const sig = params![0] as string;
        seen.push(sig);
        return {
          slot: sig === "same-slot-extra" ? 90 : 189 - Number(sig.slice(4)),
          blockTime: 1700000000,
          meta: { err: null },
          transaction: { message: { accountKeys: [], instructions: [] } },
        };
      }
      throw new Error(method);
    });
    await scanAccount(pool, client, c);
    expect(seen).toHaveLength(101);
    expect(seen).toContain("same-slot-extra");
    expect(seen).not.toContain("old");
    expect((await state(c)).scanned_through_slot).toBe("200");
  });
  it("rejects a regressed finalized head without changing checkpoint", async () => {
    const c = config("test");
    await checkpoint(c, 150);
    await expect(scanAccount(pool, rpc(100, 0).client, c)).rejects.toThrow(
      "behind checkpoint",
    );
    expect((await state(c)).scanned_through_slot).toBe("150");
  });
});
