import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { UsdInvoiceInput } from "../../contracts/src/usd-invoices.js";
import { createInvoice, Conflict } from "../../database/src/invoices.js";
import { convertUsdToToken } from "./decimal.js";
import { validateSnapshot, type Snapshot } from "./provider.js";
export type StoredQuote = {
  id: string;
  source: string;
  market_asset_id: string;
  rate_usd_per_token: string;
  rate_source_updated_at: string;
  fetched_at: string;
  converted_amount: string;
  rounding: "ceil_token_6";
  policy_version: "usd-quote-v1";
};
export type UsdContext = {
  input: UsdInvoiceInput;
  requestHash: string;
  quotes: Record<string, StoredQuote>;
  snapshot: Snapshot;
};
export async function createUsdInvoice(
  pool: pg.Pool,
  projectId: string,
  environment: string,
  cluster: string,
  key: string,
  input: UsdInvoiceInput,
  prices: { getPrices(): Promise<Snapshot & { fetchedAt: string }> },
  enablePayments = false,
) {
  const assets = [
    ...(input.allowed_payment_assets ?? [input.payment_asset]),
  ].sort();
  if (
    !assets.includes(input.payment_asset) ||
    new Set(assets).size !== assets.length
  )
    throw new Conflict(
      "Initial asset must be included in distinct payment choices",
    );
  // Validate original cents even on retry, then hash USD request, never a live rate.
  convertUsdToToken(input.price_amount, "1");
  const normalized = {
    ...input,
    allowed_payment_assets: assets,
    expires_in_seconds: input.expires_in_seconds ?? 900,
  };
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify([
        "usd-v2",
        input.order_id,
        input.price_currency,
        input.price_amount,
        input.payment_asset,
        assets,
        input.network,
        normalized.expires_in_seconds,
        input.description ?? null,
        Object.entries(input.metadata ?? {}).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ]),
    )
    .digest("hex");
  const previous = (
    await pool.query(
      "SELECT r.request_hash,i.* FROM idempotency_records r JOIN invoices i ON i.id=r.invoice_id WHERE r.project_id=$1 AND r.key=$2 AND i.environment=$3 AND i.cluster=$4",
      [projectId, key, environment, cluster],
    )
  ).rows[0];
  if (previous) {
    if (previous.request_hash !== requestHash)
      throw new Conflict("Idempotency key was used with a different request");
    return { row: previous, replayed: true };
  }
  const snapshot = await prices.getPrices();
  validateSnapshot(snapshot, Date.now(), 180);
  const quotes: Record<string, StoredQuote> = {};
  const payment_options = assets.map((asset) => {
    const rate = snapshot.rates.find((r) => r.asset === asset);
    if (!rate) throw new Conflict("Price reference is missing");
    const converted = convertUsdToToken(input.price_amount, rate.usdPerToken);
    quotes[asset] = {
      id: randomUUID(),
      source: snapshot.source,
      market_asset_id: rate.marketAssetId,
      rate_usd_per_token: rate.usdPerToken,
      rate_source_updated_at: rate.sourceUpdatedAt,
      fetched_at: snapshot.fetchedAt,
      converted_amount: converted.convertedAmount,
      rounding: "ceil_token_6",
      policy_version: "usd-quote-v1",
    };
    return {
      asset: asset as "USDT" | "USDC",
      amount: converted.convertedAmount,
    };
  });
  return createInvoice(
    pool,
    projectId,
    environment,
    cluster,
    key,
    {
      order_id: input.order_id,
      asset: input.payment_asset,
      amount: quotes[input.payment_asset]!.converted_amount,
      payment_options,
      expires_in_seconds: normalized.expires_in_seconds,
    },
    enablePayments,
    { input: normalized, requestHash, quotes, snapshot },
  );
}
