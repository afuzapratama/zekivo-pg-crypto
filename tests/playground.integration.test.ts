import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { createPool } from "../packages/database/src/pool.js";
import { createInvoice } from "../packages/database/src/invoices.js";
import { buildPlayground } from "../packages/testkit/src/playground.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("local playground action isolation", () => {
  const pool = createPool(url!);
  const project = "00000000-0000-4000-8000-000000000001";
  const suffix = randomUUID();
  const token = "test-playground-control-token";
  let release: () => void = () => {};
  const runner = vi.fn(async () => "test-signature");
  const config = {
    environment: "local",
    cluster: "localnet",
    token,
    apiUrl: "http://localhost:4100",
    apiKey: "test-key-never-in-response",
  };
  const app = buildPlayground(pool, config, runner);
  const headers = { authorization: `Bearer ${token}` };
  beforeAll(async () => {
    await pool.query(
      "INSERT INTO projects(id,name,environment) VALUES($1,'Playground test','local') ON CONFLICT DO NOTHING",
      [project],
    );
  });
  beforeEach(() => {
    runner.mockReset();
    runner.mockResolvedValue("test-signature");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      return Response.json(
        path === "/health"
          ? { environment: "local", cluster: "localnet" }
          : path === "/openapi.json"
            ? { paths: {} }
            : { invoice: { id: randomUUID() }, items: [] },
      );
    });
  });
  afterEach(() => {
    release();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await app.close();
    await pool.query(
      "DELETE FROM idempotency_records WHERE invoice_id IN(SELECT id FROM invoices WHERE order_id LIKE $1)",
      [`${suffix}%`],
    );
    await pool.query(
      "DELETE FROM idempotency_records WHERE invoice_id IN(SELECT id FROM invoices WHERE order_id LIKE $1)",
      [`playground:${suffix}%`],
    );
    await pool.query(
      "DELETE FROM audit_logs WHERE entity_id IN(SELECT id::text FROM invoices WHERE order_id LIKE $1 OR order_id LIKE $2)",
      [`${suffix}%`, `playground:${suffix}%`],
    );
    await pool.query(
      "DELETE FROM invoices WHERE order_id LIKE $1 OR order_id LIKE $2",
      [`${suffix}%`, `playground:${suffix}%`],
    );
    await pool.end();
  });
  async function invoice(owned = true) {
    const row = (
      await createInvoice(pool, project, "local", "localnet", randomUUID(), {
        order_id: `${owned ? "playground:" : ""}${suffix}-${randomUUID()}`,
        asset: "USDC",
        amount: "2",
      })
    ).row;
    await pool.query("UPDATE invoices SET payment_enabled=true WHERE id=$1", [
      row.id,
    ]);
    return row;
  }
  function send(id: string, request_id = randomUUID(), mode = "exact") {
    return app.inject({
      method: "POST",
      url: `/invoices/${id}/pay`,
      headers,
      payload: { request_id, mode },
    });
  }
  async function wait(id: string) {
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              "SELECT status FROM playground_actions WHERE invoice_id=$1",
              [id],
            )
          ).rows[0]?.status,
      )
      .not.toBe("pending");
  }
  it("refuses devnet/mainnet tools and non-local gateway targets", () => {
    expect(() =>
      buildPlayground(pool, { ...config, cluster: "devnet" }, runner),
    ).toThrow("localnet only");
    expect(() =>
      buildPlayground(
        pool,
        { ...config, apiUrl: "https://external.example" },
        runner,
      ),
    ).toThrow("local gateway");
  });
  it("requires the control credential and only owns playground-created invoices", async () => {
    expect((await app.inject({ url: "/health" })).statusCode).toBe(401);
    const row = await invoice(false);
    expect((await send(row.id)).statusCode).toBe(404);
    expect(runner).not.toHaveBeenCalled();
  });
  it("bounds inputs and binds creation to a sandbox order prefix without exposing credentials", async () => {
    const input = {
      request_id: randomUUID(),
      order_id: "demo",
      asset: "USDC",
      amount: "2",
      expires_in_seconds: 1800,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/invoices",
          headers,
          payload: { ...input, amount: "1000" },
        })
      ).statusCode,
    ).toBe(400);
    const response = await app.inject({
      method: "POST",
      url: "/invoices",
      headers,
      payload: input,
    });
    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain(config.apiKey);
    const calls = vi.mocked(fetch).mock.calls;
    const post = calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]?.body)).order_id).toBe("playground:demo");
  });
  it("retries the same action ID without sending twice, including after completion", async () => {
    const row = await invoice(),
      key = randomUUID();
    runner.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("test-signature");
        }),
    );
    expect((await send(row.id, key)).statusCode).toBe(202);
    expect((await send(row.id, key)).statusCode).toBe(202);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]).toEqual([row.id, ["--asset", "USDC"]]);
    release();
    await wait(row.id);
    expect((await send(row.id, key)).json().action.status).toBe("completed");
    expect((await send(row.id)).statusCode).toBe(409);
    expect(runner).toHaveBeenCalledTimes(1);
  });
  it("keeps uncertain broadcasts blocked rather than automatically paying again", async () => {
    const row = await invoice();
    runner.mockRejectedValueOnce(new Error("RPC timeout after broadcast"));
    const key = randomUUID();
    await send(row.id, key);
    await wait(row.id);
    expect((await send(row.id, key)).json().action.status).toBe("unknown");
    expect((await send(row.id)).statusCode).toBe(409);
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
