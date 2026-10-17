import { address } from "@solana/kit";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  decodeTransfers,
  type ParsedTransaction,
  type TokenConfig,
} from "./decode.js";
import type { SolanaRpc } from "./rpc.js";
import { validateConfigs } from "./watcher.js";
export class RefundProofMismatch extends Error {}
export async function verifyRefund(
  rpc: Pick<SolanaRpc, "call">,
  config: TokenConfig,
  input: {
    destination: string;
    amount: bigint;
    signature: string;
    path: string;
    createdAt: Date;
  },
) {
  await validateConfigs(rpc, [config]);
  const [destination] = await findAssociatedTokenPda({
    owner: address(input.destination),
    mint: address(config.mint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  if (destination === config.token_account) throw new RefundProofMismatch();
  const tx = await rpc.call<ParsedTransaction | null>("getTransaction", [
    input.signature,
    {
      encoding: "jsonParsed",
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  if (!tx?.meta || tx.blockTime === null)
    throw new Error("Refund proof unavailable");
  if (tx.meta.err || tx.blockTime * 1000 < input.createdAt.getTime())
    throw new RefundProofMismatch();
  const keys = tx.transaction.message.accountKeys.map((k) =>
    typeof k === "string" ? k : k.pubkey,
  );
  const metadata = [
    ...(tx.meta.preTokenBalances ?? []),
    ...(tx.meta.postTokenBalances ?? []),
  ];
  const source = metadata.find(
    (b) => keys[b.accountIndex] === config.token_account,
  );
  if (source?.mint !== config.mint || source?.owner !== config.recipient)
    throw new RefundProofMismatch();
  const ix = input.path.includes(".")
    ? tx.meta.innerInstructions?.find(
        (g) => String(g.index) === input.path.split(".")[0],
      )?.instructions[Number(input.path.split(".")[1])]
    : tx.transaction.message.instructions[Number(input.path)];
  if (
    ix?.programId !== TOKEN_PROGRAM_ADDRESS ||
    ix.parsed?.info.source !== config.token_account
  )
    throw new RefundProofMismatch();
  let transfers;
  try {
    transfers = decodeTransfers(tx, [
      { ...config, recipient: input.destination, token_account: destination },
    ]);
  } catch {
    throw new RefundProofMismatch();
  }
  const transfer = transfers.find((t) => t.path === input.path);
  if (!transfer || transfer.amount !== input.amount)
    throw new RefundProofMismatch();
  return {
    destination_account: destination,
    slot: String(transfer.slot),
    block_time: new Date(transfer.blockTime * 1000).toISOString(),
  };
}
