import { adminDashboardRoutes } from "../../../packages/auth/src/dashboard.js";
import { adminAuthRoutes } from "../../../packages/auth/src/routes.js";
import type { AdminAuthConfig } from "../../../packages/auth/src/config.js";
import {
  listInvoices,
  InvalidInvoiceCursor,
} from "../../../packages/database/src/list-invoices.js";
import {
  invoiceListQuery,
  invoiceListResponse,
  type InvoiceListQuery,
} from "../../../packages/contracts/src/invoices.js";
import {
  checkoutInvoice,
  selectAsset,
} from "../../../packages/database/src/checkout.js";
import { webhookRoutes } from "../../../packages/webhooks/src/api.js";
import { SolanaRpc } from "../../../packages/solana/src/rpc.js";
import { validateConfigs } from "../../../packages/solana/src/watcher.js";
import type { TokenConfig } from "../../../packages/solana/src/decode.js";
import { assertEnabledAssets } from "../../../packages/solana/src/networks.js";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { createHash } from "node:crypto";
import type pg from "pg";
import {
  invoiceBody,
  type InvoiceInput,
} from "../../../packages/contracts/src/invoices.js";
import {
  createInvoice,
  serializeInvoice,
  Conflict,
} from "../../../packages/database/src/invoices.js";
export function buildApp(
  pool: pg.Pool,
  config: {
    ADMIN_AUTH?: AdminAuthConfig;
    APP_ENV: string;
    SOLANA_CLUSTER: string;
    WEB_ORIGIN: string;
    SOLANA_RPC_URL?: string;
    CHAIN_MONITORING?: string;
    ENABLED_ASSETS?: string;
    WEBHOOK_ENCRYPTION_KEY?: string;
    NOTIFICATION_ENCRYPTION_KEY?: string;
    LOCAL_MAILPIT_ENABLED?: string;
  },
  logging = true,
) {
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
    logger: logging
      ? {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            'req.headers["x-checkout-token"]',
            'res.headers["set-cookie"]',
          ],
          serializers: {
            req(req) {
              return {
                method: req.method,
                url: req.url.split("?")[0],
                hostname: req.hostname,
              };
            },
          },
        }
      : false,
    bodyLimit: 16384,
  });
  app.register(cors, {
    origin(origin, callback) {
      let allowed = origin === config.WEB_ORIGIN;
      if (
        origin &&
        config.APP_ENV === "local" &&
        config.SOLANA_CLUSTER === "localnet"
      ) {
        try {
          const candidate = new URL(origin);
          const configured = new URL(config.WEB_ORIGIN);
          allowed ||=
            candidate.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(candidate.hostname) &&
            candidate.port === configured.port;
        } catch {
          /* Invalid origins receive no CORS permission. */
        }
      }
      callback(null, allowed);
    },
    credentials: false,
    methods: ["GET", "POST"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Idempotency-Key",
      "X-Checkout-Token",
    ],
  });
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.register(swagger, {
    openapi: {
      info: { title: "Zekivo Gateway API", version: "0.1.0" },
      components: {
        securitySchemes: { merchantKey: { type: "http", scheme: "bearer" } },
      },
    },
  });
  app.after(() => {
    app.get("/openapi.json", { schema: { hide: true } }, async () =>
      app.swagger(),
    );
    app.get("/health", async () => ({
      status: "ok",
      service: "api",
      environment: config.APP_ENV,
      cluster: config.SOLANA_CLUSTER,
    }));
    app.get("/ready", async (_req, reply) => {
      try {
        await pool
          .query(
            "SELECT 1 FROM schema_migrations WHERE name='005_payment_attempts.sql'",
          )
          .then((result) => {
            if (!result.rowCount) throw new Error("Migration missing");
          });
        {
          const migration = await pool.query(
            "SELECT 1 FROM schema_migrations WHERE name='016_webhook_lifecycle.sql'",
          );
          if (!migration.rowCount)
            throw new Error("Webhook lifecycle migration missing");
        }
        if (config.CHAIN_MONITORING === "true") {
          const tokens = await pool.query<TokenConfig>(
            "SELECT * FROM token_configs WHERE environment=$1 AND cluster=$2",
            [config.APP_ENV, config.SOLANA_CLUSTER],
          );
          assertEnabledAssets(tokens.rows, config.ENABLED_ASSETS);
          if (!config.SOLANA_RPC_URL)
            throw new Error("Chain configuration missing");
          await validateConfigs(
            new SolanaRpc(config.SOLANA_RPC_URL),
            tokens.rows,
          );
        }
        return { status: "ready" };
      } catch {
        return reply.code(503).send({ status: "unavailable" });
      }
    });
    const adminAccess = adminAuthRoutes(app, pool, config, config.ADMIN_AUTH);
    adminDashboardRoutes(app, pool, config, adminAccess);
    // Capability token grants read access to one deliberately limited projection.
    app.get("/v1/checkout", async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      reply.header("Referrer-Policy", "no-referrer");
      const token = req.headers["x-checkout-token"];
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
        return reply.code(404).send({ error: "not_found" });
      const invoice = await checkoutInvoice(
        pool,
        token,
        config.APP_ENV,
        config.SOLANA_CLUSTER,
        config.WEB_ORIGIN,
      );
      if (!invoice) return reply.code(404).send({ error: "not_found" });
      return invoice;
    });
    app.post<{ Body: { asset: string; expected_version: number } }>(
      "/v1/checkout/asset",
      {
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["asset", "expected_version"],
            properties: {
              asset: { type: "string", enum: ["USDT", "USDC"] },
              expected_version: {
                type: "integer",
                minimum: 1,
                maximum: 2147483647,
              },
            },
          },
        },
      },
      async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        const token = req.headers["x-checkout-token"];
        if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
          return reply.code(404).send({ error: "not_found" });
        if (config.CHAIN_MONITORING !== "true" || !config.SOLANA_RPC_URL)
          return reply.code(503).send({ error: "chain_unavailable" });
        try {
          const tokens = await pool.query<TokenConfig>(
            "SELECT * FROM token_configs WHERE environment=$1 AND cluster=$2",
            [config.APP_ENV, config.SOLANA_CLUSTER],
          );
          assertEnabledAssets(tokens.rows, config.ENABLED_ASSETS);
          await validateConfigs(
            new SolanaRpc(config.SOLANA_RPC_URL),
            tokens.rows,
          );
        } catch {
          return reply.code(503).send({ error: "chain_unavailable" });
        }
        try {
          const result = await selectAsset(
            pool,
            token,
            config.APP_ENV,
            config.SOLANA_CLUSTER,
            req.body.asset,
            req.body.expected_version,
          );
          if (!result) return reply.code(404).send({ error: "not_found" });
          return result;
        } catch (error) {
          if (error instanceof Conflict)
            return reply
              .code(409)
              .send({ error: "conflict", message: error.message });
          throw error;
        }
      },
    );
    app.register(
      async (merchant) => {
        merchant.decorateRequest("projectId", "");
        merchant.addHook("onRoute", (options) => {
          options.schema = {
            ...options.schema,
            security: [{ merchantKey: [] }],
          };
        });
        merchant.addHook("preHandler", async (req, reply) => {
          const authorization = req.headers.authorization;
          if (!authorization?.startsWith("Bearer "))
            return reply.code(401).send({ error: "unauthorized" });
          const hash = createHash("sha256")
            .update(authorization.slice(7))
            .digest("hex");
          const result = await pool.query(
            "SELECT k.project_id FROM api_keys k JOIN projects p ON p.id=k.project_id WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>now()) AND p.environment=$2",
            [hash, config.APP_ENV],
          );
          if (!result.rows[0])
            return reply.code(401).send({ error: "unauthorized" });
          (req as typeof req & { projectId: string }).projectId =
            result.rows[0].project_id;
        });
        webhookRoutes(merchant, pool, config);
        merchant.post<{ Body: InvoiceInput }>(
          "/invoices",
          {
            schema: {
              summary: "Create invoice",
              tags: ["Invoices"],
              description:
                "Create or replay an invoice using a stable Idempotency-Key. Amounts are decimal strings. Supply merchant-approved payment_options for two asset choices.",
              body: invoiceBody,
              headers: {
                type: "object",
                properties: {
                  "idempotency-key": {
                    type: "string",
                    minLength: 1,
                    maxLength: 128,
                    description:
                      "Required. Reuse the same key and payload when retrying.",
                  },
                },
              },
            },
          },
          async (req, reply) => {
            const key = req.headers["idempotency-key"];
            if (typeof key !== "string" || key.length < 1 || key.length > 128)
              return reply.code(400).send({ error: "invalid_idempotency_key" });
            const projectId = (req as typeof req & { projectId: string })
              .projectId;
            try {
              if (config.CHAIN_MONITORING === "true") {
                const tokens = await pool.query<TokenConfig>(
                  "SELECT * FROM token_configs WHERE environment=$1 AND cluster=$2",
                  [config.APP_ENV, config.SOLANA_CLUSTER],
                );
                if (!config.SOLANA_RPC_URL)
                  return reply.code(503).send({ error: "chain_unavailable" });
                try {
                  assertEnabledAssets(tokens.rows, config.ENABLED_ASSETS);
                  await validateConfigs(
                    new SolanaRpc(config.SOLANA_RPC_URL),
                    tokens.rows,
                  );
                } catch {
                  return reply.code(503).send({ error: "chain_unavailable" });
                }
              }
              const result = await createInvoice(
                pool,
                projectId,
                config.APP_ENV,
                config.SOLANA_CLUSTER,
                key,
                req.body,
                config.CHAIN_MONITORING === "true",
              );
              return reply
                .code(result.replayed ? 200 : 201)
                .send(serializeInvoice(result.row, config.WEB_ORIGIN));
            } catch (error) {
              if (error instanceof Conflict)
                return reply
                  .code(409)
                  .send({ error: "conflict", message: error.message });
              if (error instanceof Error && error.message.startsWith("Amount"))
                return reply.code(400).send({ error: "invalid_amount" });
              throw error;
            }
          },
        );
        merchant.get<{ Querystring: InvoiceListQuery }>(
          "/invoices",
          {
            schema: {
              summary: "List invoices",
              tags: ["Invoices"],
              description:
                "Project-scoped invoice summaries, newest first (created_at and ID descending). Follow next_cursor as before with the same filters. No checkout capability URLs are returned. Mutable filters do not provide a historical snapshot.",
              querystring: invoiceListQuery,
              response: { 200: invoiceListResponse },
            },
          },
          async (req, reply) => {
            reply.header("Cache-Control", "no-store");
            try {
              return await listInvoices(
                pool,
                (req as typeof req & { projectId: string }).projectId,
                config.APP_ENV,
                config.SOLANA_CLUSTER,
                req.query,
              );
            } catch (error) {
              if (error instanceof InvalidInvoiceCursor)
                return reply.code(400).send({ error: "invalid_cursor" });
              throw error;
            }
          },
        );
        merchant.get<{ Params: { id: string } }>(
          "/invoices/:id",
          {
            schema: {
              summary: "Get invoice",
              tags: ["Invoices"],
              params: {
                type: "object",
                required: ["id"],
                properties: { id: { type: "string", format: "uuid" } },
              },
            },
          },
          async (req, reply) => {
            reply.header("Cache-Control", "no-store");
            const projectId = (req as typeof req & { projectId: string })
              .projectId;
            const result = await pool.query(
              "SELECT * FROM invoices WHERE id=$1 AND project_id=$2 AND environment=$3 AND cluster=$4",
              [req.params.id, projectId, config.APP_ENV, config.SOLANA_CLUSTER],
            );
            if (!result.rows[0])
              return reply.code(404).send({ error: "not_found" });
            return serializeInvoice(result.rows[0], config.WEB_ORIGIN);
          },
        );
      },
      { prefix: "/v1" },
    );
  });
  return app;
}
