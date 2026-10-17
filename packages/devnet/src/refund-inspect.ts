import { address } from "@solana/kit";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { devnetEnvironment } from "./environment.js";
import { createPool } from "../../database/src/pool.js";
import { parseAmount, formatAmount } from "../../domain/src/amount.js";
import { SolanaRpc } from "../../solana/src/rpc.js";
import {
  decodeTransfers,
  type ParsedTransaction,
  type TokenConfig,
} from "../../solana/src/decode.js";
import { validateConfigs } from "../../solana/src/watcher.js";
import { verifyRefund } from "../../solana/src/refund.js";
const [invoiceId, destination, amountInput, signature] = process.argv.slice(2);
if (
  !invoiceId ||
  !destination ||
  !amountInput ||
  !/^[a-f0-9-]{36}$/i.test(invoiceId)
)
  throw new Error(
    "Usage: pnpm devnet:refund-inspect <invoice-id> <destination-owner> <amount> [signature]",
  );
address(destination);
const amount = parseAmount(amountInput),
  env = devnetEnvironment();
const database = new URL(env.DATABASE_URL!);
database.searchParams.set(
  "options",
  `${database.searchParams.get("options") ?? ""} -c default_transaction_read_only=on`.trim(),
);
const pool = createPool(database.href),
  rpc = new SolanaRpc(env.SOLANA_RPC_URL!, { retries: 0 });
try {
  const invoice = (
    await pool.query(
      "SELECT id,asset,status,created_at FROM invoices WHERE id=$1 AND project_id=$2 AND environment='staging' AND cluster='devnet'",
      [invoiceId, env.DEVNET_PROJECT_ID],
    )
  ).rows[0];
  if (!invoice)
    throw new Error("Invoice not found in configured Devnet project");
  const token = (
    await pool.query<TokenConfig>(
      "SELECT * FROM token_configs WHERE environment='staging' AND cluster='devnet' AND asset=$1",
      [invoice.asset],
    )
  ).rows[0];
  if (!token) throw new Error("Devnet token configuration unavailable");
  await validateConfigs(rpc, [token]);
  const [destinationAccount] = await findAssociatedTokenPda({
    owner: address(destination),
    mint: address(token.mint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const totals = (
    await pool.query(
      "SELECT (SELECT coalesce(sum(amount),0)::text FROM ledger_entries WHERE invoice_id=$1 AND asset=$2 AND entry_type='payment') AS paid,(SELECT coalesce(sum(amount),0)::text FROM manual_refunds WHERE invoice_id=$1 AND asset=$2) AS refunded",
      [invoice.id, invoice.asset],
    )
  ).rows[0];
  const [gas, balance] = await Promise.all([
    rpc.call<{ value: number }>("getBalance", [
      token.recipient,
      { commitment: "finalized" },
    ]),
    rpc.call<{ value: { amount: string } }>("getTokenAccountBalance", [
      token.token_account,
      { commitment: "finalized" },
    ]),
  ]);
  const reasons: string[] = [];
  if (invoice.status !== "paid") reasons.push("invoice_not_paid");
  if (BigInt(totals.refunded) + amount > BigInt(totals.paid))
    reasons.push("exceeds_remaining_credit");
  if (destination === token.recipient) reasons.push("destination_is_treasury");
  // This is a readiness hint, not a fee estimate or a guarantee of sufficient gas.
  if (gas.value === 0) reasons.push("treasury_has_no_sol_for_wallet_transfer");
  if (BigInt(balance.value.amount) < amount)
    reasons.push("treasury_token_balance_insufficient");
  const output: Record<string, unknown> = {
    cluster: "devnet",
    read_only: true,
    invoice_id: invoice.id,
    invoice_status: invoice.status,
    asset: invoice.asset,
    mint: token.mint,
    treasury: token.recipient,
    source_account: token.token_account,
    destination,
    destination_account: destinationAccount,
    requested_amount: formatAmount(amount),
    credited_amount: formatAmount(BigInt(totals.paid)),
    recorded_refund_amount: formatAmount(BigInt(totals.refunded)),
    remaining_credit: formatAmount(
      BigInt(totals.paid) - BigInt(totals.refunded),
    ),
    treasury_token_balance: formatAmount(BigInt(balance.value.amount)),
    treasury_sol_lamports: gas.value,
    preflight_notes: reasons,
    note: "No transfer sent and no refund recorded. Confirm destination through the customer channel before sending from Phantom.",
  };
  if (signature) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))
      throw new Error("Invalid transaction signature");
    const tx = await rpc.call<ParsedTransaction | null>("getTransaction", [
      signature,
      {
        encoding: "jsonParsed",
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      },
    ]);
    if (!tx?.meta)
      throw new Error(
        "Finalized transaction unavailable; inspect before sending anything again",
      );
    const candidates = decodeTransfers(tx, [
      { ...token, recipient: destination, token_account: destinationAccount },
    ]).filter((t) => t.amount === amount);
    if (candidates.length !== 1)
      throw new Error(
        "Expected exactly one matching refund instruction; inspect transaction manually",
      );
    const proof = await verifyRefund(rpc, token, {
      destination,
      amount,
      signature,
      path: candidates[0]!.path,
      createdAt: new Date(invoice.created_at),
    });
    const used = (
      await pool.query(
        "SELECT invoice_id FROM manual_refunds WHERE environment='staging' AND cluster='devnet' AND signature=$1 AND instruction_path=$2",
        [signature, candidates[0]!.path],
      )
    ).rows[0];
    output.verified_proof = {
      signature,
      instruction_path: candidates[0]!.path,
      ...proof,
      already_recorded: !!used,
    };
    output.dashboard = `http://localhost:13100/dashboard/invoices/${invoice.id}/refunds`;
  }
  console.log(JSON.stringify(output, null, 2));
} finally {
  await pool.end();
}
