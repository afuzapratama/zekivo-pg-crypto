import { adminRefundRoutes } from "./refunds.js";
import { adminMonitoringRoutes } from "./monitoring.js";
import { adminTransactionRoutes } from "./transactions.js";
import { adminNotificationRoutes } from "./notifications.js";
import { adminReviewRoutes } from "./reviews.js";
import { adminWebhookRoutes } from "./webhooks.js";
import { adminProjectRoutes } from "./projects.js";
import { readOperations } from "./operations.js";
import { SolanaRpc } from "../../solana/src/rpc.js";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import {
  invoiceListQuery,
  type InvoiceListQuery,
} from "../../contracts/src/invoices.js";
import {
  listInvoices,
  InvalidInvoiceCursor,
} from "../../database/src/list-invoices.js";
import { formatAmount } from "../../domain/src/amount.js";
import type { adminAuthRoutes } from "./routes.js";
export function adminDashboardRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  scope: {
    APP_ENV: string;
    SOLANA_CLUSTER: string;
    SOLANA_RPC_URL?: string;
    ENABLED_ASSETS?: string;
    CHAIN_MONITORING?: string;
    WEBHOOK_ENCRYPTION_KEY?: string;
    WEBHOOK_DELIVERY?: string;
    NOTIFICATION_ENCRYPTION_KEY?: string;
    LOCAL_MAILPIT_ENABLED?: string;
  },
  access: ReturnType<typeof adminAuthRoutes>,
) {
  const env = [scope.APP_ENV, scope.SOLANA_CLUSTER];
  let cached:
    | { at: number; data: Awaited<ReturnType<typeof readOperations>> }
    | undefined;
  let pending: Promise<Awaited<ReturnType<typeof readOperations>>> | undefined;

  app.register(
    async (admin) => {
      admin.addHook("preHandler", async (req, reply) =>
        access.requirePermission(req, reply, "dashboard:read"),
      );
      adminProjectRoutes(admin, pool, scope, access);
      adminRefundRoutes(admin, pool, scope, access);
      adminWebhookRoutes(admin, pool, scope, access);
      adminReviewRoutes(admin, pool, scope, access);
      adminTransactionRoutes(admin, pool, scope);
      adminMonitoringRoutes(admin, pool, scope);
      adminNotificationRoutes(admin, pool, scope, access);
      admin.get("/operations", async (_req, reply) => {
        if (!scope.SOLANA_RPC_URL)
          return reply.code(503).send({ error: "operations_unavailable" });
        try {
          if (cached && Date.now() - cached.at < 15000) return cached.data;
          pending ??= readOperations(
            pool,
            new SolanaRpc(scope.SOLANA_RPC_URL),
            scope,
          )
            .then((data) => {
              cached = { at: Date.now(), data };
              return data;
            })
            .finally(() => {
              pending = undefined;
            });
          return await pending;
        } catch {
          return reply.code(503).send({ error: "operations_unavailable" });
        }
      });
      admin.get("/projects", async () => ({
        items: (
          await pool.query(
            "SELECT id,name,created_at FROM projects WHERE environment=$1 ORDER BY name,id",
            [scope.APP_ENV],
          )
        ).rows,
      }));
      const projectQuery = {
        type: "object",
        additionalProperties: false,
        properties: { project_id: { type: "string", format: "uuid" } },
      } as const;
      admin.get<{ Querystring: { project_id?: string } }>(
        "/overview",
        { schema: { querystring: projectQuery } },
        async (req) => {
          const params = [...env, req.query.project_id ?? null];
          const [counts, gross] = await Promise.all([
            pool.query(
              `SELECT count(*)::text AS total,count(*) FILTER(WHERE status='paid')::text AS paid,count(*) FILTER(WHERE status='pending')::text AS pending,count(*) FILTER(WHERE status='confirming')::text AS confirming,count(*) FILTER(WHERE status='expired')::text AS expired,
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM chain_transfers t WHERE t.invoice_id=i.id AND t.environment=$1 AND t.cluster=$2 AND t.disposition NOT IN ('paid','unmatched') AND NOT EXISTS(SELECT 1 FROM transfer_reviews r WHERE r.transfer_id=t.id AND r.status='closed')))::text AS review
      FROM invoices i WHERE environment=$1 AND cluster=$2 AND ($3::uuid IS NULL OR project_id=$3)`,
              params,
            ),
            pool.query(
              `SELECT l.asset,sum(l.amount)::text AS units FROM ledger_entries l JOIN invoices i ON i.id=l.invoice_id WHERE i.environment=$1 AND i.cluster=$2 AND ($3::uuid IS NULL OR i.project_id=$3) AND l.entry_type='payment' GROUP BY l.asset`,
              params,
            ),
          ]);
          return {
            environment: scope.APP_ENV,
            cluster: scope.SOLANA_CLUSTER,
            counts: counts.rows[0],
            gross_received: ["USDT", "USDC"].map((asset) => ({
              asset,
              amount: formatAmount(
                BigInt(gross.rows.find((r) => r.asset === asset)?.units ?? "0"),
              ),
            })),
            as_of: new Date().toISOString(),
          };
        },
      );
      admin.get<{ Querystring: InvoiceListQuery & { project_id?: string } }>(
        "/invoices",
        {
          schema: {
            querystring: {
              ...invoiceListQuery,
              properties: {
                ...invoiceListQuery.properties,
                ...projectQuery.properties,
              },
            },
          },
        },
        async (req, reply) => {
          try {
            return await listInvoices(
              pool,
              req.query.project_id ?? null,
              ...(env as [string, string]),
              req.query,
              true,
            );
          } catch (error) {
            if (error instanceof InvalidInvoiceCursor)
              return reply.code(400).send({ error: "invalid_cursor" });
            throw error;
          }
        },
      );
      admin.get<{
        Params: { id: string };
        Querystring: {
          before_transfer?: string;
          before_event?: string;
          before_delivery?: string;
        };
      }>(
        "/invoices/:id",
        {
          schema: {
            params: {
              type: "object",
              required: ["id"],
              properties: { id: { type: "string", format: "uuid" } },
            },
            querystring: {
              type: "object",
              additionalProperties: false,
              properties: {
                before_transfer: { type: "string", pattern: "^[0-9]{1,18}$" },
                before_event: { type: "string", format: "uuid" },
                before_delivery: { type: "string", pattern: "^[0-9]{1,18}$" },
              },
            },
          },
        },
        async (req, reply) => {
          const row = (
            await pool.query(
              `SELECT i.id,i.project_id,p.name AS project_name,i.order_id,i.status,i.asset,i.cluster,i.invoice_version,i.created_at,i.expires_at,i.base_units::text,i.payable_units::text,i.payment_enabled,i.mint,i.recipient FROM invoices i JOIN projects p ON p.id=i.project_id WHERE i.id=$1 AND i.environment=$2 AND i.cluster=$3 AND p.environment=$2`,
              [req.params.id, ...env],
            )
          ).rows[0];
          if (!row) return reply.code(404).send({ error: "not_found" });
          const q = req.query;
          for (const [cursor, sql] of [
            [
              q.before_transfer,
              "SELECT 1 FROM chain_transfers WHERE id=$2 AND invoice_id=$1 AND environment=$3 AND cluster=$4",
            ],
            [
              q.before_event,
              "SELECT 1 FROM webhook_events WHERE event_id=$2 AND invoice_id=$1",
            ],
            [
              q.before_delivery,
              "SELECT 1 FROM webhook_deliveries d JOIN webhook_events e ON e.event_id=d.event_id JOIN webhook_endpoints h ON h.id=d.endpoint_id WHERE d.id=$2 AND e.invoice_id=$1 AND h.project_id=$3",
            ],
          ] as const) {
            if (cursor) {
              const args = sql.includes("environment=$3")
                ? [row.id, cursor, ...env]
                : sql.includes("h.project_id=$3")
                  ? [row.id, cursor, row.project_id]
                  : [row.id, cursor];
              if (!(await pool.query(sql, args)).rowCount)
                return reply.code(400).send({ error: "invalid_cursor" });
            }
          }
          const [transfers, events, attempts, deliveries] = await Promise.all([
            pool.query(
              "SELECT t.id::text,t.signature,t.instruction_path,t.slot::text,t.block_time,t.mint,t.amount::text,t.disposition,c.asset FROM chain_transfers t LEFT JOIN token_configs c ON c.environment=t.environment AND c.cluster=t.cluster AND c.mint=t.mint AND c.token_account=t.destination WHERE t.invoice_id=$1 AND t.environment=$2 AND t.cluster=$3 AND ($4::bigint IS NULL OR (t.block_time,t.id)<(SELECT block_time,id FROM chain_transfers WHERE id=$4 AND invoice_id=$1 AND environment=$2 AND cluster=$3)) ORDER BY t.block_time DESC,t.id DESC LIMIT 101",
              [row.id, ...env, q.before_transfer ?? null],
            ),
            pool.query(
              "SELECT event_id,event_type,created_at FROM webhook_events WHERE invoice_id=$1 AND ($2::uuid IS NULL OR (created_at,event_id)<(SELECT created_at,event_id FROM webhook_events WHERE event_id=$2 AND invoice_id=$1)) ORDER BY created_at DESC,event_id DESC LIMIT 101",
              [row.id, q.before_event ?? null],
            ),
            pool.query(
              "SELECT id,asset,mint,recipient,payable_units::text,activated_at,payment_enabled FROM payment_attempts WHERE invoice_id=$1 AND environment=$2 AND cluster=$3 ORDER BY asset",
              [row.id, ...env],
            ),
            pool.query(
              "SELECT d.id::text,d.event_id,d.status,d.attempt_count,d.last_http_status,d.last_error,d.delivered_at FROM webhook_deliveries d JOIN webhook_events e ON e.event_id=d.event_id JOIN webhook_endpoints h ON h.id=d.endpoint_id WHERE e.invoice_id=$1 AND h.project_id=$2 AND ($3::bigint IS NULL OR d.id<$3) ORDER BY d.id DESC LIMIT 101",
              [row.id, row.project_id, q.before_delivery ?? null],
            ),
          ]);
          const { base_units, payable_units, ...invoice } = row;
          return {
            invoice: {
              ...invoice,
              amount: formatAmount(BigInt(base_units)),
              payable_amount: formatAmount(BigInt(payable_units)),
            },
            transfers: transfers.rows
              .slice(0, 100)
              .map((t) => ({ ...t, amount: formatAmount(BigInt(t.amount)) })),
            events: events.rows.slice(0, 100),
            attempts: attempts.rows.map((a) => {
              const { payable_units, ...rest } = a;
              return {
                ...rest,
                payable_amount: formatAmount(BigInt(payable_units)),
              };
            }),
            deliveries: deliveries.rows.slice(0, 100),
            next_cursors: {
              transfers:
                transfers.rows.length > 100 ? transfers.rows[99]!.id : null,
              events:
                events.rows.length > 100 ? events.rows[99]!.event_id : null,
              deliveries:
                deliveries.rows.length > 100 ? deliveries.rows[99]!.id : null,
            },
            has_more: {
              transfers: transfers.rows.length > 100,
              events: events.rows.length > 100,
              deliveries: deliveries.rows.length > 100,
            },
          };
        },
      );
    },
    { prefix: "/admin" },
  );
}
