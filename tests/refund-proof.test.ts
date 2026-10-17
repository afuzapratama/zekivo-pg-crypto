import { describe, it, expect, vi } from "vitest";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { address } from "@solana/kit";
import {
  verifyRefund,
  RefundProofMismatch,
} from "../packages/solana/src/refund.js";
import type {
  ParsedTransaction,
  TokenConfig,
} from "../packages/solana/src/decode.js";
import { validateConfigs } from "../packages/solana/src/watcher.js";
vi.mock("../packages/solana/src/watcher.js", () => ({
  validateConfigs: vi.fn(async () => {}),
}));
const owner = "GGQtua3Q7Sdr4K3eCvJA7kiHXCsTCgGBrm7FqoJsPEkk",
  buyer = "3toF4H23Winv3CehGrxW7CaqMuFcbQVRfaDoa8upVLkt",
  mint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const [source] = await findAssociatedTokenPda({
  owner: address(owner),
  mint: address(mint),
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
});
const [dest] = await findAssociatedTokenPda({
  owner: address(buyer),
  mint: address(mint),
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
});
const config: TokenConfig = {
  environment: "staging",
  cluster: "devnet",
  asset: "USDC",
  mint,
  recipient: owner,
  token_account: source,
  genesis_hash: "fixture",
  decimals: 6,
};
const input = {
  destination: buyer,
  amount: 1000000n,
  signature: "2".repeat(88),
  path: "0",
  createdAt: new Date("2026-01-01"),
};
function tx(): ParsedTransaction {
  return {
    slot: 123,
    blockTime: 1790000000,
    meta: {
      err: null,
      preTokenBalances: [
        { accountIndex: 0, mint, owner },
        { accountIndex: 1, mint, owner: buyer },
      ],
      postTokenBalances: [],
    },
    transaction: {
      message: {
        accountKeys: [source, dest],
        instructions: [
          {
            programId: TOKEN_PROGRAM_ADDRESS,
            parsed: {
              type: "transferChecked",
              info: {
                source,
                destination: dest,
                mint,
                tokenAmount: { amount: "1000000", decimals: 6 },
              },
            },
          },
        ],
      },
    },
  };
}
const rpc = (value: ParsedTransaction | null) => ({
  call: vi.fn(async () => value) as never,
});
describe("manual refund finalized proof", () => {
  it("requires validated treasury configuration and exact finalized instruction", async () => {
    const r = rpc(tx());
    expect(await verifyRefund(r, config, input)).toMatchObject({
      destination_account: dest,
      slot: "123",
    });
    expect(validateConfigs).toHaveBeenCalledWith(r, [config]);
    expect(r.call).toHaveBeenCalledWith("getTransaction", [
      input.signature,
      {
        encoding: "jsonParsed",
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      },
    ]);
  });
  it("supports an exact inner transfer instruction", async () => {
    const t = tx();
    const ix = t.transaction.message.instructions[0]!;
    t.transaction.message.instructions = [];
    t.meta!.innerInstructions = [{ index: 2, instructions: [ix] }];
    expect(
      await verifyRefund(rpc(t), config, { ...input, path: "2.0" }),
    ).toMatchObject({ slot: "123" });
  });
  it.each([
    "amount",
    "source",
    "mint",
    "owner",
    "destination",
    "failed",
    "predates",
    "path",
    "decimals",
  ])("rejects mismatched %s", async (kind) => {
    const t = tx(),
      ix = t.transaction.message.instructions[0]!.parsed!.info;
    switch (kind) {
      case "amount":
        (ix.tokenAmount as { amount: string }).amount = "999999";
        break;
      case "source":
        ix.source = dest;
        break;
      case "mint":
        ix.mint = source;
        break;
      case "owner":
        t.meta!.preTokenBalances![0]!.owner = buyer;
        break;
      case "destination":
        ix.destination = source;
        break;
      case "failed":
        t.meta!.err = { InstructionError: [0, "failure"] };
        break;
      case "predates":
        t.blockTime = 1;
        break;
      case "decimals":
        (ix.tokenAmount as { decimals: number }).decimals = 9;
        break;
    }
    await expect(
      verifyRefund(rpc(t), config, {
        ...input,
        path: kind === "path" ? "1" : "0",
      }),
    ).rejects.toBeInstanceOf(RefundProofMismatch);
  });
  it("rejects a transfer back to the treasury itself", async () => {
    await expect(
      verifyRefund(rpc(tx()), config, { ...input, destination: owner }),
    ).rejects.toBeInstanceOf(RefundProofMismatch);
  });
  it("keeps pruned, missing metadata and RPC failure unavailable", async () => {
    await expect(
      verifyRefund(rpc(null), config, input),
    ).rejects.not.toBeInstanceOf(RefundProofMismatch);
    const t = tx();
    t.meta = null;
    await expect(
      verifyRefund(rpc(t), config, input),
    ).rejects.not.toBeInstanceOf(RefundProofMismatch);
    await expect(
      verifyRefund(
        { call: vi.fn().mockRejectedValue(new Error("offline")) },
        config,
        input,
      ),
    ).rejects.toThrow("offline");
  });
});
