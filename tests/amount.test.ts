import { describe, it, expect } from "vitest";
import { parseAmount, formatAmount } from "../packages/domain/src/amount.js";
import { loadConfig } from "../packages/config/src/index.js";
describe("amount", () => {
  it("preserves precision without floating point", () => {
    expect(parseAmount("25.0037")).toBe(25003700n);
    expect(formatAmount(25003700n)).toBe("25.003700");
  });
  it.each(["0", "-1", "1e2", "01", "1.0000001", "NaN", " 1"])(
    "rejects invalid %s",
    (value) => expect(() => parseAmount(value)).toThrow(),
  );
});
it("fails closed for mainnet and production", () => {
  expect(() =>
    loadConfig({
      DATABASE_URL: "postgres://localhost/db",
      SOLANA_CLUSTER: "mainnet-beta",
    }),
  ).toThrow();
  expect(() =>
    loadConfig({
      DATABASE_URL: "postgres://localhost/db",
      APP_ENV: "production",
    }),
  ).toThrow();
});
