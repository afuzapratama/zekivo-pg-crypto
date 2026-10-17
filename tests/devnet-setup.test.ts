import { describe, expect, it, vi } from "vitest";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import { DEVNET, DevnetSetup } from "../packages/devnet/src/setup.js";

function fixture(
  options: {
    genesis?: string;
    token?: unknown;
    mint?: string;
    sendError?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const rpc = {
    async call<T>(method: string, params: unknown[] = []): Promise<T> {
      calls.push(method);
      let result: unknown;
      switch (method) {
        case "getGenesisHash":
          result = options.genesis ?? DEVNET.genesis;
          break;
        case "getAccountInfo":
          result = {
            value:
              params[0] === DEVNET.mint
                ? {
                    owner: TOKEN_PROGRAM_ADDRESS,
                    data: {
                      parsed: {
                        type: "mint",
                        info: { decimals: 6, isInitialized: true },
                      },
                    },
                  }
                : (options.token ?? null),
          };
          if (options.mint && params[0] === DEVNET.mint)
            result = { value: { owner: options.mint } };
          break;
        case "getLatestBlockhash":
          result = {
            value: {
              blockhash: "11111111111111111111111111111111",
              lastValidBlockHeight: 1234,
            },
          };
          break;
        case "getMinimumBalanceForRentExemption":
          result = 2_000_000;
          break;
        case "getFeeForMessage":
          result = { value: 5000 };
          break;
        case "getBalance":
          result = { value: 5_000_000_000 };
          break;
        case "sendTransaction":
          if (options.sendError) throw new Error("RPC timeout");
          result = "test-signature";
          break;
        default:
          throw new Error(`Unexpected RPC ${method}`);
      }
      return result as T;
    },
  };
  return { setup: new DevnetSetup(rpc), calls };
}

describe("Devnet receiving setup", () => {
  it("provides explicit priority settings so Phantom need not rewrite the signed message", async () => {
    const { setup } = fixture();
    const prepared = await setup.prepare(DEVNET.payer);
    const tx = getTransactionDecoder().decode(
      Buffer.from(prepared.transaction, "base64"),
    );
    const message = getCompiledTransactionMessageDecoder().decode(
      tx.messageBytes,
    );
    if (message.version !== 0) throw new Error("Expected setup transaction v0");
    expect(message.staticAccounts[0]).toBe(DEVNET.payer);
    expect(message.instructions).toHaveLength(3);
    const [limit, price, create] = message.instructions;
    expect(message.staticAccounts[limit!.programAddressIndex]).toBe(
      "ComputeBudget111111111111111111111111111111",
    );
    expect(Array.from(limit!.data!)).toEqual([2, 80, 195, 0, 0]);
    expect(message.staticAccounts[price!.programAddressIndex]).toBe(
      "ComputeBudget111111111111111111111111111111",
    );
    expect(Array.from(price!.data!)).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(message.staticAccounts[create!.programAddressIndex]).toBe(
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    );
  });
  it("rejects another cluster before inspecting or preparing accounts", async () => {
    const { setup, calls } = fixture({ genesis: "mainnet" });
    await expect(setup.prepare(DEVNET.payer)).rejects.toThrow(
      "not Solana Devnet",
    );
    expect(calls).toEqual(["getGenesisHash"]);
  });
  it("rejects unapproved payer and an invalid issuer account", async () => {
    const { setup, calls } = fixture();
    await expect(setup.prepare(DEVNET.recipient)).rejects.toThrow(
      "buyer wallet",
    );
    expect(calls).toEqual([]);
    await expect(
      fixture({ mint: "wrong-program" }).setup.inspect(),
    ).rejects.toThrow("mint validation");
  });
  it("rejects an ATA with the wrong owner", async () => {
    const token = {
      owner: TOKEN_PROGRAM_ADDRESS,
      data: {
        parsed: {
          type: "account",
          info: {
            mint: DEVNET.mint,
            owner: DEVNET.payer,
            state: "initialized",
          },
        },
      },
    };
    await expect(fixture({ token }).setup.inspect()).rejects.toThrow(
      "account validation",
    );
  });
  it("does not build another transaction once the canonical ATA is initialized", async () => {
    const token = {
      owner: TOKEN_PROGRAM_ADDRESS,
      data: {
        parsed: {
          type: "account",
          info: {
            mint: DEVNET.mint,
            owner: DEVNET.recipient,
            state: "initialized",
            tokenAmount: { amount: "0" },
          },
        },
      },
    };
    const { setup } = fixture({ token });
    expect((await setup.inspect()).ready).toBe(true);
    await expect(setup.prepare(DEVNET.payer)).rejects.toThrow("already ready");
  });
  it("requires an unchanged transaction and a buyer signature before broadcasting", async () => {
    const { setup, calls } = fixture();
    const prepared = await setup.prepare(DEVNET.payer);
    await expect(
      setup.submit(prepared.id, prepared.transaction),
    ).rejects.toThrow("signature missing");
    const tx = getTransactionDecoder().decode(
      Buffer.from(prepared.transaction, "base64"),
    );
    const altered = Uint8Array.from(tx.messageBytes);
    altered[altered.length - 1] = altered[altered.length - 1]! ^ 1;
    const tampered = getBase64EncodedWireTransaction({
      ...tx,
      messageBytes: altered as unknown as typeof tx.messageBytes,
    });
    await expect(setup.submit(prepared.id, tampered)).rejects.toThrow(
      "different transaction",
    );
    expect(calls).not.toContain("sendTransaction");
  });
  it("does not resend a signed request after an ambiguous RPC timeout", async () => {
    const { setup, calls } = fixture({ sendError: true });
    const prepared = await setup.prepare(DEVNET.payer);
    const tx = getTransactionDecoder().decode(
      Buffer.from(prepared.transaction, "base64"),
    );
    // Stub signature: the RPC fixture stands in for preflight signature verification.
    const signed = getBase64EncodedWireTransaction({
      ...tx,
      signatures: {
        ...tx.signatures,
        [DEVNET.payer]: new Uint8Array(64).fill(1),
      } as typeof tx.signatures,
    });
    await expect(setup.submit(prepared.id, signed)).rejects.toThrow(
      "RPC timeout",
    );
    await expect(setup.submit(prepared.id, signed)).rejects.toThrow(
      "already submitted",
    );
    expect(calls.filter((method) => method === "sendTransaction")).toHaveLength(
      1,
    );
  });
  it("rejects expired signing requests before broadcast", async () => {
    vi.useFakeTimers();
    try {
      const { setup, calls } = fixture();
      const prepared = await setup.prepare(DEVNET.payer);
      vi.advanceTimersByTime(91_000);
      await expect(
        setup.submit(prepared.id, prepared.transaction),
      ).rejects.toThrow("expired");
      expect(calls).not.toContain("sendTransaction");
    } finally {
      vi.useRealTimers();
    }
  });
});
