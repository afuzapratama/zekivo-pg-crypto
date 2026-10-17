import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getInitializeMint2Instruction,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import { loadConfig } from "../../config/src/index.js";
import { createPool } from "../../database/src/pool.js";
import { createInvoice } from "../../database/src/invoices.js";
import { settleTransfer } from "../../database/src/settle.js";
import { assertLocalRpc, SolanaRpc } from "../../solana/src/rpc.js";
import {
  decodeTransfers,
  type TokenConfig,
  type ParsedTransaction,
} from "../../solana/src/decode.js";
import { validateConfigs } from "../../solana/src/watcher.js";
import { buildApp } from "../../../apps/api/src/app.js";
import { fixtureSigner, sendInstructions } from "./transactions.js";
// Reproducible fixture signers must never run outside the local validator.
const config = loadConfig();
assertLocalRpc(config.SOLANA_RPC_URL, config.APP_ENV, config.SOLANA_CLUSTER);
const rpc = new SolanaRpc(config.SOLANA_RPC_URL),
  root = createPool(config.DATABASE_URL);
const run = randomUUID(),
  schema = `refund_smoke_${run.replaceAll("-", "")}`;
const database = new URL(config.DATABASE_URL);
database.searchParams.set("options", `-c search_path=${schema}`);
const pool = createPool(database.href);
const actor = randomUUID(),
  tenant = randomUUID(),
  session = randomBytes(32).toString("base64url"),
  csrf = randomBytes(32).toString("base64url"),
  origin = "http://localhost:3100";
