import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ context, baseURL }) => {
  test.skip(
    process.env.ADMIN_DASHBOARD_E2E !== "1",
    "Requires isolated fixture",
  );
  await context.addCookies([
    { name: "dashboard_fixture", value: "1", url: baseURL! },
  ]);
});
test("transactions shows paid/unmatched, paginates, filters and preserves explorer cluster", async ({
  page,
}, info) => {
  await page.goto("/dashboard/transactions");
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  const container =
    (info.project.use.viewport?.width ?? 1440) >= 1280
      ? page.locator("tbody")
      : page.locator("article");
  await expect(
    container.getByText("Pembayaran diterima", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Transfer berikutnya", exact: true })
    .click();
  await expect(page).toHaveURL(/before=/);
  await page
    .getByRole("link", { name: "Transfer terbaru", exact: true })
    .click();
  await page
    .getByLabel("Signature lengkap", { exact: true })
    .fill("2".repeat(88));
  await page
    .getByRole("button", { name: "Terapkan filter", exact: true })
    .click();
  const explorer = page
    .getByRole("link", { name: /Explorer transfer #/ })
    .filter({ visible: true });
  await expect(explorer).toHaveCount(2);
  await expect(explorer.first()).toHaveAttribute("href", /cluster=devnet/);
  await page
    .getByLabel("Token transaksi", { exact: true })
    .selectOption("USDC");
  await page
    .getByRole("button", { name: "Terapkan filter", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Tidak ada transfer sesuai filter." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("invoice transfer/event/delivery histories paginate independently", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "history_fixture", value: "1", url: baseURL! },
  ]);
  await page.goto("/dashboard/invoices/10000000-0000-4000-8000-000000000001");
  const transfers = page.getByRole("navigation", {
      name: "Halaman transfers",
      exact: true,
    }),
    events = page.getByRole("navigation", {
      name: "Halaman events",
      exact: true,
    }),
    deliveries = page.getByRole("navigation", {
      name: "Halaman deliveries",
      exact: true,
    });
  await transfers
    .getByRole("link", { name: "Riwayat berikutnya", exact: true })
    .click();
  await expect(page).toHaveURL(/before_transfer=100/);
  await events
    .getByRole("link", { name: "Riwayat berikutnya", exact: true })
    .click();
  await expect(page).toHaveURL(/before_transfer=100.*before_event=/);
  await expect(
    page.getByText("fixture.older_event", { exact: true }),
  ).toBeVisible();
  await deliveries
    .getByRole("link", { name: "Riwayat berikutnya", exact: true })
    .click();
  await expect(page).toHaveURL(/before_delivery=200/);
  await transfers
    .getByRole("link", { name: "Riwayat terbaru", exact: true })
    .click();
  await expect(page).not.toHaveURL(/before_transfer=/);
  await expect(page).toHaveURL(/before_event=.*before_delivery=/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
