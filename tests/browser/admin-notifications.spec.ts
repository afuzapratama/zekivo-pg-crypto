import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ context, baseURL }) => {
  test.skip(
    process.env.ADMIN_DASHBOARD_E2E !== "1",
    "Requires isolated dashboard fixture",
  );
  await context.addCookies([
    { name: "dashboard_fixture", value: "1", url: baseURL! },
  ]);
});
test("read-only admin notification log is accessible and shows waiting configuration", async ({
  page,
}) => {
  await page.goto("/dashboard/notifications");
  await expect(
    page.getByRole("heading", { name: "Notifikasi admin", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Simpan konfigurasi", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Menunggu konfigurasi", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("admin configures local Mailpit mode and explicitly queues a test without a password", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "project_admin", value: "1", url: baseURL! },
  ]);
  await page.goto("/dashboard/notifications");
  // Use the card content as a stable scope; each channel has its own form.
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel("SMTP host", { exact: true }) });
  await form
    .getByRole("combobox", { name: "Mode SMTP" })
    .selectOption("mailpit");
  await expect(form.getByLabel("SMTP password", { exact: true })).toHaveCount(
    0,
  );
  await form
    .getByLabel("SMTP host", { exact: true })
    .fill("host.docker.internal");
  await form
    .getByLabel("Email pengirim", { exact: true })
    .fill("pg@example.test");
  await form
    .getByLabel("Email admin penerima", { exact: true })
    .fill("admin@example.test");
  const enabled = form.getByRole("checkbox");
  if (!(await enabled.isChecked())) await enabled.check();
  await form
    .getByRole("button", { name: "Simpan konfigurasi", exact: true })
    .click();
  await expect(
    form.getByRole("button", { name: "Uji kanal", exact: true }),
  ).toBeVisible();
  await form.getByRole("button", { name: "Uji kanal", exact: true }).click();
  await form
    .getByRole("button", { name: "Ya, antrekan pesan uji", exact: true })
    .click();
  await expect(
    page
      .getByRole("heading", { name: "Uji notifikasi admin", exact: true })
      .first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("stale authentication offers login before notification settings writes", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "project_admin", value: "1", url: baseURL! },
    { name: "project_stale", value: "1", url: baseURL! },
  ]);
  await page.goto("/dashboard/notifications");
  await expect(
    page.getByRole("button", { name: "Simpan konfigurasi", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Login ulang Microsoft" }).first(),
  ).toHaveAttribute("href", "/login?reauth=1");
});
