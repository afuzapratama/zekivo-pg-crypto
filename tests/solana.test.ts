import { describe, it, expect } from "vitest";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  decodeTransfers,
  type ParsedTransaction,
  type TokenConfig,
} from "../packages/solana/src/decode.js";
import { assertLocalRpc } from "../packages/solana/src/rpc.js";
const config: TokenConfig = {
  environment: "test",
  cluster: "localnet",
  asset: "USDT",
  mint: "mint",
  recipient: "owner",
  token_account: "ata",
  genesis_hash: "genesis",
  decimals: 6,
};
function transaction(): ParsedTransaction {
  return {
    slot: 100,
    blockTime: 1700000000,
    meta: {
      err: null,
      postTokenBalances: [{ accountIndex: 0, mint: "mint", owner: "owner" }],
    },
    transaction: {
      message: {
        accountKeys: [{ pubkey: "ata" }, { pubkey: "reference" }],
        instructions: [
          {
            programId: TOKEN_PROGRAM_ADDRESS,
            parsed: {
              type: "transferChecked",
              info: {
                source: "senderAta",
                destination: "ata",
                mint: "mint",
                tokenAmount: { amount: "25000001", decimals: 6 },
              },
            },
          },
        ],
      },
    },
  };
}
describe("SPL transfer decoding", () => {
  it("does not silently skip undecodable token instructions", () => {
    const tx = transaction();
    delete tx.transaction.message.instructions[0]!.parsed;
    expect(() => decodeTransfers(tx, [config])).toThrow(
      "Unparsed token instruction",
    );
  });
  it("extracts exact raw amounts and transaction references", () => {
    const transfers = decodeTransfers(transaction(), [config]);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.amount).toBe(25000001n);
    expect(transfers[0]?.references).toContain("reference");
  });
  it("ignores failed transactions and unrelated programs", () => {
    const tx = transaction();
    tx.meta!.err = { InstructionError: [0, "failure"] };
    expect(decodeTransfers(tx, [config])).toEqual([]);
    const fake = transaction();
    fake.transaction.message.instructions[0]!.programId = "fake";
    expect(decodeTransfers(fake, [config])).toEqual([]);
  });
  it("rejects inconsistent mint/owner/decimals rather than advancing silently", () => {
    for (const field of ["mint", "owner"] as const) {
      const tx = transaction();
      tx.meta!.postTokenBalances![0]![field] = "fake";
      expect(() => decodeTransfers(tx, [config])).toThrow();
    }
    const tx = transaction();
    tx.transaction.message.instructions[0]!.parsed!.info.tokenAmount = {
      amount: "10",
      decimals: 9,
    };
    expect(() => decodeTransfers(tx, [config])).toThrow();
  });
  it("handles inner transfers and unchecked transfers from verified balance metadata", () => {
    const tx = transaction();
    const ix = tx.transaction.message.instructions.pop()!;
    ix.parsed = {
      type: "transfer",
      info: { source: "senderAta", destination: "ata", amount: "17" },
    };
    tx.meta!.innerInstructions = [{ index: 0, instructions: [ix] }];
    expect(decodeTransfers(tx, [config])[0]).toMatchObject({
      path: "0.0",
      amount: 17n,
      mint: "mint",
    });
  });
  it("does not credit a self-transfer", () => {
    const tx = transaction();
    tx.transaction.message.instructions[0]!.parsed!.info.source = "ata";
    expect(decodeTransfers(tx, [config])).toEqual([]);
  });
  it("fails closed when execution metadata or block time is missing", () => {
    const tx = transaction();
    tx.blockTime = null;
    expect(() => decodeTransfers(tx, [config])).toThrow();
    const noMeta = transaction();
    noMeta.meta = null;
    expect(() => decodeTransfers(noMeta, [config])).toThrow();
  });
});
it("local fixture tools reject public endpoints and non-local environments", () => {
  expect(() =>
    assertLocalRpc("https://api.mainnet-beta.solana.com", "local", "localnet"),
  ).toThrow();
  expect(() =>
    assertLocalRpc("http://localhost:8899", "staging", "devnet"),
  ).toThrow();
  expect(() =>
    assertLocalRpc("http://127.0.0.1:8899", "local", "localnet"),
  ).not.toThrow();
});
