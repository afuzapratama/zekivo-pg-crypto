export type PricingErrorCode =
  | "configuration_invalid"
  | "upstream_unavailable"
  | "upstream_rate_limited"
  | "invalid_payload"
  | "stale_price"
  | "depeg"
  | "cooldown"
  | "quota_exceeded"
  | "cache_busy"
  | "storage_unavailable"
  | "invalid_amount";
export class PricingError extends Error {
  constructor(readonly code: PricingErrorCode) {
    super(`Pricing unavailable: ${code}`);
    this.name = "PricingError";
  }
}
