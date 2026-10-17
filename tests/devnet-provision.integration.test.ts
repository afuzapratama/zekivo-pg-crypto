import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createPool } from "../packages/database/src/pool.js";
import { createInvoice } from "../packages/database/src/invoices.js";
import { provisionUsdc } from "../packages/devnet/src/provisioning.js";
import { DEVNET_MOCK_USDT_MINT } from "../packages/solana/src/networks.js";
import { DEVNET } from "../packages/devnet/src/setup.js";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { SolanaRpc } from "../packages/solana/src/rpc.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("isolated Devnet initial scan boundary", () => {
  const admin = createPool(url!);
  const schema = `devnet_test_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url ?? "postgres://unused@localhost/gateway_test");
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  const pool = createPool(parsed.href);
  const project = randomUUID();
  let head = 100;
  let balance = "0";
  const rpc: Pick<SolanaRpc, "call"> = {
    async call<T>(method: string, params: unknown[] = []): Promise<T> {
      let result: unknown;
      if (method === "getGenesisHash") result = DEVNET.genesis;
      else if (method === "getMultipleAccounts")
        result = {
          value: [
            {
              owner: TOKEN_PROGRAM_ADDRESS,
              data: {
                parsed: {
                  type: "mint",
                  info: {
                    decimals: 6,
                    isInitialized: true,
                    mintAuthority: DEVNET.payer,
                    freezeAuthority: null,
                    supply: "100000000",
                  },
                },
              },
            },
            ...[DEVNET.recipient, DEVNET.payer].map((owner) => ({
              owner: TOKEN_PROGRAM_ADDRESS,
              data: {
                parsed: {
                  type: "account",
                  info: {
                    owner,
                    mint: DEVNET_MOCK_USDT_MINT,
                    state: "initialized",
                    tokenAmount: { amount: "0" },
                  },
                },
              },
            })),
          ],
        };
      else if (method === "getAccountInfo")
        result = {
          value: {
            owner: TOKEN_PROGRAM_ADDRESS,
            data: {
              parsed:
                params[0] === DEVNET.mint
                  ? { type: "mint", info: { decimals: 6, isInitialized: true } }
                  : {
                      type: "account",
                      info: {
                        mint: DEVNET.mint,
                        owner: DEVNET.recipient,
                        state: "initialized",
                        tokenAmount: { amount: balance },
                      },
                    },
            },
          },
        };
      else if (method === "getSlot") result = head;
      else if (method === "getFirstAvailableBlock") result = 10;
      else throw new Error(method);
      return result as T;
    },
  };
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const name of (await readdir("packages/database/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await pool.query(
        await readFile(`packages/database/migrations/${name}`, "utf8"),
      );
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  it("requires an empty receiving balance for the first boundary and rolls back identity", async () => {
    balance = "1";
    await expect(provisionUsdc(pool, rpc, project, "test-key")).rejects.toThrow(
      "first scan boundary",
    );
    expect((await pool.query("SELECT * FROM projects")).rowCount).toBe(0);
    balance = "0";
  });
  it("records first boundary and never advances it just because provision reruns", async () => {
    const first = await provisionUsdc(pool, rpc, project, "test-key");
    expect(first.scanned_through_slot).toBe("100");
    head = 200;
    const next = await provisionUsdc(pool, rpc, project, "test-key");
    expect(next.scanned_through_slot).toBe("100");
    expect(
      (
        await pool.query(
          "SELECT * FROM audit_logs WHERE action='devnet.initial_scan_boundary'",
        )
      ).rowCount,
    ).toBe(1);
  });
  it("refuses different configured wallets and foreign environment data", async () => {
    await pool.query("UPDATE token_configs SET recipient='wrong'");
    await expect(provisionUsdc(pool, rpc, project, "test-key")).rejects.toThrow(
      "differs",
    );
    await pool.query("UPDATE token_configs SET recipient=$1", [
      DEVNET.recipient,
    ]);
    const foreign = randomUUID();
    await pool.query(
      "INSERT INTO projects(id,name,environment)VALUES($1,'foreign','local')",
      [foreign],
    );
    await expect(provisionUsdc(pool, rpc, project, "test-key")).rejects.toThrow(
      "non-Devnet",
    );
    await pool.query("DELETE FROM projects WHERE id=$1", [foreign]);
  });
  it("never creates a replacement boundary after an invoice exists", async () => {
    await createInvoice(
      pool,
      project,
      "staging",
      "devnet",
      "boundary-test",
      { order_id: "boundary-test", asset: "USDC", amount: "1" },
      true,
    );
    expect(
      (await provisionUsdc(pool, rpc, project, "test-key"))
        .scanned_through_slot,
    ).toBe("100");
    const usdt = await provisionUsdc(pool, rpc, project, "test-key", "USDT");
    expect(usdt.asset).toBe("USDT");
    expect(usdt.scanned_through_slot).toBe("200");
    expect(
      (await provisionUsdc(pool, rpc, project, "test-key"))
        .scanned_through_slot,
    ).toBe("100");
    head = 300;
    expect(
      (await provisionUsdc(pool, rpc, project, "test-key", "USDT"))
        .scanned_through_slot,
    ).toBe("200");
    await createInvoice(
      pool,
      project,
      "staging",
      "devnet",
      "usdt-boundary",
      { order_id: "usdt-boundary", asset: "USDT", amount: "1" },
      true,
    );
    await pool.query("DELETE FROM scan_checkpoints WHERE token_account=$1", [
      usdt.ata,
    ]);
    await expect(
      provisionUsdc(pool, rpc, project, "test-key", "USDT"),
    ).rejects.toThrow("first scan boundary");
    await pool.query("DELETE FROM scan_checkpoints");
    await expect(provisionUsdc(pool, rpc, project, "test-key")).rejects.toThrow(
      "first scan boundary",
    );
    expect((await pool.query("SELECT * FROM scan_checkpoints")).rowCount).toBe(
      0,
    );
  });
});
