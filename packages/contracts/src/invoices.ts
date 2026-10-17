export const invoiceBody = {
  type: "object",
  additionalProperties: false,
  required: ["order_id", "asset", "amount"],
  properties: {
    order_id: { type: "string", minLength: 1, maxLength: 128 },
    asset: { type: "string", enum: ["USDT", "USDC"] },
    amount: {
      type: "string",
      pattern: "^(0|[1-9][0-9]{0,9})(\\.[0-9]{1,6})?$",
    },
    payment_options: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["asset", "amount"],
        properties: {
          asset: { type: "string", enum: ["USDT", "USDC"] },
          amount: {
            type: "string",
            pattern: "^(0|[1-9][0-9]{0,9})(\\.[0-9]{1,6})?$",
          },
        },
      },
    },
    expires_in_seconds: {
      type: "integer",
      minimum: 60,
      maximum: 3600,
      default: 1800,
    },
  },
} as const;
export interface InvoiceInput {
  order_id: string;
  asset: "USDT" | "USDC";
  amount: string;
  expires_in_seconds?: number;
  payment_options?: { asset: "USDT" | "USDC"; amount: string }[];
}

export interface InvoiceListQuery {
  limit?: number;
  before?: string;
  status?: "pending" | "confirming" | "paid" | "expired";
  asset?: "USDT" | "USDC";
  order_id?: string;
}
export const invoiceListQuery = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
    before: {
      type: "string",
      format: "uuid",
      description:
        "Exclusive cursor returned as next_cursor. Keep filters unchanged when continuing a page.",
    },
    status: {
      type: "string",
      enum: ["pending", "confirming", "paid", "expired"],
    },
    asset: { type: "string", enum: ["USDT", "USDC"] },
    order_id: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description: "Exact merchant order ID.",
    },
  },
} as const;
export const invoiceListResponse = {
  type: "object",
  required: ["items", "next_cursor"],
  additionalProperties: false,
  properties: {
    next_cursor: {
      anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "order_id",
          "invoice_version",
          "asset",
          "cluster",
          "status",
          "amount",
          "payable_amount",
          "created_at",
          "expires_at",
          "payment_enabled",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          order_id: { type: "string" },
          invoice_version: { type: "integer" },
          asset: { type: "string", enum: ["USDT", "USDC"] },
          cluster: { type: "string", enum: ["localnet", "devnet"] },
          status: {
            type: "string",
            enum: ["pending", "confirming", "paid", "expired"],
          },
          amount: { type: "string" },
          payable_amount: { type: "string" },
          created_at: { type: "string", format: "date-time" },
          expires_at: { type: "string", format: "date-time" },
          payment_enabled: { type: "boolean" },
        },
      },
    },
  },
} as const;
