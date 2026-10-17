import { address } from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  TOKEN_PROGRAM_ADDRESS,
  getInitializeMint2Instruction,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
  findAssociatedTokenPda,
} from "@solana-program/token";
import { loadConfig } from "../../config/src/index.js";
import { createPool } from "../../database/src/pool.js";
import { assertLocalRpc, SolanaRpc } from "../../solana/src/rpc.js";
import { fixtureSigner, sendInstructions } from "./transactions.js";
const config = loadConfig();
assertLocalRpc(config.SOLANA_RPC_URL, config.APP_ENV, config.SOLANA_CLUSTER);
const pool = createPool(config.DATABASE_URL),
  rpc = new SolanaRpc(config.SOLANA_RPC_URL);
const sender = await fixtureSigner("sender"),
  recipient = await fixtureSigner("receiver");
const genesis = await rpc.call<string>("getGenesisHash");
try {
  const existing = await pool.query(
    "SELECT genesis_hash FROM token_configs WHERE environment=$1 AND cluster=$2",
    [config.APP_ENV, config.SOLANA_CLUSTER],
  );
  if (existing.rows.some((row) => row.genesis_hash !== genesis))
    throw new Error(
      "Local ledger changed. Restore its volume or explicitly reset the entire local environment; do not reuse payment history on a new chain",
    );
  const balance = await rpc.call<{ value: number }>("getBalance", [
    sender.address,
  ]);
  if (balance.value < 10_000_000_000) {
    const signature = await rpc.call<string>("requestAirdrop", [
      sender.address,
      50_000_000_000,
    ]);
    for (let i = 0; i < 120; i++) {
      const b = await rpc.call<{ value: number }>("getBalance", [
        sender.address,
        { commitment: "finalized" },
      ]);
      if (b.value >= 10_000_000_000) break;
      if (i === 119) throw new Error(`Airdrop did not finalize: ${signature}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  for (const asset of ["USDT", "USDC"]) {
    const mint = await fixtureSigner(`mint:${asset}`);
    const info = await rpc.call<{ value: unknown }>("getAccountInfo", [
      mint.address,
      { encoding: "base64", commitment: "finalized" },
    ]);
    if (!info.value) {
      const rent = await rpc.call<number>(
        "getMinimumBalanceForRentExemption",
        [82],
      );
      await sendInstructions(rpc, sender, [
        getCreateAccountInstruction({
          payer: sender,
          newAccount: mint,
          space: 82,
          lamports: BigInt(rent),
          programAddress: TOKEN_PROGRAM_ADDRESS,
        }),
        getInitializeMint2Instruction({
          mint: mint.address,
          decimals: 6,
          mintAuthority: sender.address,
        }),
      ]);
    }
    const [senderAta] = await findAssociatedTokenPda({
      owner: sender.address,
      mint: mint.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [receiverAta] = await findAssociatedTokenPda({
      owner: recipient.address,
      mint: mint.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    await sendInstructions(rpc, sender, [
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: sender,
        owner: sender.address,
        mint: mint.address,
      }),
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: sender,
        owner: recipient.address,
        mint: mint.address,
      }),
    ]);
    const tokenBalance = await rpc.call<{ value: { amount: string } }>(
      "getTokenAccountBalance",
      [senderAta, { commitment: "finalized" }],
    );
    const target = 1_000_000_000_000n;
    if (BigInt(tokenBalance.value.amount) < target)
      await sendInstructions(rpc, sender, [
        getMintToInstruction({
          mint: mint.address,
          token: senderAta,
          mintAuthority: sender,
          amount: target - BigInt(tokenBalance.value.amount),
        }),
      ]);
    await pool.query(
      `INSERT INTO token_configs(environment,cluster,asset,mint,recipient,token_account,genesis_hash,decimals) VALUES($1,$2,$3,$4,$5,$6,$7,6) ON CONFLICT(environment,cluster,asset) DO NOTHING`,
      [
        config.APP_ENV,
        config.SOLANA_CLUSTER,
        asset,
        address(mint.address),
        recipient.address,
        receiverAta,
        genesis,
      ],
    );
    console.log(
      JSON.stringify({
        asset: `Mock ${asset}`,
        mint: mint.address,
        recipient: recipient.address,
        token_account: receiverAta,
      }),
    );
  }
} finally {
  await pool.end();
}
