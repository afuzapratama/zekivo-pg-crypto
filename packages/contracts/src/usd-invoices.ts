export interface UsdInvoiceInput {
  order_id: string;
  price_currency: "USD";
  price_amount: string;
  payment_asset: "USDT" | "USDC";
  allowed_payment_assets?: ("USDT" | "USDC")[];
  network: "solana";
  expires_in_seconds?: number;
  description?: string;
  metadata?: Record<string, string>;
}
export const usdInvoiceBody = {
  type: "object",
  additionalProperties: false,
  required: [
    "order_id",
    "price_currency",
    "price_amount",
    "payment_asset",
    "network",
  ],
  properties: {
    order_id: { type: "string", minLength: 1, maxLength: 128 },
    price_currency: { type: "string", const: "USD" },
    price_amount: {
      type: "string",
      pattern: "^(0|[1-9][0-9]{0,9})\\.[0-9]{2}$",
    },
    payment_asset: { type: "string", enum: ["USDT", "USDC"] },
    allowed_payment_assets: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
      items: { type: "string", enum: ["USDT", "USDC"] },
    },
    network: { type: "string", const: "solana" },
    expires_in_seconds: {
      type: "integer",
      minimum: 60,
      maximum: 900,
      default: 900,
    },
    description: { type: "string", maxLength: 200 },
    metadata: {
      type: "object",
      maxProperties: 20,
      additionalProperties: { type: "string", maxLength: 256 },
    },
  },
} as const;
