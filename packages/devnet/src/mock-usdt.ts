import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type KeyPairSigner,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { SolanaRpc } from "../../solana/src/rpc.js";
import { DEVNET } from "./setup.js";

// This key creates the mint account only. The buyer retains mint authority.
// It never enters API/worker containers, and cannot spend either user's funds.
export async function mockMintSigner() {
  await mkdir(".devnet", { recursive: true, mode: 0o700 });
  const path = ".devnet/mock-usdt-mint.key";
  try {
    await writeFile(path, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return createKeyPairSignerFromPrivateKeyBytes(
    new Uint8Array(await readFile(path)),
  );
}
type Parsed = {
  owner: string;
  data: { parsed?: { type: string; info: Record<string, unknown> } };
};
export class MockUsdtSetup {
  private pending?: {
    id: string;
    message: Uint8Array;
    mintSignature: Uint8Array;
    expires: number;
  };
  constructor(
    private readonly rpc: Pick<SolanaRpc, "call">,
    private readonly mint: KeyPairSigner,
    private readonly journal = ".devnet/mock-usdt-submission.json",
  ) {}
  async inspect() {
    return inspectMockUsdt(this.rpc, this.mint.address);
  }
  async prepare(payer: string) {
    if (payer !== DEVNET.payer)
      throw new Error("Connect the configured buyer wallet");
    const state = await this.inspect();
    if (state.ready)
      throw new Error("Mock USDT already ready; do not create it again");
    try {
      await readFile(this.journal);
      throw new Error(
        "A submission is recorded; inspect its transaction before retrying. Automatic resend is disabled.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const mintRent = await this.rpc.call<number>(
      "getMinimumBalanceForRentExemption",
      [82],
    );
    const tokenRent = await this.rpc.call<number>(
      "getMinimumBalanceForRentExemption",
      [165],
    );
    const payerSigner = createNoopSigner(DEVNET.payer);
    const latest = await this.rpc.call<{
      value: { blockhash: Blockhash; lastValidBlockHeight: number };
    }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const instructions = [
      getSetComputeUnitLimitInstruction({ units: 200_000 }),
      getSetComputeUnitPriceInstruction({ microLamports: 0n }),
      getCreateAccountInstruction({
        payer: payerSigner,
        newAccount: this.mint,
        space: 82,
        lamports: BigInt(mintRent),
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMint2Instruction({
        mint: this.mint.address,
        decimals: 6,
        mintAuthority: DEVNET.payer,
      }),
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: payerSigner,
        owner: DEVNET.payer,
        mint: this.mint.address,
      }),
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: payerSigner,
        owner: DEVNET.recipient,
        mint: this.mint.address,
      }),
      getMintToInstruction({
        mint: this.mint.address,
        token: address(state.buyer_ata),
        mintAuthority: payerSigner,
        amount: 100_000_000n,
      }),
    ];
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(DEVNET.payer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            ...latest.value,
            lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight),
          },
          m,
        ),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const tx = await partiallySignTransactionMessageWithSigners(message);
    const transaction = getBase64EncodedWireTransaction(tx);
    const fee = await this.rpc.call<{ value: number | null }>(
      "getFeeForMessage",
      [
        Buffer.from(tx.messageBytes).toString("base64"),
        { commitment: "confirmed" },
      ],
    );
    if (fee.value === null) throw new Error("Fee unavailable");
    const balance = await this.rpc.call<{ value: number }>("getBalance", [
      DEVNET.payer,
      { commitment: "finalized" },
    ]);
    if (balance.value < mintRent + 2 * tokenRent + fee.value)
      throw new Error("Insufficient Devnet SOL");
    const simulation = await this.rpc.call<{
      value: { err: unknown; unitsConsumed?: number };
    }>("simulateTransaction", [
      transaction,
      { encoding: "base64", sigVerify: false, commitment: "confirmed" },
    ]);
    if (simulation.value.err)
      throw new Error(
        `Mock setup simulation failed: ${JSON.stringify(simulation.value.err)}`,
      );
    this.pending = {
      id: randomUUID(),
      message: new Uint8Array(tx.messageBytes),
      mintSignature: new Uint8Array(tx.signatures[this.mint.address]!),
      expires: Date.now() + 90_000,
    };
    return {
      ...state,
      id: this.pending.id,
      transaction,
      rent_lamports: mintRent + 2 * tokenRent,
      fee_lamports: fee.value,
      units_consumed: simulation.value.unitsConsumed,
    };
  }
  async submit(id: string, encoded: string) {
    const pending = this.pending;
    if (!pending || pending.id !== id || Date.now() > pending.expires)
      throw new Error(
        "Request expired or already submitted; inspect chain first",
      );
    const tx = getTransactionDecoder().decode(Buffer.from(encoded, "base64"));
    if (!Buffer.from(tx.messageBytes).equals(Buffer.from(pending.message)))
      throw new Error("Wallet returned a different transaction; rejected");
    if (!tx.signatures[DEVNET.payer]?.some((b) => b !== 0))
      throw new Error("Buyer signature missing");
    if (
      !Buffer.from(tx.signatures[this.mint.address] ?? []).equals(
        Buffer.from(pending.mintSignature),
      )
    )
      throw new Error("Mint signature changed");
    if ((await this.inspect()).ready)
      throw new Error("Mock already initialized");
    // Persist before broadcast. Restart/timeout cannot silently mint or resend again.
    await writeFile(
      this.journal,
      JSON.stringify({
        mint: this.mint.address,
        state: "broadcast_attempted",
        recorded_at: new Date().toISOString(),
      }),
      { flag: "wx", mode: 0o600 },
    );
    this.pending = undefined;
    const signature = await this.rpc.call<string>("sendTransaction", [
      encoded,
      {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 0,
      },
    ]);
    await writeFile(
      this.journal,
      JSON.stringify({ mint: this.mint.address, signature }),
      { mode: 0o600 },
    );
    return { signature };
  }
}

