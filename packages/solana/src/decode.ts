import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
export interface TokenConfig {
  environment: string;
  cluster: string;
  asset: string;
  mint: string;
  recipient: string;
  token_account: string;
  genesis_hash: string;
  decimals: number;
}
export interface ParsedInstruction {
  programId: string;
  parsed?: { type: string; info: Record<string, unknown> };
  accounts?: string[];
}
export interface ParsedTransaction {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    preTokenBalances?: { accountIndex: number; mint: string; owner?: string }[];
    postTokenBalances?: {
      accountIndex: number;
      mint: string;
      owner?: string;
    }[];
    innerInstructions?: { index: number; instructions: ParsedInstruction[] }[];
  } | null;
  transaction: {
    message: {
      accountKeys: ({ pubkey: string } | string)[];
      instructions: ParsedInstruction[];
    };
  };
}
export interface DecodedTransfer {
  path: string;
  mint: string;
  destination: string;
  amount: bigint;
  references: string[];
  blockTime: number;
  slot: number;
}
export function decodeTransfers(
  tx: ParsedTransaction,
  configs: TokenConfig[],
): DecodedTransfer[] {
  if (!tx.meta) throw new Error("Transaction execution metadata missing");
  if (tx.meta.err) return [];
  if (!Number.isSafeInteger(tx.blockTime) || !Number.isSafeInteger(tx.slot))
    throw new Error("Transaction time/slot missing");
  const keys = tx.transaction.message.accountKeys.map((k) =>
    typeof k === "string" ? k : k.pubkey,
  );
  const instructions = tx.transaction.message.instructions.map((ix, i) => ({
    ix,
    path: String(i),
  }));
  for (const group of tx.meta.innerInstructions ?? [])
    group.instructions.forEach((ix, i) =>
      instructions.push({ ix, path: `${group.index}.${i}` }),
    );
  const transfers: DecodedTransfer[] = [];
  for (const { ix, path } of instructions) {
    if (ix.programId === TOKEN_PROGRAM_ADDRESS && !ix.parsed)
      throw new Error("Unparsed token instruction; manual inspection required");
    if (
      ix.programId !== TOKEN_PROGRAM_ADDRESS ||
      !ix.parsed ||
      !["transfer", "transferChecked"].includes(ix.parsed.type)
    )
      continue;
    const info = ix.parsed.info;
    if (info.source === info.destination) continue;
    const config = configs.find((c) => c.token_account === info.destination);
    if (!config) continue;
    const metadata = [
      ...(tx.meta.preTokenBalances ?? []),
      ...(tx.meta.postTokenBalances ?? []),
    ].find((b) => keys[b.accountIndex] === config.token_account);
    if (
      !metadata ||
      metadata.mint !== config.mint ||
      metadata.owner !== config.recipient
    )
      throw new Error("Destination token metadata inconsistent");
    const tokenAmount = info.tokenAmount as
      { amount?: string; decimals?: number } | undefined;
    if (
      ix.parsed.type === "transferChecked" &&
      (info.mint !== config.mint || tokenAmount?.decimals !== 6)
    )
      throw new Error("Transfer mint/decimals inconsistent");
    const raw =
      ix.parsed.type === "transferChecked" ? tokenAmount?.amount : info.amount;
    if (typeof raw !== "string" || !/^\d+$/.test(raw))
      throw new Error("Invalid token amount");
    const amount = BigInt(raw);
    if (amount === 0n) continue;
    if (amount > 9223372036854775807n)
      throw new Error("Transfer amount exceeds supported storage range");
    transfers.push({
      path,
      mint: config.mint,
      destination: config.token_account,
      amount,
      references: keys,
      blockTime: tx.blockTime!,
      slot: tx.slot,
    });
  }
  return transfers;
}
