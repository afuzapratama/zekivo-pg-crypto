import { describe, it, expect } from "vitest";
import type pg from "pg";
import {
  checkpointHealth,
  readOperations,
} from "../packages/auth/src/operations.js";
import {
  DEVNET_GENESIS,
  DEVNET_USDC_MINT,
  DEVNET_MOCK_USDT_MINT,
} from "../packages/solana/src/networks.js";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { SolanaRpc } from "../packages/solana/src/rpc.js";
const recipient = "GGQtua3Q7Sdr4K3eCvJA7kiHXCsTCgGBrm7FqoJsPEkk";
const tokens = [
  {
    asset: "USDC",
    mint: DEVNET_USDC_MINT,
    token_account: "CVJN54FDYAVo6ZVipWDuqKCXjeaQhWerMQMhoxw71HPz",
  },
  {
    asset: "USDT",
    mint: DEVNET_MOCK_USDT_MINT,
    token_account: "D5ngDGLnnyAHY8ounFfXVtHbSGGiCMNoK35HV7zQhXAD",
  },
].map((t) => ({
  ...t,
  environment: "staging",
  cluster: "devnet",
  recipient,
  genesis_hash: DEVNET_GENESIS,
  decimals: 6,
}));
function fixture(
  options: {
    genesis?: string;
    decimals?: number;
    missing?: boolean;
    failure?: boolean;
  } = {},
) {
  const pool = {
    async query(sql: string) {
      return {
        rows: sql.includes("token_configs")
          ? tokens
          : options.missing
            ? []
            : tokens.map((t) => ({
                token_account: t.token_account,
                scanned_through_slot: "990",
                updated_at: new Date(),
              })),
      };
    },
  } as unknown as pg.Pool;
  const rpc: Pick<SolanaRpc, "call"> = {
    async call<T>(method: string, params: unknown[] = []): Promise<T> {
      let value: unknown;
      if (method === "getGenesisHash")
        value = options.genesis ?? DEVNET_GENESIS;
      else if (method === "getAccountInfo") {
        const mint = tokens.find((t) => t.mint === params[0]);
        const ata = tokens.find((t) => t.token_account === params[0]);
        value = {
          value: {
            owner: TOKEN_PROGRAM_ADDRESS,
            data: {
              parsed: mint
                ? { type: "mint", info: { decimals: 6, isInitialized: true } }
                : {
                    type: "account",
                    info: {
                      owner: recipient,
                      mint: ata?.mint,
                      state: "initialized",
                    },
                  },
            },
          },
        };
      } else if (method === "getTokenAccountBalance") {
        if (options.failure) throw new Error("RPC timeout");
        value = {
          value: { amount: "1000001", decimals: options.decimals ?? 6 },
        };
      } else if (method === "getSlot") value = 1000;
      else throw new Error(`Unexpected ${method}`);
      return value as T;
    },
  };
  return { pool, rpc };
}
const scope = {
  APP_ENV: "staging",
  SOLANA_CLUSTER: "devnet",
  ENABLED_ASSETS: "USDT,USDC",
  CHAIN_MONITORING: "true",
};
describe("admin operational data", () => {
  it("distinguishes current, lagging, unknown and disabled without estimating slot duration", () => {
    const now = Date.now();
    expect(
      checkpointHealth(1000, "990", new Date(now - 5000), true, now),
    ).toMatchObject({ state: "current", lag_slots: "10", age_seconds: 5 });
    expect(
      checkpointHealth(1000, "990", new Date(now - 121000), true, now).state,
    ).toBe("lagging");
    expect(checkpointHealth(1000, "600", new Date(now), true, now).state).toBe(
      "lagging",
    );
    expect(checkpointHealth(1000, "1001", new Date(now), true, now).state).toBe(
      "unknown",
    );
    expect(checkpointHealth(1000, null, null, true, now).state).toBe("unknown");
    expect(checkpointHealth(1000, "990", new Date(now), false, now).state).toBe(
      "disabled",
    );
  });
  it("reads verified canonical token accounts and keeps balances separate per asset", async () => {
    const { pool, rpc } = fixture();
    const result = await readOperations(pool, rpc, scope);
    expect(result.wallets.map((w) => [w.asset, w.balance, w.state])).toEqual([
      ["USDC", "1.000001", "current"],
      ["USDT", "1.000001", "current"],
    ]);
    expect(result.finalized_head).toBe("1000");
    expect(result.wallets[0]?.lag_slots).toBe("10");
  });
  it("fails closed on wrong chain, invalid decimals and RPC errors without replacing balance with zero", async () => {
    for (const options of [
      { genesis: "wrong" },
      { decimals: 9 },
      { failure: true },
    ]) {
      const { pool, rpc } = fixture(options);
      await expect(readOperations(pool, rpc, scope)).rejects.toThrow();
    }
  });
  it("marks missing checkpoint unknown while preserving verified balance", async () => {
    const { pool, rpc } = fixture({ missing: true });
    const result = await readOperations(pool, rpc, scope);
    expect(
      result.wallets.every(
        (w) =>
          w.state === "unknown" &&
          w.balance === "1.000001" &&
          w.checkpoint_slot === null,
      ),
    ).toBe(true);
  });
});
