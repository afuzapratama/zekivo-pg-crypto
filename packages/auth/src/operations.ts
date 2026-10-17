import type pg from "pg";
import { SolanaRpc } from "../../solana/src/rpc.js";
import { validateConfigs } from "../../solana/src/watcher.js";
import { assertEnabledAssets } from "../../solana/src/networks.js";
import type { TokenConfig } from "../../solana/src/decode.js";
import { formatAmount } from "../../domain/src/amount.js";
export function checkpointHealth(
  head: number,
  slot: string | null,
  updated: string | Date | null,
  monitoring: boolean,
  now = Date.now(),
) {
  if (!monitoring)
    return { state: "disabled", lag_slots: null, age_seconds: null };
  if (!slot || !/^\d+$/.test(slot) || !updated)
    return { state: "unknown", lag_slots: null, age_seconds: null };
  const age = Math.floor((now - new Date(updated).getTime()) / 1000);
  if (!Number.isFinite(age) || age < 0 || BigInt(slot) > BigInt(head))
    return { state: "unknown", lag_slots: null, age_seconds: null };
  const lag = BigInt(head) - BigInt(slot);
  return {
    state: age > 120 || lag > 300n ? "lagging" : "current",
    lag_slots: lag.toString(),
    age_seconds: age,
  };
}
export async function readOperations(
  pool: pg.Pool,
  rpc: Pick<SolanaRpc, "call">,
  scope: {
    APP_ENV: string;
    SOLANA_CLUSTER: string;
    ENABLED_ASSETS?: string;
    CHAIN_MONITORING?: string;
  },
) {
  const tokens = await pool.query<TokenConfig>(
    "SELECT * FROM token_configs WHERE environment=$1 AND cluster=$2 ORDER BY asset",
    [scope.APP_ENV, scope.SOLANA_CLUSTER],
  );
  assertEnabledAssets(tokens.rows, scope.ENABLED_ASSETS);
  await validateConfigs(rpc, tokens.rows);
  const checkpoints = await pool.query(
    "SELECT token_account,scanned_through_slot::text,updated_at FROM scan_checkpoints WHERE environment=$1 AND cluster=$2",
    [scope.APP_ENV, scope.SOLANA_CLUSTER],
  );
  const wallets = [];
  for (const token of tokens.rows) {
    const response = await rpc.call<{
      value: { amount: string; decimals: number };
    }>("getTokenAccountBalance", [
      token.token_account,
      { commitment: "finalized" },
    ]);
    if (response.value.decimals !== 6 || !/^\d+$/.test(response.value.amount))
      throw new Error("Invalid wallet balance");
    wallets.push({
      asset: token.asset,
      mint: token.mint,
      recipient: token.recipient,
      token_account: token.token_account,
      balance: formatAmount(BigInt(response.value.amount)),
    });
  }
  const head = await rpc.call<number>("getSlot", [{ commitment: "finalized" }]);
  if (!Number.isSafeInteger(head) || head < 0)
    throw new Error("Invalid finalized head");
  const as_of = new Date().toISOString();
  return {
    cluster: scope.SOLANA_CLUSTER,
    environment: scope.APP_ENV,
    as_of,
    finalized_head: String(head),
    rpc: "reachable",
    monitoring: scope.CHAIN_MONITORING === "true",
    wallets: wallets.map((wallet) => {
      const checkpoint = checkpoints.rows.find(
        (c) => c.token_account === wallet.token_account,
      );
      return {
        ...wallet,
        checkpoint_slot: checkpoint?.scanned_through_slot ?? null,
        checkpoint_updated_at: checkpoint?.updated_at ?? null,
        ...checkpointHealth(
          head,
          checkpoint?.scanned_through_slot ?? null,
          checkpoint?.updated_at ?? null,
          scope.CHAIN_MONITORING === "true",
          Date.parse(as_of),
        ),
      };
    }),
  };
}
