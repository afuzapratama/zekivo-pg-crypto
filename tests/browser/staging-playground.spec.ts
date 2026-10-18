import { test, expect } from "@playwright/test";
const api = "https://staging-api.example.test";
const secret = "zk_staging_test_only_not_a_real_key";
const id = "11111111-1111-4111-8111-111111111111";
test.skip(
  process.env.STAGING_PLAYGROUND_E2E !== "1",
  "Dedicated staging-mode web server required",
);
for (const uncertain of [false, true]) {
  test(`@staging Devnet playground ${uncertain ? "retries the same request" : "connects, creates and disconnects"}`, async ({
    page,
  }, info) => {
    let calls = 0;
    let requestKey = "";
    let requestBody = "";
    await page.route(`${api}/**`, async (route) => {
      const req = route.request();
      const headers = {
        "Access-Control-Allow-Origin": "http://127.0.0.1:3101",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, Idempotency-Key",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      };
      if (req.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      expect(req.headers().authorization).toBe(`Bearer ${secret}`);
      const path = new URL(req.url()).pathname;
      if (path === "/v1/invoices")
        return route.fulfill({
          headers,
          json: { items: [], next_cursor: null },
        });
      const invoice = {
        id,
        order_id: "ZKV-STAGING",
        asset: "USDC",
        cluster: "devnet",
        status: "pending",
        price_currency: "USD",
        price_amount: "25.83",
        payable_amount: "25.835767",
        checkout_url: `http://127.0.0.1:3101/pay/${"a".repeat(43)}`,
        expires_at: new Date(Date.now() + 900000).toISOString(),
        payment_enabled: true,
      };
      if (path === "/v2/invoices") {
        calls++;
        if (calls === 1) {
          requestKey = req.headers()["idempotency-key"]!;
          requestBody = req.postData()!;
        } else {
          expect(req.headers()["idempotency-key"]).toBe(requestKey);
          expect(req.postData()).toBe(requestBody);
        }
        expect(JSON.parse(req.postData()!).price_amount).toBe("25.83");
        expect(requestKey).toMatch(/^[a-f0-9-]{36}$/);
        if (uncertain && calls === 1)
          return route.fulfill({
            status: 503,
            headers,
            json: { error: "pricing_unavailable" },
          });
        return route.fulfill({
          status: calls === 1 ? 201 : 200,
          headers,
          json: invoice,
        });
      }
      if (path === `/v1/invoices/${id}`)
        return route.fulfill({ headers, json: { ...invoice, status: "paid" } });
      if (path === "/v1/webhook-deliveries")
        return route.fulfill({
          headers,
          json: {
            items: [
              { id: "1", event_id: id, status: "pending", attempt_count: 0 },
            ],
          },
        });
      throw new Error("Unexpected API path");
    });
    await page.goto("/docs/playground");
    await expect(
      page.getByText("SOLANA DEVNET · STAGING", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("API key staging").fill(secret);
    await page.getByRole("button", { name: "Hubungkan project" }).click();
    await expect(
      page.getByText("API key terhubung", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Generate invoice", exact: true })
      .click();
    if (uncertain) {
      await expect(
        page.getByRole("button", { name: "Ulang request yang sama" }),
      ).toBeEnabled();
      await expect(page.getByLabel("Harga pesanan (USD)")).toBeDisabled();
      await page
        .getByRole("button", { name: "Ulang request yang sama" })
        .click();
    }
    await expect(
      page.getByRole("link", { name: "Buka checkout Devnet" }),
    ).toBeVisible();
    await expect(page.getByText("paid", { exact: true })).toBeVisible();
    await expect(page.getByText(/pending · 0 percobaan/)).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          Object.values(localStorage).join() +
          Object.values(sessionStorage).join(),
      ),
    ).not.toContain(secret);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(page.url()).not.toContain(secret);
    await page.screenshot({
      path: `test-results/ui/staging-playground-${uncertain}-${info.project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Putuskan koneksi" }).click();
    await expect(page.getByLabel("API key staging")).toHaveValue("");
    await expect(
      page.getByRole("link", { name: "Buka checkout Devnet" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Generate invoice", exact: true }),
    ).toBeDisabled();
  });
}
