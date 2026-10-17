export const DECIMALS = 6;
export function parseAmount(value: string): bigint {
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,6})?$/.test(value))
    throw new Error("Amount must be a positive decimal with at most 6 places");
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (amount <= 0n) throw new Error("Amount must be positive");
  return amount;
}
export function formatAmount(value: bigint): string {
  return `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, "0")}`;
}
