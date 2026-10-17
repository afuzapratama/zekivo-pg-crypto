import { createHash } from "node:crypto";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
  type Blockhash,
} from "@solana/kit";
import { SolanaRpc } from "../../solana/src/rpc.js";
// Publicly reproducible local fixtures. Never use these identities on a real network.
export function fixtureSigner(name: string) {
  return createKeyPairSignerFromPrivateKeyBytes(
    createHash("sha256")
      .update(`zekivo:localnet:unsafe-fixture:v1:${name}`)
      .digest(),
  );
}
export async function sendInstructions(
  rpc: SolanaRpc,
  payer: KeyPairSigner,
  instructions: Instruction[],
) {
  const latest = await rpc.call<{
    value: { blockhash: Blockhash; lastValidBlockHeight: number };
  }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
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
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  await rpc.call("sendTransaction", [
    getBase64EncodedWireTransaction(signed),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
  for (let attempt = 0; attempt < 180; attempt++) {
    const status = await rpc.call<{
      value: ({ err: unknown; confirmationStatus: string } | null)[];
    }>("getSignatureStatuses", [
      [signature],
      { searchTransactionHistory: true },
    ]);
    if (status.value[0]?.err)
      throw new Error("Local transaction execution failed");
    if (status.value[0]?.confirmationStatus === "finalized") return signature;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Finality timeout for ${signature}; inspect chain before retrying`,
  );
}
