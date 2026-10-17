import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ context, baseURL }) => {
  test.skip(
    process.env.ADMIN_DASHBOARD_E2E !== "1",
    "Requires isolated fixture API + web preview",
  );
  await context.addCookies([
    { name: "dashboard_fixture", value: "1", url: baseURL! },
  ]);
});
test("dashboard overview, responsive list, filters and pagination", async ({
  page,
}, info) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Overview pembayaran." }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Saldo wallet dan scanner" }),
  ).toHaveCount(0);
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
  await expect(
    page.getByRole("heading", { name: "Daftar invoice" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Status", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Lihat invoice", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/invoices$/);
  await expect(
    page.getByRole("heading", { name: "Invoice.", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Halaman berikutnya" }).click();
  await expect(page).toHaveURL(/before=/);
  await expect(
    page.getByRole("link", { name: "Kembali ke awal" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Halaman berikutnya" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Kembali ke awal" }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("paid");
  await page.getByLabel("Aset", { exact: true }).selectOption("USDT");
  await page.getByRole("button", { name: "Terapkan filter" }).click();
  await expect(page).toHaveURL(/status=paid/);
  await page.getByRole("button", { name: "Perbarui data" }).click();
  await expect(
    page.getByRole("button", { name: "Perbarui data" }),
  ).toBeEnabled();
  await expect(page).toHaveURL(/status=paid/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Order ID", { exact: true }).fill("does-not-exist");
  await page.getByRole("button", { name: "Terapkan filter" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Tidak ada invoice sesuai filter." }),
  ).toHaveText("Tidak ada invoice sesuai filter.");
  await page.screenshot({
    path: info.outputPath("dashboard-empty.png"),
    fullPage: true,
  });
});
test("invoice detail shows evidence and preserves Devnet explorer cluster", async ({
  page,
}, info) => {
  await page.goto("/dashboard/invoices/10000000-0000-4000-8000-000000000001");
  await expect(
    page.getByRole("heading", { name: "Detail invoice." }),
  ).toBeVisible();
  await expect(
    page.getByText("payment.confirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Event yang sudah dibuat tidak membuktikan/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Lihat transaksi di Solana Explorer" }),
  ).toHaveAttribute("href", /cluster=devnet/);
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
    path: info.outputPath("dashboard-detail.png"),
    fullPage: true,
  });
});

test("admin navigation separates wallet/scanner from overview and invoices", async ({
  page,
}, info) => {
  await page.goto("/dashboard");
  const mobile = (info.project.use.viewport?.width ?? 1440) < 1024;
  if (mobile)
    await page.locator("summary").filter({ hasText: "Menu workspace" }).click();
  const navigation = page.getByRole("navigation", { name: "Navigasi admin" });
  await expect(navigation).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "API reference" }),
  ).toHaveAttribute("href", "/docs/api");
  await navigation
    .getByRole("link", { name: "Wallet & scanner", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/wallet$/);
  await expect(
    page.getByRole("heading", { name: "Wallet & scanner", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Saldo Mock USDT" }),
  ).toBeVisible();
  await expect(
    page.getByText("Head finalized 511955700", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Daftar invoice" }),
  ).toHaveCount(0);
  await expect(page).toHaveTitle(/Zekivo Pay/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (mobile)
    await page.locator("summary").filter({ hasText: "Menu workspace" }).click();
  await expect(
    navigation.getByRole("link", { name: "Wallet & scanner", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("link", { name: "Invoice", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/invoices$/);
  await expect(
    page.getByRole("heading", { name: "Daftar invoice" }),
  ).toBeInViewport();
  if (mobile) await expect(navigation).not.toBeVisible();
});
