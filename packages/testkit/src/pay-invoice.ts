import { address, AccountRole } from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import { loadConfig } from "../../config/src/index.js";
import { createPool } from "../../database/src/pool.js";
import { parseAmount } from "../../domain/src/amount.js";
import { assertLocalRpc, SolanaRpc } from "../../solana/src/rpc.js";
import { fixtureSigner, sendInstructions } from "./transactions.js";
const config = loadConfig();
assertLocalRpc(config.SOLANA_RPC_URL, config.APP_ENV, config.SOLANA_CLUSTER);
const invoiceId = process.argv[2];
if (!invoiceId)
  throw new Error(
    "Usage: pnpm local:pay <invoice-id> [amount] [--manual] [--asset USDT|USDC]",
  );
const assetIndex = process.argv.indexOf("--asset");
const chosenAsset = assetIndex >= 0 ? process.argv[assetIndex + 1] : null;
if (assetIndex >= 0 && chosenAsset !== "USDT" && chosenAsset !== "USDC")
  throw new Error("--asset must be USDT or USDC");
const pool = createPool(config.DATABASE_URL),
  rpc = new SolanaRpc(config.SOLANA_RPC_URL);
try {
  const result = await pool.query(
    `SELECT a.*,c.token_account,c.genesis_hash FROM invoices i JOIN payment_attempts a ON a.invoice_id=i.id AND a.asset=COALESCE($2,i.asset)
     JOIN token_configs c ON c.environment=a.environment AND c.cluster=a.cluster AND c.asset=a.asset AND c.mint=a.mint AND c.recipient=a.recipient
     WHERE i.id=$1 AND i.environment='local' AND i.cluster='localnet' AND a.payment_enabled`,
    [invoiceId, chosenAsset],
  );
  const invoice = result.rows[0];
  if (!invoice) throw new Error("Enabled local invoice not found");
  if ((await rpc.call<string>("getGenesisHash")) !== invoice.genesis_hash)
    throw new Error("Validator genesis mismatch");
  const sender = await fixtureSigner("sender");
  const [source] = await findAssociatedTokenPda({
    owner: sender.address,
    mint: address(invoice.mint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const amount =
    process.argv[3] && !process.argv[3].startsWith("--")
      ? parseAmount(process.argv[3])
      : BigInt(invoice.payable_units);
  const ix = getTransferCheckedInstruction({
    source,
    mint: address(invoice.mint),
    destination: address(invoice.token_account),
    authority: sender,
    amount,
    decimals: 6,
  });
  const instruction = process.argv.includes("--manual")
    ? ix
    : {
        ...ix,
        accounts: [
          ...ix.accounts,
          { address: address(invoice.reference), role: AccountRole.READONLY },
        ],
      };
  console.log(
    JSON.stringify({
      signature: await sendInstructions(rpc, sender, [instruction]),
      invoice_id: invoiceId,
      amount_base_units: amount.toString(),
      cluster: "localnet",
    }),
  );
} finally {
  await pool.end();
}
