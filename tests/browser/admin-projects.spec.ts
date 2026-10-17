import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const project = "20000000-0000-4000-8000-000000000001";
test.beforeEach(async ({ context, baseURL }) => {
  test.skip(
    process.env.ADMIN_DASHBOARD_E2E !== "1",
    "Requires isolated dashboard fixture API",
  );
  await context.addCookies([
    { name: "dashboard_fixture", value: "1", url: baseURL! },
  ]);
});
test("project API keys tab opens a dedicated page and tracks the active tab", async ({
  page,
}) => {
  await page.goto(`/dashboard/projects/${project}`);
  const tabs = page.getByRole("navigation", { name: "Bagian project" });
  await tabs.getByRole("link", { name: "API keys", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/projects/${project}/api-keys$`),
  );
  await expect(
    tabs.getByRole("link", { name: "API keys", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "API keys project", exact: true }),
  ).toBeVisible();
  await tabs.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(
    tabs.getByRole("link", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "API keys project", exact: true }),
  ).toHaveCount(0);
});
test("read-only project metadata has no issue/revoke actions", async ({
  page,
}) => {
  await page.goto(`/dashboard/projects/${project}/api-keys`);
  await expect(
    page.getByRole("heading", { name: "QA fixture project", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate API key", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cabut key", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("admin issues key once, clears it after acknowledgement and revokes with confirmation", async ({
  page,
  context,
  baseURL,
}, info) => {
  await context.addCookies([
    { name: "project_admin", value: "1", url: baseURL! },
  ]);
  await page.goto(`/dashboard/projects/${project}/api-keys`);
  const name = `QA generated ${info.project.name}`;
  await page.getByLabel("Nama API key").fill(name);
  await page
    .getByRole("button", { name: "Generate API key", exact: true })
    .click();
  await expect(
    page.getByText("zk_test_fixture-only-not-a-real-key", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sudah disimpan" }).click();
  await expect(
    page.getByText("zk_test_fixture-only-not-a-real-key", { exact: true }),
  ).toHaveCount(0);
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await card.getByRole("button", { name: "Cabut key", exact: true }).click();
  await card.getByRole("button", { name: "Batal", exact: true }).click();
  await expect(card.getByText("Aktif", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Cabut key", exact: true }).click();
  await card
    .getByRole("button", { name: "Ya, cabut key", exact: true })
    .click();
  await expect(card.getByText("Dicabut", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) =>
        value.includes("zk_test_fixture-only-not-a-real-key"),
      ),
    ),
  ).toBe(false);
  await expect(page).toHaveTitle(/Zekivo Pay/);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations.map((v) => v.id),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("stale authentication offers reauthentication instead of enabling writes", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "project_admin", value: "1", url: baseURL! },
    { name: "project_stale", value: "1", url: baseURL! },
  ]);
  await page.goto(`/dashboard/projects/${project}/api-keys`);
  await expect(
    page.getByRole("button", { name: "Generate API key", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Verifikasi ulang Microsoft", exact: true }),
  ).toHaveAttribute("href", "/login?reauth=1");
  await page
    .getByRole("link", { name: "Verifikasi ulang Microsoft", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?reauth=1$/);
  await expect(
    page.getByRole("button", { name: "Masuk dengan Microsoft" }),
  ).toBeVisible();
});

test("admin creates a named project and opens its detail", async ({
  page,
  context,
  baseURL,
}, info) => {
  await context.addCookies([
    { name: "project_admin", value: "1", url: baseURL! },
  ]);
  await page.goto("/dashboard/projects");
  const name = `QA website ${info.project.name}`;
  await page.getByLabel("Nama project", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Buat project", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/projects\/[a-f0-9-]{36}$/);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
});

test("admin rotates a key with explicit overlap and one-time replacement", async ({
  page,
  context,
  baseURL,
}, info) => {
  await context.addCookies([
    { name: "project_admin", value: "1", url: baseURL! },
  ]);
  await page.goto(`/dashboard/projects/${project}/api-keys`);
  const source = `Rotation source ${info.project.name}`;
  await page.getByLabel("Nama API key", { exact: true }).fill(source);
  await page
    .getByRole("button", { name: "Generate API key", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sudah disimpan", exact: true })
    .click();
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: source, exact: true }) });
  await card.locator("summary").filter({ hasText: "Rotasi key" }).click();
  await card
    .getByLabel("Nama API key", { exact: true })
    .fill(`Replacement ${info.project.name}`);
  await card
    .getByLabel("Masa transisi key lama", { exact: true })
    .selectOption("1");
  await card
    .getByRole("button", { name: "Terbitkan key pengganti", exact: true })
    .click();
  await expect(
    card.getByText("Key pengganti berhasil dibuat", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText("Masa transisi", { exact: true })).toBeVisible();
  await card
    .getByRole("button", { name: "Sudah disimpan", exact: true })
    .click();
  await expect(
    card.getByText("zk_test_fixture-only-not-a-real-key", { exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Terbitkan key pengganti", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
