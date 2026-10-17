import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const path =
  "/dashboard/projects/20000000-0000-4000-8000-000000000001/webhooks";
test.beforeEach(async ({ context, baseURL }) => {
  test.skip(
    process.env.ADMIN_DASHBOARD_E2E !== "1",
    "Requires isolated fixture",
  );
  await context.addCookies([
    { name: "dashboard_fixture", value: "1", url: baseURL! },
  ]);
});
test("read-only webhook logs and attempt details are responsive", async ({
  page,
}) => {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Webhooks", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Rotasi secret" })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "Lihat percobaan #17" }).click();
  await expect(
    page.getByRole("heading", { name: "Percobaan delivery #17" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("admin creates and rotates one-time secrets and confirms replay", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "project_admin", value: "1", url: baseURL! },
  ]);
  await page.goto(path);
  await page
    .getByLabel("URL webhook HTTPS")
    .fill("https://merchant.example/new");
  await page
    .getByRole("button", { name: "Tambah endpoint", exact: true })
    .click();
  await expect(
    page.getByText("whsec_fixture-only-not-a-real-secret", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sudah disimpan" }).click();
  await expect(
    page.getByText("whsec_fixture-only-not-a-real-secret", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Rotasi secret", exact: true })
    .click();
  await page.getByRole("button", { name: "Batal", exact: true }).click();
  await page
    .getByRole("button", { name: "Rotasi secret", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ya, lanjutkan", exact: true })
    .click();
  await expect(
    page.getByText("Signing secret · tampil satu kali"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sudah disimpan" }).click();
  await page
    .getByRole("button", { name: "Replay delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ya, lanjutkan", exact: true })
    .click();
  await expect(
    page.getByText(
      "Delivery masuk antrean. Status terkirim menunggu hasil worker.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "whsec_",
  );
});
