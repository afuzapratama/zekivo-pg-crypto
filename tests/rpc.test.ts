import { afterEach, describe, expect, it, vi } from "vitest";
import { SolanaRpc } from "../packages/solana/src/rpc.js";
import { validateConfigs } from "../packages/solana/src/watcher.js";
import { DEVNET } from "../packages/devnet/src/setup.js";
import { assertEnabledAssets } from "../packages/solana/src/networks.js";
afterEach(() => vi.unstubAllGlobals());
describe("read-only RPC resilience", () => {
  it("retries throttled reads and honors Retry-After", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("limited", {
          status: 429,
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ result: 123 }));
    vi.stubGlobal("fetch", mock);
    expect(
      await new SolanaRpc("https://example.com", {
        minIntervalMs: 0,
        backoffMs: 1,
      }).call("getSlot"),
    ).toBe(123);
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("never retries an ambiguous send or airdrop", async () => {
    const mock = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", mock);
    const rpc = new SolanaRpc("https://example.com", {
      minIntervalMs: 0,
      backoffMs: 1,
    });
    await expect(rpc.call("sendTransaction", ["signed"])).rejects.toThrow(
      "transport unavailable",
    );
    await expect(rpc.call("requestAirdrop", ["payer", 1])).rejects.toThrow(
      "transport unavailable",
    );
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("does not retry malformed RPC requests or ignore long server cooldowns", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { code: -32602, message: "invalid params" } }),
      )
      .mockResolvedValueOnce(
        new Response("limited", {
          status: 429,
          headers: { "retry-after": "120" },
        }),
      );
    vi.stubGlobal("fetch", mock);
    const rpc = new SolanaRpc("https://example.com", {
      minIntervalMs: 0,
      backoffMs: 1,
    });
    await expect(rpc.call("getSlot")).rejects.toThrow("invalid params");
    await expect(rpc.call("getSlot")).rejects.toThrow("retry later");
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("serializes parallel reads even after a failed request", async () => {
    let inFlight = 0,
      max = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        max = Math.max(max, ++inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        return Response.json({ result: 1 });
      }),
    );
    const rpc = new SolanaRpc("https://example.com", { minIntervalMs: 0 });
    await Promise.all([rpc.call("getSlot"), rpc.call("getBalance")]);
    expect(max).toBe(1);
  });
  it("defaults to two tokens, and allows an explicit USDC-only stage", () => {
    expect(() => assertEnabledAssets([{ asset: "USDC" }])).toThrow();
    expect(() =>
      assertEnabledAssets([{ asset: "USDC" }], "USDC"),
    ).not.toThrow();
    expect(() =>
      assertEnabledAssets([{ asset: "USDC" }, { asset: "USDT" }], "USDC"),
    ).toThrow();
  });
  it("pins both Devnet genesis and Circle USDC before trusting account data", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: "wrong-genesis" }))
      .mockResolvedValueOnce(Response.json({ result: DEVNET.genesis }))
      .mockResolvedValueOnce(Response.json({ result: DEVNET.genesis }));
    vi.stubGlobal("fetch", mock);
    const token = {
      environment: "staging",
      cluster: "devnet",
      asset: "USDC",
      mint: DEVNET.mint,
      recipient: DEVNET.recipient,
      token_account: "CVJN54FDYAVo6ZVipWDuqKCXjeaQhWerMQMhoxw71HPz",
      genesis_hash: DEVNET.genesis,
      decimals: 6,
    };
    const rpc = new SolanaRpc("https://example.com", { minIntervalMs: 0 });
    await expect(validateConfigs(rpc, [token])).rejects.toThrow(
      "pinned mint mismatch",
    );
    await expect(
      validateConfigs(rpc, [{ ...token, mint: DEVNET.recipient }]),
    ).rejects.toThrow("pinned mint mismatch");
    await expect(
      validateConfigs(rpc, [{ ...token, asset: "USDT" }]),
    ).rejects.toThrow("pinned mint mismatch");
    expect(mock).toHaveBeenCalledTimes(3);
  });
});