const app = buildApp(
  pool,
  {
    APP_ENV: "local",
    SOLANA_CLUSTER: "localnet",
    SOLANA_RPC_URL: config.SOLANA_RPC_URL,
    WEB_ORIGIN: origin,
    ADMIN_AUTH: {
      tenant,
      clientId: randomUUID(),
      secret: randomBytes(32).toString("base64url"),
      origin,
      allowed: { [actor]: "admin" },
    },
  },
  false,
);
const proofs: Record<string, unknown>[] = [];
let schemaCreated = false;
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
try {
  const sender = await fixtureSigner("sender"),
    treasury = await fixtureSigner(`refund-smoke:treasury:${run}`);
  const balance = await rpc.call<{ value: number }>("getBalance", [
    sender.address,
    { commitment: "finalized" },
  ]);
  check(
    balance.value >= 20_000_000,
    "Local fixture sender needs SOL; run local:seed-chain first. No airdrop or reset is performed by this test.",
  );
  await root.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  for (const file of (
    await readdir(new URL("../../database/migrations/", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pool.query(
      await readFile(
        new URL(`../../database/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  const projectId = randomUUID();
  await pool.query(
    "INSERT INTO projects(id,name,environment)VALUES($1,'Isolated local refund smoke','local')",
    [projectId],
  );
  await pool.query(
    "INSERT INTO admin_sessions(token_hash,environment,cluster,tenant_id,object_id,csrf_token,expires_at,authenticated_at)VALUES($1,'local','localnet',$2,$3,$4,now()+interval '1 hour',now())",
    [createHash("sha256").update(session).digest("hex"), tenant, actor, csrf],
  );
  const genesis = await rpc.call<string>("getGenesisHash");
  const selectedAsset = process.argv[2];
  if (selectedAsset && !["USDC", "USDT"].includes(selectedAsset))
    throw new Error("Usage: pnpm local:refund-smoke [USDC|USDT]");
  const assets: ("USDC" | "USDT")[] =
    selectedAsset === "USDC" || selectedAsset === "USDT"
      ? [selectedAsset]
      : ["USDC", "USDT"];
  for (const asset of assets) {
    console.log(
      JSON.stringify({
        event: "refund_smoke.preparing",
        asset,
        cluster: "localnet",
      }),
    );
    const mint = await fixtureSigner(`refund-smoke:mint:${asset}:${run}`);
    const [source] = await findAssociatedTokenPda({
      owner: treasury.address,
      mint: mint.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [destination] = await findAssociatedTokenPda({
      owner: sender.address,
      mint: mint.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
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
        freezeAuthority: null,
      }),
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: sender,
        owner: treasury.address,
        mint: mint.address,
      }),
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: sender,
        owner: sender.address,
        mint: mint.address,
      }),
      getMintToInstruction({
        mint: mint.address,
        token: destination,
        mintAuthority: sender,
        amount: 10_000_000n,
      }),
    ]);
    const token: TokenConfig = {
      environment: "local",
      cluster: "localnet",
      asset,
      mint: mint.address,
      recipient: treasury.address,
      token_account: source,
      genesis_hash: genesis,
      decimals: 6,
    };
    await pool.query(
      "INSERT INTO token_configs VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        token.environment,
        token.cluster,
        asset,
        token.mint,
        token.recipient,
        source,
        genesis,
        6,
      ],
    );
    await validateConfigs(rpc, [token]);
    const invoice = (
      await createInvoice(
        pool,
        projectId,
        "local",
        "localnet",
        randomUUID(),
        { order_id: `refund-chain-${asset}-${run}`, asset, amount: "1" },
        true,
      )
    ).row;
    // Immediate automated payment must not race the validator's block clock.
    // Wait on chain time; never backdate invoice/attempt timestamps or relax matching.
    const earliest = Math.ceil(new Date(invoice.created_at).getTime() / 1000);
    for (let attempt = 0; ; attempt++) {
      const slot = await rpc.call<number>("getSlot", [
        { commitment: "confirmed" },
      ]);
      const blockTime = await rpc.call<number | null>("getBlockTime", [slot]);
      if (blockTime !== null && blockTime >= earliest) break;
      check(
        attempt < 59,
        "Validator clock has not reached invoice creation time; no payment sent",
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const paymentSignature = await sendInstructions(rpc, sender, [
      getTransferCheckedInstruction({
        source: destination,
        mint: mint.address,
        destination: source,
        authority: sender,
        amount: BigInt(invoice.payable_units),
        decimals: 6,
      }),
    ]);
    const paymentTx = await rpc.call<ParsedTransaction>("getTransaction", [
      paymentSignature,
      {
        encoding: "jsonParsed",
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      },
    ]);
    const incoming = decodeTransfers(paymentTx, [token]);
    check(incoming.length === 1, "Payment must decode exactly once");
    await settleTransfer(pool, token, paymentSignature, incoming[0]!);
    const paid = (
      await pool.query(
        "SELECT i.status,t.disposition FROM invoices i LEFT JOIN chain_transfers t ON t.invoice_id=i.id WHERE i.id=$1",
        [invoice.id],
      )
    ).rows[0];
    check(
      paid?.status === "paid",
      `Fresh local payment did not settle: ${JSON.stringify(paid)}. Inspect validator clock before retrying.`,
    );
    const refundSignature = await sendInstructions(rpc, sender, [
      getTransferCheckedInstruction({
        source,
        mint: mint.address,
        destination,
        authority: treasury,
        amount: 100_000n,
        decimals: 6,
      }),
    ]);
    const headers = {
      cookie: `zekivo_local_localnet_session=${session}`,
      origin,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    };
    const payload = {
      asset,
      amount: "0.100000",
      destination: sender.address,
      signature: refundSignature,
      instruction_path: "0",
      reason: "Isolated local chain refund smoke",
      destination_verification:
        "Local fixture sender identity checked by smoke harness",
      destination_confirmed: true,
    };
    const path = `/admin/invoices/${invoice.id}/refunds`;
    const wrong = await app.inject({
      method: "POST",
      url: path,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { ...payload, amount: "0.200000" },
    });
    check(
      wrong.statusCode === 422,
      `Wrong amount must fail closed (${wrong.statusCode}: ${wrong.json().error ?? "unknown"})`,
    );
    const first = await app.inject({
      method: "POST",
      url: path,
      headers,
      payload,
    });
    check(
      first.statusCode === 201,
      `Real refund verification failed: ${first.statusCode} ${first.json().error ?? ""}`,
    );
    const replay = await app.inject({
      method: "POST",
      url: path,
      headers,
      payload,
    });
    check(
      replay.statusCode === 200 && replay.json().id === first.json().id,
      "Retry must return the same receipt",
    );
    const duplicate = await app.inject({
      method: "POST",
      url: path,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload,
    });
    check(
      duplicate.statusCode === 409 &&
        duplicate.json().error === "refund_proof_already_used",
      "Duplicate proof must be rejected",
    );
    const result = (
      await pool.query(
        `SELECT i.status,(SELECT count(*)::int FROM ledger_entries WHERE invoice_id=i.id) AS credits,(SELECT count(*)::int FROM webhook_events WHERE invoice_id=i.id) AS events,(SELECT count(*)::int FROM manual_refunds WHERE invoice_id=i.id) AS refunds,(SELECT count(*)::int FROM admin_audit_logs WHERE action='refund.confirmed' AND entity_id=$2) AS audits FROM invoices i WHERE i.id=$1`,
        [invoice.id, first.json().id],
      )
    ).rows[0];
    check(
      result.status === "paid" &&
        result.credits === 1 &&
        result.events === 1 &&
        result.refunds === 1 &&
        result.audits === 1,
      "Refund changed payment accounting or duplicated audit",
    );
    const history = await app.inject({ url: path, headers });
    check(
      history.statusCode === 200 &&
        history.json().totals[0]?.amount === "0.100000",
      "Refund history totals mismatch",
    );
    const proof = {
      event: "refund_smoke.passed",
      asset,
      cluster: "localnet",
      invoice_id: invoice.id,
      payment_signature: paymentSignature,
      refund_signature: refundSignature,
      refund_id: first.json().id,
      wrong_amount_status: wrong.statusCode,
      duplicate_status: duplicate.statusCode,
      ...result,
    };
    proofs.push(proof);
    console.log(JSON.stringify(proof));
  }
} finally {
  await app.close();
  await pool.end();
  try {
    if (schemaCreated) await root.query(`DROP SCHEMA ${schema} CASCADE`);
  } finally {
    await root.end();
  }
}
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/refund-chain-smoke.json",
  JSON.stringify(
    {
      run,
      cluster: "localnet",
      checked_at: new Date().toISOString(),
      isolated_schema_dropped: true,
      proofs,
    },
    null,
    2,
  ) + "\n",
);
