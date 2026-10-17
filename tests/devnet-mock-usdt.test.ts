import { describe, it, expect } from "vitest";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
} from "@solana/kit";
import { MockUsdtSetup } from "../packages/devnet/src/mock-usdt.js";
import { DEVNET } from "../packages/devnet/src/setup.js";
async function fixture(genesis: string = DEVNET.genesis) {
  const methods: string[] = [];
  const signer = await createKeyPairSignerFromPrivateKeyBytes(
    new Uint8Array(32).fill(91),
  );
  const rpc = {
    async call<T>(method: string): Promise<T> {
      methods.push(method);
      const values: Record<string, unknown> = {
        getGenesisHash: genesis,
        getMultipleAccounts: { value: [null, null, null] },
        getMinimumBalanceForRentExemption: 2_000_000,
        getLatestBlockhash: {
          value: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 100,
          },
        },
        getFeeForMessage: { value: 10_000 },
        getBalance: { value: 5_000_000_000 },
        simulateTransaction: { value: { err: null } },
      };
      if (!(method in values)) throw new Error(`Unexpected RPC ${method}`);
      return values[method] as T;
    },
  };
  return {
    setup: new MockUsdtSetup(
      rpc,
      signer,
      `/tmp/zekivo-mock-unsubmitted-${crypto.randomUUID()}.json`,
    ),
    methods,
    signer,
  };
}
describe("Mock USDT operator", () => {
  it("fails closed outside Devnet and for an unexpected buyer", async () => {
    const { setup, methods } = await fixture("mainnet");
    await expect(setup.prepare(DEVNET.recipient)).rejects.toThrow(
      "buyer wallet",
    );
    expect(methods).toEqual([]);
    await expect(setup.prepare(DEVNET.payer)).rejects.toThrow(
      "not Solana Devnet",
    );
    expect(methods).toEqual(["getGenesisHash"]);
  });
  it("partially signs only the new mint and simulates without broadcasting", async () => {
    const { setup, methods, signer } = await fixture();
    const prepared = await setup.prepare(DEVNET.payer);
    const tx = getTransactionDecoder().decode(
      Buffer.from(prepared.transaction, "base64"),
    );
    expect(tx.signatures[signer.address]?.some((b) => b !== 0)).toBe(true);
    expect(tx.signatures[DEVNET.payer]).toBeNull();
    const message = getCompiledTransactionMessageDecoder().decode(
      tx.messageBytes,
    );
    if (message.version !== 0) throw new Error("Expected v0");
    expect(message.instructions).toHaveLength(7);
    expect(prepared.rent_lamports + prepared.fee_lamports).toBe(6_010_000);
    expect(
      Buffer.from(prepared.transaction, "base64").length,
    ).toBeLessThanOrEqual(1232);
    expect(methods).toContain("simulateTransaction");
    expect(methods).not.toContain("sendTransaction");
    await expect(
      setup.submit(prepared.id, prepared.transaction),
    ).rejects.toThrow("Buyer signature missing");
  });
});
