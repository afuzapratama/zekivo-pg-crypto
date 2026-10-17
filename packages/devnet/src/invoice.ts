import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { devnetEnvironment } from "./environment.js";
const asset = process.argv.includes("--usdt") ? "USDT" : "USDC";
const env = devnetEnvironment();
if (
  env.DEVNET_API_URL !== "http://127.0.0.1:14100" ||
  env.WEB_ORIGIN !== "http://localhost:13100"
)
  throw new Error("Expected isolated loopback Devnet services");
const headers = {
  authorization: `Bearer ${env.DEVNET_API_KEY}`,
  "Content-Type": "application/json",
};
const dir = fileURLToPath(new URL("../../../.devnet/", import.meta.url));
await mkdir(dir, { recursive: true, mode: 0o700 });
const health = await fetch(`${env.DEVNET_API_URL}/health`).then((r) =>
  r.json(),
);
if (health.environment !== "staging" || health.cluster !== "devnet")
  throw new Error("Gateway environment mismatch");
const ready = await fetch(`${env.DEVNET_API_URL}/ready`);
if (!ready.ok) throw new Error("Devnet gateway is not ready");
const file = `${dir}/${asset === "USDT" ? "invoice-usdt.json" : "invoice.json"}`;
let previous: { order_id: string; invoice?: { id: string } } | undefined;
try {
  previous = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (previous?.invoice && !process.argv.includes("--new")) {
  const r = await fetch(
    `${env.DEVNET_API_URL}/v1/invoices/${previous.invoice.id}`,
    { headers },
  );
  if (!r.ok)
    throw new Error(
      "Previous invoice unavailable; inspect before creating another",
    );
  const invoice = await r.json();
  console.log(
    JSON.stringify({
      invoice_id: invoice.id,
      status: invoice.status,
      asset: invoice.asset,
      payable_amount: invoice.payable_amount,
      checkout_url: invoice.checkout_url,
      note: "Existing invoice reused; --new creates a new test order",
    }),
  );
} else {
  const order_id =
    previous && !previous.invoice && !process.argv.includes("--new")
      ? previous.order_id
      : `devnet-wallet:${randomUUID()}`;
  // Save the stable idempotency identity before making the request.
  await writeFile(file, JSON.stringify({ order_id }), { mode: 0o600 });
  const r = await fetch(`${env.DEVNET_API_URL}/v1/invoices`, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": order_id },
    body: JSON.stringify({
      order_id,
      asset,
      amount: "1",
      expires_in_seconds: 3600,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok)
    throw new Error(
      `Invoice request failed (${r.status}); retry uses the same order`,
    );
  const invoice = await r.json();
  await writeFile(file, JSON.stringify({ order_id, invoice }, null, 2), {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      invoice_id: invoice.id,
      asset: invoice.asset,
      payable_amount: invoice.payable_amount,
      checkout_url: invoice.checkout_url,
      expires_at: invoice.expires_at,
      note: "Pay the exact displayed amount using buyer Phantom on Devnet. No transfer was sent by this command.",
    }),
  );
}
