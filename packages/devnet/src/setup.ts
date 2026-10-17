import { DEVNET_GENESIS, DEVNET_USDC_MINT } from "../../solana/src/networks.js";
import { randomUUID } from "node:crypto";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { SolanaRpc } from "../../solana/src/rpc.js";

export const DEVNET = {
  genesis: DEVNET_GENESIS,
  mint: address(DEVNET_USDC_MINT),
  recipient: address("GGQtua3Q7Sdr4K3eCvJA7kiHXCsTCgGBrm7FqoJsPEkk"),
  payer: address("3toF4H23Winv3CehGrxW7CaqMuFcbQVRfaDoa8upVLkt"),
} as const;
type Account = {
  owner: string;
  data: {
    parsed?: {
      type: string;
      info: {
        decimals?: number;
        isInitialized?: boolean;
        mint?: string;
        owner?: string;
        state?: string;
        tokenAmount?: { amount: string };
      };
    };
  };
};
export class DevnetSetup {
  private prepared?: {
    id: string;
    message: Uint8Array;
    expires: number;
    submitted: boolean;
  };
  constructor(private readonly rpc: Pick<SolanaRpc, "call">) {}
  async inspect() {
    if ((await this.rpc.call<string>("getGenesisHash")) !== DEVNET.genesis)
      throw new Error("RPC is not Solana Devnet; setup stopped");
    const mint = await this.rpc.call<{ value: Account | null }>(
      "getAccountInfo",
      [DEVNET.mint, { encoding: "jsonParsed", commitment: "finalized" }],
    );
    const info = mint.value?.data?.parsed;
    if (
      mint.value?.owner !== TOKEN_PROGRAM_ADDRESS ||
      info?.type !== "mint" ||
      info.info.decimals !== 6 ||
      !info.info.isInitialized
    )
      throw new Error("Devnet USDC mint validation failed");
    const [ata] = await findAssociatedTokenPda({
      owner: DEVNET.recipient,
      mint: DEVNET.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const account = await this.rpc.call<{ value: Account | null }>(
      "getAccountInfo",
      [ata, { encoding: "jsonParsed", commitment: "finalized" }],
    );
    const token = account.value?.data?.parsed;
    if (
      account.value &&
      (account.value.owner !== TOKEN_PROGRAM_ADDRESS ||
        token?.type !== "account" ||
        token.info.mint !== DEVNET.mint ||
        token.info.owner !== DEVNET.recipient ||
        token.info.state !== "initialized")
    )
      throw new Error("Receiving USDC account validation failed");
    return {
      cluster: "devnet",
      ...DEVNET,
      ata,
      ready: !!account.value,
      balance_units: token?.info.tokenAmount?.amount ?? "0",
    };
  }
  async prepare(payer: string) {
    if (payer !== DEVNET.payer)
      throw new Error("Connect the configured buyer wallet");
    const state = await this.inspect();
    if (state.ready)
      throw new Error(
        "USDC receiving account already ready; no setup transaction needed",
      );
    const latest = await this.rpc.call<{
      value: { blockhash: Blockhash; lastValidBlockHeight: number };
    }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const instruction =
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: createNoopSigner(DEVNET.payer),
        owner: DEVNET.recipient,
        mint: DEVNET.mint,
      });
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(DEVNET.payer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: latest.value.blockhash,
            lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight),
          },
          m,
        ),
      // Phantom adds priority instructions to unsigned messages that omit them.
      // Specify both explicitly so signing preserves the exact message we validate.
      // Devnet-only setup: simulation uses ~18k CU; allow headroom without a tip.
      (m) =>
        appendTransactionMessageInstructions(
          [
            getSetComputeUnitLimitInstruction({ units: 50_000 }),
            getSetComputeUnitPriceInstruction({ microLamports: 0n }),
            instruction,
          ],
          m,
        ),
    );
    const tx = compileTransaction(message);
    const rent = await this.rpc.call<number>(
      "getMinimumBalanceForRentExemption",
      [165],
    );
    const fee = await this.rpc.call<{ value: number | null }>(
      "getFeeForMessage",
      [
        Buffer.from(tx.messageBytes).toString("base64"),
        { commitment: "confirmed" },
      ],
    );
    if (fee.value === null)
      throw new Error("Fee unavailable; prepare again later");
    const balance = await this.rpc.call<{ value: number }>("getBalance", [
      DEVNET.payer,
      { commitment: "finalized" },
    ]);
    if (balance.value < rent + fee.value)
      throw new Error("Buyer wallet has insufficient Devnet SOL");
    this.prepared = {
      id: randomUUID(),
      message: new Uint8Array(tx.messageBytes),
      expires: Date.now() + 90_000,
      submitted: false,
    };
    return {
      ...state,
      id: this.prepared.id,
      transaction: getBase64EncodedWireTransaction(tx),
      rent_lamports: rent,
      fee_lamports: fee.value,
      expires_at: this.prepared.expires,
    };
  }
  async submit(id: string, encoded: string) {
    const pending = this.prepared;
    if (
      !pending ||
      pending.id !== id ||
      pending.submitted ||
      Date.now() > pending.expires
    )
      throw new Error(
        "Setup request expired or already submitted; inspect chain before retrying",
      );
    const bytes = Buffer.from(encoded, "base64");
    const tx = getTransactionDecoder().decode(bytes);
    if (!Buffer.from(tx.messageBytes).equals(Buffer.from(pending.message)))
      throw new Error(
        "Wallet returned a different transaction; rejected before broadcast. Refresh this page and keep the prepared network fee unchanged in Phantom.",
      );
    const signature = tx.signatures[DEVNET.payer];
    if (!signature || !Array.from(signature).some((b) => b !== 0))
      throw new Error("Buyer signature missing");
    await this.inspect();
    // Mark before broadcast: a timeout must never trigger an automatic resend.
    pending.submitted = true;
    return {
      signature: await this.rpc.call<string>("sendTransaction", [
        encoded,
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        },
      ]),
    };
  }
}
