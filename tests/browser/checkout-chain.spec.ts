import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

for (const asset of ["USDT", "USDC"] as const) {
  test(`@chain ${asset}: browser invoice → local transfer → finalized → signed webhook → one fulfillment`, async ({
    page,
    request,
  }) => {
    test.skip(
      process.env.LOCAL_CHAIN_E2E !== "1",
      "Explicit local chain opt-in required",
    );
    test.setTimeout(120000);
    const api = "http://127.0.0.1:4100";
    const health = await request.get(`${api}/health`);
    expect(await health.json()).toMatchObject({
      environment: "local",
      cluster: "localnet",
    });
    const key = `browser-${asset}-${randomUUID()}`;
    const created = await request.post(`${api}/v1/invoices`, {
      headers: {
        authorization: "Bearer zk_local_development_only",
        "idempotency-key": key,
      },
      data: { order_id: key, asset, amount: "2" },
    });
    expect(created.status()).toBe(201);
    const invoice = await created.json();
    expect(invoice.payment_enabled).toBe(true);
    expect(invoice.cluster).toBe("localnet");
    page.on("request", (r) =>
      expect(r.headers()["authorization"]).toBeUndefined(),
    );
    await page.goto(new URL(invoice.checkout_url).pathname);
    const wallet = page.getByRole("link", { name: "Buka wallet Solana Pay" });
    await expect(wallet).toBeVisible();
    const uri = new URL((await wallet.getAttribute("href"))!);
    expect(uri.searchParams.get("amount")).toBe(invoice.payable_amount);
    expect(uri.searchParams.get("spl-token")).toBe(invoice.mint);
    expect(uri.searchParams.get("reference")).toBe(invoice.reference);
    const args = [
      "compose",
      "exec",
      "-T",
      "api",
      "pnpm",
      "local:pay",
      invoice.id,
    ];
    if (asset === "USDC") args.push("--manual");
    await exec("docker", args, { timeout: 90000 });
    await expect(
      page.getByText("Terverifikasi · finalized", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(wallet).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByText("Terverifikasi · finalized", { exact: true }),
    ).toBeVisible();
    // Receiver verifies the real signature, commits receipt and fulfillment atomically.
    await expect
      .poll(
        async () => {
          const response = await request.get(
            `http://127.0.0.1:4200/test/inbox?invoice_id=${invoice.id}`,
            {
              headers: { authorization: "Bearer local_receiver_control_only" },
            },
          );
          expect(response.status()).toBe(200);
          const inbox = await response.json();
          return {
            receipts: inbox.receipts.length,
            verified: inbox.receipts[0]?.signature_verified,
            status: inbox.orders[0]?.status,
            fulfillments: inbox.orders[0]?.fulfillment_count,
          };
        },
        { timeout: 30000 },
      )
      .toEqual({
        receipts: 1,
        verified: true,
        status: "paid",
        fulfillments: 1,
      });
  });
}

test("@chain switched quote preserves old payment matching and records a second asset as review", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.LOCAL_CHAIN_E2E !== "1",
    "Explicit local chain opt-in required",
  );
  test.setTimeout(150000);
  const api = "http://127.0.0.1:4100";
  expect(await (await request.get(`${api}/health`)).json()).toMatchObject({
    environment: "local",
    cluster: "localnet",
  });
  const key = `browser-switch-${randomUUID()}`;
  const created = await request.post(`${api}/v1/invoices`, {
    headers: {
      authorization: "Bearer zk_local_development_only",
      "idempotency-key": key,
    },
    data: {
      order_id: key,
      asset: "USDT",
      amount: "2",
      payment_options: [
        { asset: "USDT", amount: "2" },
        { asset: "USDC", amount: "1.9" },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const invoice = await created.json();
  await page.goto(new URL(invoice.checkout_url).pathname);
  const wallet = page.getByRole("link", { name: "Buka wallet Solana Pay" });
  await expect(wallet).toBeVisible();
  const oldURI = await wallet.getAttribute("href");
  await page.getByText("Ganti aset pembayaran", { exact: true }).click();
  await page
    .getByRole("button", {
      name: "Belum mengirim, gunakan USDC · 1.900000",
      exact: true,
    })
    .click();
  await expect(wallet).toBeVisible();
  await expect(wallet).not.toHaveAttribute("href", oldURI!);
  const selected = await (
    await request.get(`${api}/v1/invoices/${invoice.id}`, {
      headers: { authorization: "Bearer zk_local_development_only" },
    })
  ).json();
  expect(selected).toMatchObject({
    asset: "USDC",
    amount: "1.900000",
    invoice_version: 2,
    expires_at: invoice.expires_at,
  });
  // Simulate a payer who already had the old wallet request before switching.
  await exec(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "api",
      "pnpm",
      "local:pay",
      invoice.id,
      "--asset",
      "USDT",
    ],
    { timeout: 90000 },
  );
  await expect(
    page.getByText("Terverifikasi · finalized", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const paid = await (
    await request.get(`${api}/v1/invoices/${invoice.id}`, {
      headers: { authorization: "Bearer zk_local_development_only" },
    })
  ).json();
  expect(paid).toMatchObject({
    asset: "USDT",
    status: "paid",
    invoice_version: 3,
  });
  await exec(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "api",
      "pnpm",
      "local:pay",
      invoice.id,
      "--asset",
      "USDC",
      "--manual",
    ],
    { timeout: 90000 },
  );
  const token = new URL(invoice.checkout_url).pathname.split("/").pop()!;
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`${api}/v1/checkout`, {
              headers: { "x-checkout-token": token },
            })
          ).json()
        ).review_reasons,
      { timeout: 30000 },
    )
    .toContain("duplicate_payment");
  await expect
    .poll(
      async () => {
        const inbox = await (
          await request.get(
            `http://127.0.0.1:4200/test/inbox?invoice_id=${invoice.id}`,
            {
              headers: { authorization: "Bearer local_receiver_control_only" },
            },
          )
        ).json();
        return {
          receipts: inbox.receipts.length,
          verified: inbox.receipts[0]?.signature_verified,
          fulfillments: inbox.orders[0]?.fulfillment_count,
          version: inbox.orders[0]?.last_version,
        };
      },
      { timeout: 30000 },
    )
    .toEqual({ receipts: 1, verified: true, fulfillments: 1, version: 3 });
});
