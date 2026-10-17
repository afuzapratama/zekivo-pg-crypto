import {
  DEVNET_GENESIS,
  DEVNET_USDC_MINT,
  DEVNET_MOCK_USDT_MINT,
} from "./networks.js";
import type pg from "pg";
import { address } from "@solana/kit";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { SolanaRpc } from "./rpc.js";
import {
  decodeTransfers,
  type TokenConfig,
  type ParsedTransaction,
} from "./decode.js";
import { settleTransfer } from "../../database/src/settle.js";
export async function validateConfigs(
  rpc: Pick<SolanaRpc, "call">,
  configs: TokenConfig[],
) {
  const genesis = await rpc.call<string>("getGenesisHash");
  if (new Set(configs.map((c) => c.recipient)).size > 1)
    throw new Error("A single receiving owner is required");
  for (const config of configs) {
    if (
      config.cluster === "devnet" &&
      (genesis !== DEVNET_GENESIS ||
        (config.asset === "USDC" && config.mint !== DEVNET_USDC_MINT) ||
        (config.asset === "USDT" && config.mint !== DEVNET_MOCK_USDT_MINT))
    )
      throw new Error("Devnet genesis or pinned mint mismatch");
    const [expectedAta] = await findAssociatedTokenPda({
      owner: address(config.recipient),
      mint: address(config.mint),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    if (expectedAta !== config.token_account)
      throw new Error("Receiving account is not the canonical ATA");
    if (config.genesis_hash !== genesis)
      throw new Error("Validator genesis mismatch");
    const mint = await rpc.call<{
      value: {
        owner: string;
        data: {
          parsed: {
            type: string;
            info: { decimals: number; isInitialized: boolean };
          };
        };
      } | null;
    }>("getAccountInfo", [
      config.mint,
      { encoding: "jsonParsed", commitment: "finalized" },
    ]);
    if (
      !mint.value ||
      mint.value.owner !== TOKEN_PROGRAM_ADDRESS ||
      mint.value.data.parsed.type !== "mint" ||
      mint.value.data.parsed.info.decimals !== 6 ||
      !mint.value.data.parsed.info.isInitialized
    )
      throw new Error("Mint account invalid");
    const account = await rpc.call<{
      value: {
        owner: string;
        data: {
          parsed: {
            type: string;
            info: { owner: string; mint: string; state: string };
          };
        };
      } | null;
    }>("getAccountInfo", [
      config.token_account,
      { encoding: "jsonParsed", commitment: "finalized" },
    ]);
    const info = account.value?.data.parsed.info;
    if (
      account.value?.owner !== TOKEN_PROGRAM_ADDRESS ||
      account.value.data.parsed.type !== "account" ||
      info?.owner !== config.recipient ||
      info?.mint !== config.mint ||
      info?.state !== "initialized"
    )
      throw new Error("Receiving token account invalid");
  }
}
export interface ScanResult {
  scanned: boolean;
  scannedThroughSlot?: number;
  historyGap?: { previousSlot: number | null; firstAvailableSlot: number };
}
interface SignatureEntry {
  signature: string;
  slot: number;
  err: unknown;
}
function checkedSlot(value: unknown): number {
  const slot = Number(value);
  if (
    value === null ||
    value === undefined ||
    !Number.isSafeInteger(slot) ||
    slot < 0
  )
    throw new Error("RPC/checkpoint slot is invalid; cursor unchanged");
  return slot;
}
export async function scanAccount(
  pool: pg.Pool,
  rpc: SolanaRpc,
  config: TokenConfig,
): Promise<ScanResult> {
  const client = await pool.connect();
  try {
    const lock = `${config.environment}:${config.cluster}:${config.token_account}`;
    const acquired = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
      [lock],
    );
    if (!acquired.rows[0].locked) return { scanned: false };
    try {
      const checkpoint = (
        await client.query(
          "SELECT signature,scanned_through_slot FROM scan_checkpoints WHERE environment=$1 AND cluster=$2 AND token_account=$3",
          [config.environment, config.cluster, config.token_account],
        )
      ).rows[0] as
        | { signature: string | null; scanned_through_slot: string | null }
        | undefined;
      // Capture a finalized upper bound first. Newer transfers belong to the next scan.
      const head = checkedSlot(
        await rpc.call<number>("getSlot", [{ commitment: "finalized" }]),
      );
      const firstAvailable = checkedSlot(
        await rpc.call<number>("getFirstAvailableBlock"),
      );
      if (firstAvailable > head)
        throw new Error("RPC history bounds inconsistent; cursor unchanged");
      let previousSlot =
        checkpoint?.scanned_through_slot == null
          ? null
          : checkedSlot(checkpoint.scanned_through_slot);
      // Upgrade old signature-only checkpoints when the transaction is still queryable.
      if (previousSlot === null && checkpoint?.signature) {
        const status = await rpc.call<{ value: ({ slot: number } | null)[] }>(
          "getSignatureStatuses",
          [[checkpoint.signature], { searchTransactionHistory: true }],
        );
        if (status.value[0]) previousSlot = checkedSlot(status.value[0].slot);
      }
      if (previousSlot !== null && head < previousSlot)
        throw new Error(
          "RPC finalized head is behind checkpoint; cursor unchanged",
        );
      const unknownOldBoundary = !!checkpoint && previousSlot === null;
      const missingHistory =
        previousSlot === null
          ? firstAvailable > 0 || unknownOldBoundary
          : firstAvailable > previousSlot + 1;
      const historyGap = missingHistory
        ? { previousSlot, firstAvailableSlot: firstAvailable }
        : undefined;
      // Only a local sandbox may resume from retained data. Never claim missing history was recovered.
      if (
        historyGap &&
        (config.environment !== "local" || config.cluster !== "localnet")
      )
        throw new Error(
          "RPC history gap: use a complete/archive RPC; cursor unchanged",
        );
      const lowerBound =
        previousSlot === null
          ? firstAvailable
          : Math.max(firstAvailable, previousSlot - 32);
      const pending: SignatureEntry[] = [];
      let before: string | undefined;
      for (let page = 0; ; page++) {
        if (page >= 1000)
          throw new Error("Scan safety bound reached; cursor unchanged");
        // Do not use until: an idle account signature can be pruned while slot watermarks stay valid.
        const batch = await rpc.call<SignatureEntry[]>(
          "getSignaturesForAddress",
          [
            config.token_account,
            {
              commitment: "finalized",
              limit: 100,
              minContextSlot: head,
              ...(before ? { before } : {}),
            },
          ],
        );
        for (const entry of batch) {
          const slot = checkedSlot(entry.slot);
          if (slot >= lowerBound && slot <= head) pending.push(entry);
        }
        if (batch.length < 100 || checkedSlot(batch.at(-1)!.slot) < lowerBound)
          break;
        const next = batch.at(-1)!.signature;
        if (next === before)
          throw new Error("RPC pagination did not advance; cursor unchanged");
        before = next;
      }
      for (const entry of [...pending].reverse()) {
        if (entry.err) continue;
        const tx = await rpc.call<ParsedTransaction | null>("getTransaction", [
          entry.signature,
          {
            encoding: "jsonParsed",
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          },
        ]);
        if (!tx)
          throw new Error(
            "Finalized transaction unavailable; cursor unchanged",
          );
        if (checkedSlot(tx.slot) !== checkedSlot(entry.slot))
          throw new Error("RPC transaction slot mismatch; cursor unchanged");
        for (const transfer of decodeTransfers(tx, [config]))
          await settleTransfer(pool, config, entry.signature, transfer);
      }
      // Record coverage even for an idle account; a signature is diagnostic, not a pagination dependency.
      await client.query("BEGIN");
      try {
        if (historyGap)
          await client.query(
            "INSERT INTO scan_history_gaps(environment,cluster,token_account,previous_signature,previous_slot,first_available_slot,recovered_through_slot) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              config.environment,
              config.cluster,
              config.token_account,
              checkpoint?.signature ?? null,
              previousSlot,
              firstAvailable,
              head,
            ],
          );
        await client.query(
          `INSERT INTO scan_checkpoints(environment,cluster,token_account,signature,scanned_through_slot) VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(environment,cluster,token_account) DO UPDATE SET signature=excluded.signature,scanned_through_slot=excluded.scanned_through_slot,updated_at=now()`,
          [
            config.environment,
            config.cluster,
            config.token_account,
            pending[0]?.signature ?? checkpoint?.signature ?? null,
            head,
          ],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      return {
        scanned: true,
        scannedThroughSlot: head,
        ...(historyGap ? { historyGap } : {}),
      };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
        lock,
      ]);
    }
  } finally {
    client.release();
  }
}
