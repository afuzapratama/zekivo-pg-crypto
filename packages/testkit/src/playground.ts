import Fastify from "fastify";
import { z } from "zod";
import type pg from "pg";
import { formatAmount } from "../../domain/src/amount.js";
const uuid = z.uuid();
const PROJECT = "00000000-0000-4000-8000-000000000001";
const amount = z
  .string()
  .regex(/^(0|[1-9]\d{0,2})(\.\d{1,6})?$/)
  .refine((v) => Number(v) > 0);
const invoiceInput = z
  .object({
    request_id: uuid,
    order_id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    asset: z.enum(["USDT", "USDC"]),
    amount,
    expires_in_seconds: z.number().int().min(60).max(3600),
    payment_options: z
      .array(z.object({ asset: z.enum(["USDT", "USDC"]), amount }).strict())
      .min(1)
      .max(2)
      .optional(),
  })
  .strict();
export function buildPlayground(
  pool: pg.Pool,
  config: {
    environment: string;
    cluster: string;
    token: string;
    apiUrl: string;
    apiKey: string;
  },
  pay: (id: string, args: string[]) => Promise<string>,
) {
  if (config.environment !== "local" || config.cluster !== "localnet")
    throw new Error("Playground is localnet only");
  const app = Fastify({ logger: false, bodyLimit: 8192 });
  const apiURL = new URL(config.apiUrl);
  if (
    apiURL.protocol !== "http:" ||
    !["api", "localhost", "127.0.0.1"].includes(apiURL.hostname) ||
    apiURL.port !== "4100" ||
    apiURL.username ||
    apiURL.password
  )
    throw new Error("Playground requires the local gateway API");
  const jobs = new Set<Promise<void>>();
  async function gateway(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ) {
    const response = await fetch(new URL(path, apiURL), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error("gateway_unavailable_or_conflict");
    return response.json();
  }
  async function assertGateway() {
    const health = await gateway("/health");
    if (health.environment !== "local" || health.cluster !== "localnet")
      throw new Error("Wrong gateway environment");
  }
  async function owned(id: string) {
    if (!uuid.safeParse(id).success) return null;
    return (
      (
        await pool.query(
          "SELECT * FROM invoices WHERE id=$1 AND project_id=$2 AND environment='local' AND cluster='localnet' AND order_id LIKE 'playground:%'",
          [id, PROJECT],
        )
      ).rows[0] ?? null
    );
  }
  app.addHook("preHandler", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (req.headers.authorization !== `Bearer ${config.token}`)
      return reply.code(401).send({ error: "unauthorized" });
  });
  app.get("/health", async () => ({
    status: "ok",
    environment: "local",
    cluster: "localnet",
  }));
  app.get("/openapi", async (_req, reply) => {
    try {
      await assertGateway();
      return await gateway("/openapi.json");
    } catch {
      return reply.code(503).send({ error: "gateway_unavailable" });
    }
  });
  app.post("/invoices", async (req, reply) => {
    const parsed = invoiceInput.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid_invoice_input" });
    const { request_id, order_id, ...input } = parsed.data;
    try {
      await assertGateway();
      const invoice = await gateway(
        "/v1/invoices",
        "POST",
        { ...input, order_id: `playground:${order_id}` },
        `playground:${request_id}`,
      );
      return reply.code(201).send({ invoice });
    } catch {
      return reply.code(409).send({
        error: "invoice_not_created_check_input_or_retry_same_request",
      });
    }
  });
  app.get<{ Params: { id: string } }>("/invoices/:id", async (req, reply) => {
    if (!(await owned(req.params.id)))
      return reply.code(404).send({ error: "not_found" });
    try {
      await assertGateway();
      const invoice = await gateway(`/v1/invoices/${req.params.id}`);
      const [transfers, events, receipts, actions, delivery] =
        await Promise.all([
          pool.query(
            "SELECT signature,instruction_path,slot,amount::text,disposition,created_at FROM chain_transfers WHERE invoice_id=$1 ORDER BY id",
            [req.params.id],
          ),
          pool.query(
            "SELECT event_id,event_type,payload,created_at FROM webhook_events WHERE invoice_id=$1 ORDER BY created_at",
            [req.params.id],
          ),
          pool.query(
            "SELECT event_id,signature_verified,received_at FROM demo_webhook_receipts WHERE invoice_id=$1 AND project_id=$2",
            [req.params.id, PROJECT],
          ),
          pool.query(
            "SELECT request_id,mode,status,signature,created_at FROM playground_actions WHERE invoice_id=$1 ORDER BY created_at",
            [req.params.id],
          ),
          gateway(`/v1/webhook-deliveries?invoice_id=${req.params.id}`),
        ]);
      return {
        invoice,
        transfers: transfers.rows,
        events: events.rows,
        receipts: receipts.rows,
        actions: actions.rows,
        deliveries: delivery.items,
      };
    } catch {
      return reply.code(503).send({ error: "gateway_unavailable" });
    }
  });
  app.post<{ Params: { id: string } }>(
    "/invoices/:id/pay",
    async (req, reply) => {
      const parsed = z
        .object({
          request_id: uuid,
          mode: z.enum(["exact", "manual", "partial", "overpaid"]),
        })
        .strict()
        .safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid_payment_input" });
      const invoice = await owned(req.params.id);
      if (!invoice) return reply.code(404).send({ error: "not_found" });
      const { request_id, mode } = parsed.data;
      const previous = (
        await pool.query(
          "SELECT * FROM playground_actions WHERE request_id=$1",
          [request_id],
        )
      ).rows[0];
      if (previous) {
        if (previous.invoice_id !== invoice.id || previous.mode !== mode)
          return reply.code(409).send({ error: "request_id_conflict" });
        return reply
          .code(previous.status === "pending" ? 202 : 200)
          .send({ action: previous });
      }
      if (
        invoice.status !== "pending" ||
        !invoice.payment_enabled ||
        new Date(invoice.expires_at).getTime() <= Date.now()
      )
        return reply.code(409).send({ error: "invoice_not_payable" });
      try {
        await assertGateway();
      } catch {
        return reply.code(503).send({ error: "gateway_unavailable" });
      }
      try {
        await pool.query(
          "INSERT INTO playground_actions(request_id,invoice_id,mode,status) VALUES($1,$2,$3,'pending')",
          [request_id, invoice.id, mode],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505")
          return reply
            .code(409)
            .send({ error: "payment_already_running_or_request_exists" });
        throw error;
      }
      const units = BigInt(invoice.payable_units);
      const args =
        mode === "manual"
          ? ["--manual"]
          : mode === "partial"
            ? [formatAmount(units - 1n)]
            : mode === "overpaid"
              ? [formatAmount(units + 1n)]
              : [];
      const job = (async () => {
        try {
          const signature = await pay(invoice.id, [
            ...args,
            "--asset",
            invoice.asset,
          ]);
          await pool.query(
            "UPDATE playground_actions SET status='completed',signature=$2,updated_at=now() WHERE request_id=$1",
            [request_id, signature],
          );
        } catch {
          // Broadcast may have succeeded. Never automatically send again.
          await pool.query(
            "UPDATE playground_actions SET status='unknown',updated_at=now() WHERE request_id=$1",
            [request_id],
          );
        }
      })();
      jobs.add(job);
      void job.catch(() => {}).finally(() => jobs.delete(job));
      return reply
        .code(202)
        .send({ action: { request_id, mode, status: "pending" } });
    },
  );
  app.addHook("onClose", async () => {
    await Promise.allSettled(jobs);
  });
  return app;
}
