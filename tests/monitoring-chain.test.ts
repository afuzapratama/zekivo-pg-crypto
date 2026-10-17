import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  chainReader,
  type RecordedTransfer,
} from "../packages/monitoring/src/reconciliation.js";
import { probeApi } from "../packages/monitoring/src/status.js";
import type {
  TokenConfig,
  ParsedTransaction,
} from "../packages/solana/src/decode.js";
const config: TokenConfig = {
  environment: "test",
  cluster: "localnet",
  asset: "USDC",
  mint: "mint",
  recipient: "owner",
  token_account: "ata",
  genesis_hash: "genesis",
  decimals: 6,
};
const tx: ParsedTransaction = {
  slot: 123,
  blockTime: 1700000000,
  meta: {
    err: null,
    postTokenBalances: [{ accountIndex: 0, mint: "mint", owner: "owner" }],
  },
  transaction: {
    message: {
      accountKeys: ["ata"],
      instructions: [
        {
          programId: TOKEN_PROGRAM_ADDRESS,
          parsed: {
            type: "transferChecked",
            info: {
              source: "source",
              destination: "ata",
              mint: "mint",
              tokenAmount: { amount: "1000001", decimals: 6 },
            },
          },
        },
      ],
    },
  },
};
const row: RecordedTransfer = {
  id: "1",
  signature: "fixture-signature",
  instruction_path: "0",
  slot: "123",
  block_time: new Date(1700000000000),
  mint: "mint",
  destination: "ata",
  amount: "1000001",
};
afterEach(() => vi.restoreAllMocks());
describe("read-only chain reconciliation", () => {
  it("re-reads finalized instructions and checks amount, path, slot and destination", async () => {
    const call = vi.fn(async () => tx),
      reader = chainReader({ call } as unknown as Parameters<
        typeof chainReader
      >[0]);
    expect(await reader.verify(row, [config])).toBe("verified");
    expect(call).toHaveBeenCalledWith("getTransaction", [
      row.signature,
      {
        encoding: "jsonParsed",
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      },
    ]);
    for (const change of [
      { amount: "1000002" },
      { instruction_path: "1" },
      { slot: "124" },
      { block_time: new Date(1700000001000) },
    ])
      expect(await reader.verify({ ...row, ...change }, [config])).toBe(
        "mismatch",
      );
  });
  it("does not equate unavailable/pruned RPC history or missing metadata with a clean result", async () => {
    for (const data of [null, { ...tx, meta: null }]) {
      const reader = chainReader({
        call: async () => data,
      } as unknown as Parameters<typeof chainReader>[0]);
      expect(await reader.verify(row, [config])).toBe("unavailable");
    }
    const reader = chainReader({
      call: async () => {
        throw new Error("fixture provider offline");
      },
    });
    expect(await reader.verify(row, [config])).toBe("unavailable");
    expect(await reader.verify({ ...row, mint: "other-mint" }, [config])).toBe(
      "unavailable",
    );
  });
  it("rejects a failed transaction as mismatching stored paid evidence", async () => {
    const reader = chainReader({
      call: async () => ({
        ...tx,
        meta: { ...tx.meta!, err: { InstructionError: [0, "failure"] } },
      }),
    } as unknown as Parameters<typeof chainReader>[0]);
    expect(await reader.verify(row, [config])).toBe("mismatch");
  });
  it("probes API identity and rejects an unrelated environment or HTTP failure", async () => {
    const scope = { APP_ENV: "test", SOLANA_CLUSTER: "localnet" };
    const fetcher = vi.spyOn(globalThis, "fetch");
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          service: "api",
          status: "ok",
          environment: "test",
          cluster: "localnet",
        }),
      ),
    );
    expect(await probeApi("http://127.0.0.1:4100", scope)).toBe(true);
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          service: "api",
          status: "ok",
          environment: "staging",
          cluster: "devnet",
        }),
      ),
    );
    expect(await probeApi("http://127.0.0.1:4100", scope)).toBe(false);
    fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    expect(await probeApi("http://127.0.0.1:4100", scope)).toBe(false);
    fetcher.mockRejectedValueOnce(new Error("fixture network failure"));
    expect(await probeApi("http://127.0.0.1:4100", scope)).toBe(false);
  });
});
