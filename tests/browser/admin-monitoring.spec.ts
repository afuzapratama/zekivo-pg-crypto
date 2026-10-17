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
test("monitor status, run history, pagination and finding links are accessible", async ({
  page,
}) => {
  await page.goto("/dashboard/monitoring");
  await expect(
    page.getByRole("heading", {
      name: "Monitoring & rekonsiliasi",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Status komponen" })
      .getByText("Terpantau", { exact: true }),
  ).toHaveCount(3);
  await page
    .getByRole("link", { name: "Pemeriksaan berikutnya", exact: true })
    .click();
  await expect(page).toHaveURL(/before_run=21/);
  await page
    .getByRole("link", { name: "Pemeriksaan terbaru", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Lihat hasil #21", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Kredit ledger tidak konsisten",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Buka invoice", exact: true }),
  ).toHaveAttribute("href", /\/dashboard\/invoices\//);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("stale monitor heartbeat prevents healthy component claims", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "monitor_stale", value: "1", url: baseURL! },
  ]);
  await page.goto("/dashboard/monitoring");
  const statuses = page.getByRole("region", { name: "Status komponen" });
  await expect(statuses.getByText("Terpantau", { exact: true })).toHaveCount(0);
  await expect(
    statuses.getByText("Belum terverifikasi", { exact: true }),
  ).toHaveCount(3);
  await expect(
    page.getByText("Monitor terpisah: Belum terverifikasi", { exact: true }),
  ).toBeVisible();
});
test("RPC-unavailable run shows incomplete chain verification", async ({
  page,
}) => {
  await page.goto("/dashboard/monitoring?run_id=20");
  await expect(
    page.getByRole("heading", { name: "Hasil rekonsiliasi #20", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Belum lengkap", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Bukti chain belum tersedia dari RPC.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0 / 2", { exact: true })).toBeVisible();
});
