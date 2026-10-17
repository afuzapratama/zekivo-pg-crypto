import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const id = "10000000-0000-4000-8000-000000000001";
test.beforeEach(async ({ context, baseURL }) => {
  test.skip(
    process.env.ADMIN_DASHBOARD_E2E !== "1",
    "Requires isolated fixture API",
  );
  await context.addCookies([
    { name: "dashboard_fixture", value: "1", url: baseURL! },
  ]);
});
test("read-only can open refund history from invoice without write controls", async ({
  page,
}, info) => {
  await page.goto(`/dashboard/invoices/${id}`);
  await page.getByRole("link", { name: "Riwayat refund", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${id}/refunds$`));
  await expect(
    page.getByRole("heading", { name: "Refund manual.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Verifikasi & catat refund",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("Hanya admin", { exact: false })).toBeVisible();
  await expect(page).toHaveTitle(/Zekivo Pay/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("refund-readonly.png"),
    fullPage: true,
  });
});
test("admin verifies submitted proof and sees immutable receipt; mismatched proof stays rejected", async ({
  page,
  context,
  baseURL,
}, info) => {
  await context.addCookies([
    { name: "project_admin", value: "1", url: baseURL! },
  ]);
  await page.goto(`/dashboard/invoices/${id}/refunds`);
  await page.getByLabel("Nominal refund", { exact: true }).fill("0.100000");
  await page
    .getByLabel("Alamat wallet tujuan", { exact: true })
    .fill("3toF4H23Winv3CehGrxW7CaqMuFcbQVRfaDoa8upVLkt");
  await page
    .getByLabel("Signature transaksi refund", { exact: true })
    .fill("3".repeat(88));
  await page.getByLabel("Instruction path", { exact: true }).fill("0");
  await page
    .getByLabel("Alasan refund", { exact: true })
    .fill(`Cancelled order ${info.project.name}`);
  await page
    .getByLabel("Bukti konfirmasi alamat tujuan", { exact: true })
    .fill("Confirmed via support ticket #123");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Verifikasi & catat refund", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Bukti tidak cocok" }),
  ).toContainText("Bukti tidak cocok");
  await page
    .getByLabel("Signature transaksi refund", { exact: true })
    .fill("2".repeat(88));
  await page
    .getByRole("button", { name: "Verifikasi & catat refund", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Refund finalized" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "0.100000 USDC · Confirmed" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Lihat transaksi refund" }).first(),
  ).toHaveAttribute("href", /cluster=devnet/);
  await expect(page).toHaveTitle(/Zekivo Pay/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("refund-confirmed.png"),
    fullPage: true,
  });
});
test("stale admin must reauthenticate before recording refund", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "project_admin", value: "1", url: baseURL! },
    { name: "project_stale", value: "1", url: baseURL! },
  ]);
  await page.goto(`/dashboard/invoices/${id}/refunds`);
  await expect(
    page.getByRole("link", { name: "Verifikasi ulang Microsoft", exact: true }),
  ).toHaveAttribute("href", "/login?reauth=1");
  await expect(
    page.getByRole("button", {
      name: "Verifikasi & catat refund",
      exact: true,
    }),
  ).toHaveCount(0);
});
