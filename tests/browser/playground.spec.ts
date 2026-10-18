import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const id = "11111111-1111-4111-8111-111111111111";
const invoice = {
  id,
  order_id: "playground:demo",
  asset: "USDC",
  status: "pending",
  amount: "25.000000",
  payable_amount: "25.000127",
  checkout_url: `http://localhost:3100/pay/${"a".repeat(43)}`,
  payment_enabled: true,
  invoice_version: 1,
  recipient: "GbYRzP87315WdGrk7bS68K4fgQJ98pk31X7AkT2D4Mgp",
  mint: "6zx2z6jcnqH7t69QA2HBc88mpVjbHvgGBNUYN5Ro43Vt",
  reference: "B7WG8mXBEGSTX4Z7qP2UrTtAoz3jdZezdknbvzc98MFV",
  expires_at: new Date(Date.now() + 1800000).toISOString(),
};
test("playground responsive generator uses server credentials and renders persisted payment evidence", async ({
  page,
}, info) => {
  let paid = false;
  let requestId = "";
  await page.route("**/api/playground/**", async (route) => {
    const url = new URL(route.request().url());
    expect(route.request().headers()["authorization"]).toBeUndefined();
    if (url.pathname.endsWith("/health"))
      return route.fulfill({ json: { status: "ok" } });
    if (
      url.pathname.endsWith("/invoices") &&
      route.request().method() === "POST"
    ) {
      const body = route.request().postDataJSON();
      expect(body.payment_asset).toBe("USDC");
      expect(body.price_currency).toBe("USD");
      expect(body.price_amount).toBe("25.83");
      requestId = body.request_id;
      expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
      return route.fulfill({ json: { invoice } });
    }
    if (url.pathname.endsWith("/pay")) {
      paid = true;
      return route.fulfill({
        status: 202,
        json: { action: { status: "pending" } },
      });
    }
    return route.fulfill({
      json: {
        invoice: { ...invoice, status: paid ? "paid" : "pending" },
        transfers: paid
          ? [
              {
                signature: "test-only-signature",
                amount: "25000127",
                disposition: "paid",
                created_at: new Date().toISOString(),
              },
            ]
          : [],
        events: paid
          ? [
              {
                event_id: id,
                event_type: "payment.confirmed",
                payload: { schema_version: 1 },
                created_at: new Date().toISOString(),
              },
            ]
          : [],
        deliveries: paid
          ? [{ id: "1", status: "delivered", attempt_count: 1 }]
          : [],
        receipts: paid
          ? [
              {
                event_id: id,
                signature_verified: true,
                received_at: new Date().toISOString(),
              },
            ]
          : [],
        actions: paid
          ? [{ request_id: requestId, mode: "exact", status: "completed" }]
          : [],
      },
    });
  });
  await page.goto("/docs/playground");
  await expect(
    page.getByRole("button", { name: "Generate invoice", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Aset awal", { exact: true }).selectOption("USDT");
  await page.getByLabel("Aset awal", { exact: true }).selectOption("USDC");
  await page
    .getByRole("button", { name: "Generate invoice", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Buka checkout QR" }),
  ).toHaveAttribute("href", `/pay/${"a".repeat(43)}`);
  await page.getByRole("button", { name: "Bayar tepat", exact: true }).click();
  await expect(
    page.getByText("Merchant inbox · Signature verified", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bayar tepat", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("playground.png"),
    fullPage: true,
  });
});
test("docs display OpenAPI from the gateway contract and protect helper against public hostnames", async ({
  page,
  request,
}) => {
  await page.route("**/api/openapi", (route) =>
    route.fulfill({
      json: {
        openapi: "3.0.3",
        info: { title: "Zekivo Gateway API", version: "0.1.0" },
        servers: [{ url: "http://localhost:4100" }],
        paths: {
          "/v1/invoices": {
            post: {
              responses: { "201": { description: "Invoice created" } },
              requestBody: {
                content: { "application/json": { schema: { type: "object" } } },
              },
            },
          },
        },
      },
    }),
  );
  const external: string[] = [];
  page.on("request", (request) => {
    if (!["localhost", "127.0.0.1"].includes(new URL(request.url()).hostname))
      external.push(request.url());
  });
  await page.goto("/docs/api");
  await expect(
    page
      .getByText("/v1/invoices", { exact: true })
      .filter({ visible: true })
      .first(),
  ).toBeVisible({ timeout: 30000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(external).toEqual([]);
  const response = await request.get("/api/playground/health", {
    headers: { host: "untrusted.example" },
  });
  expect(response.status()).toBe(404);
});
test("@chain playground generates, pays and verifies webhook entirely through local UI", async ({
  page,
  context,
}) => {
  test.skip(
    process.env.LOCAL_CHAIN_E2E !== "1",
    "Local playground opt-in required",
  );
  test.setTimeout(150000);
  page.on("request", (r) =>
    expect(r.headers()["authorization"]).toBeUndefined(),
  );
  await page.goto("/docs/playground");
  await expect(
    page.getByRole("button", { name: "Generate invoice", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Harga pesanan (USD)", { exact: true }).fill("2.00");
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/playground/invoices") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Generate invoice", exact: true })
    .click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const createdInvoice = (await createdResponse.json()).invoice;
  expect(createdInvoice.price_currency).toBe("USD");
  expect(createdInvoice.price_amount).toBe("2.00");
  await expect(
    page.getByRole("link", { name: "Buka checkout QR" }),
  ).toBeVisible();
  const popup = context.waitForEvent("page");
  await page.getByRole("link", { name: "Buka checkout QR" }).click();
  const checkout = await popup;
  await expect(
    checkout.getByText("$2.00", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    checkout.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bayar tepat", exact: true }).click();
  await expect(
    checkout.getByText("Terverifikasi · finalized", { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(
    page.getByText("Merchant inbox · Signature verified", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect(page.getByText(/Webhook delivery delivered/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Merchant inbox · Signature verified", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bayar tepat", exact: true }),
  ).toBeDisabled();
});

test("@chain playground underpayment enters review without a paid webhook", async ({
  page,
}) => {
  test.skip(
    process.env.LOCAL_CHAIN_E2E !== "1",
    "Local playground opt-in required",
  );
  test.setTimeout(120000);
  await page.goto("/docs/playground");
  await expect(
    page.getByRole("button", { name: "Generate invoice", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Harga pesanan (USD)", { exact: true }).fill("2.00");
  await page.getByLabel("Aset awal", { exact: true }).selectOption("USDT");
  await page
    .getByRole("button", { name: "Generate invoice", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Bayar kurang", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Bayar kurang", exact: true }).click();
  await expect(page.getByText(/Transfer finalized · partial/)).toBeVisible({
    timeout: 90000,
  });
  await expect(page.getByText("pending", { exact: true })).toBeVisible();
  await expect(
    page.getByText("payment.confirmed", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Bayar tepat", exact: true }),
  ).toBeDisabled();
});