export async function inspectMockUsdt(
  rpc: Pick<SolanaRpc, "call">,
  mintAddress: ReturnType<typeof address>,
) {
  if ((await rpc.call<string>("getGenesisHash")) !== DEVNET.genesis)
    throw new Error("RPC is not Solana Devnet");
  const [ata] = await findAssociatedTokenPda({
    owner: DEVNET.recipient,
    mint: mintAddress,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [buyerAta] = await findAssociatedTokenPda({
    owner: DEVNET.payer,
    mint: mintAddress,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const accounts = await rpc.call<{ value: (Parsed | null)[] }>(
    "getMultipleAccounts",
    [
      [mintAddress, ata, buyerAta],
      { encoding: "jsonParsed", commitment: "finalized" },
    ],
  );
  const [mint, receiver, buyer] = accounts.value;
  if (mint) {
    const info = mint.data.parsed;
    if (
      mint.owner !== TOKEN_PROGRAM_ADDRESS ||
      info?.type !== "mint" ||
      info.info.decimals !== 6 ||
      info.info.isInitialized !== true ||
      info.info.mintAuthority !== DEVNET.payer ||
      info.info.freezeAuthority !== null
    )
      throw new Error("Mock mint validation failed");
    for (const [account, owner] of [
      [receiver, DEVNET.recipient],
      [buyer, DEVNET.payer],
    ] as const) {
      const parsed = account?.data.parsed;
      if (
        account?.owner !== TOKEN_PROGRAM_ADDRESS ||
        parsed?.type !== "account" ||
        parsed.info.owner !== owner ||
        parsed.info.mint !== mintAddress ||
        parsed.info.state !== "initialized"
      )
        throw new Error("Mock token account validation failed");
    }
  } else if (receiver || buyer)
    throw new Error("Unexpected token accounts without mint");
  return {
    cluster: "devnet",
    label: "Mock USDT Devnet",
    mint: mintAddress,
    recipient: DEVNET.recipient,
    payer: DEVNET.payer,
    ata,
    buyer_ata: buyerAta,
    ready: !!mint,
    supply_units: mint?.data.parsed?.info.supply ?? "0",
    buyer_balance: buyer?.data.parsed?.info.tokenAmount,
    recipient_balance: receiver?.data.parsed?.info.tokenAmount,
  };
}
