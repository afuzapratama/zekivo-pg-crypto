import { formatAmount } from "../../domain/src/amount.js";
import { PricingError } from "./errors.js";

// Parse the original decimal lexeme, including JSON exponent notation. Monetary
// values never pass through Number/parseFloat. Exponent/scale are bounded metadata.
export function decimal(value: string): { units: bigint; scale: number } {
  const m = /^(\d{1,30})(?:\.(\d{1,24}))?(?:[eE]([+-]?\d{1,2}))?$/.exec(value);
  if (!m) throw new PricingError("invalid_amount");
  const fraction = m[2] ?? "";
  let scale = fraction.length - Number(m[3] ?? "0");
  if (Math.abs(scale) > 24) throw new PricingError("invalid_amount");
  let units = BigInt(m[1]! + fraction);
  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { units, scale };
}
export function normalizeDecimal(value: string): string {
  const { units, scale } = decimal(value);
  if (!scale) return units.toString();
  const digits = units.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
export function assertStableRate(value: string) {
  const { units, scale } = decimal(value);
  const denominator = 10n ** BigInt(scale);
  if (units <= 0n) throw new PricingError("invalid_payload");
  if (units * 100n < denominator * 99n || units * 100n > denominator * 101n)
    throw new PricingError("depeg");
}
export function convertUsdToToken(priceAmount: string, usdPerToken: string) {
  if (!/^(0|[1-9]\d{0,9})\.\d{2}$/.test(priceAmount))
    throw new PricingError("invalid_amount");
  const cents = BigInt(priceAmount.replace(".", ""));
  if (cents <= 0n) throw new PricingError("invalid_amount");
  assertStableRate(usdPerToken);
  const rate = decimal(usdPerToken);
  const numerator = cents * 10n ** BigInt(rate.scale + 6);
  const denominator = 100n * rate.units;
  const units = (numerator + denominator - 1n) / denominator;
  // Same maximum token amount as the existing payment domain.
  if (units > 9_999_999_999_999_999n) throw new PricingError("invalid_amount");
  return { convertedUnits: units, convertedAmount: formatAmount(units) };
}
