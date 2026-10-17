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
test("read-only review filters, pagination and evidence remain accessible on mobile", async ({
  page,
}) => {
  await page.goto("/dashboard/reviews");
  await expect(
    page.getByRole("heading", { name: "Review queue", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Review berikutnya", exact: true })
    .click();
  await expect(page).toHaveURL(/before=/);
  await page.getByRole("link", { name: "Review terbaru", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Jenis masalah", exact: true })
    .selectOption("unmatched");
  await page.getByRole("button", { name: "Terapkan filter" }).click();
  await expect(
    page.getByRole("heading", { name: "Kurang bayar", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: /Tinjau transfer #/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Bukti transfer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Simpan penanganan", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Lihat di Solana Explorer" }),
  ).toHaveAttribute("href", /cluster=devnet/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("operator confirms and records review with reason and history", async ({
  page,
  context,
  baseURL,
}, info) => {
  await context.addCookies([
    { name: "review_operator", value: "1", url: baseURL! },
  ]);
  const id =
    info.project.name === "desktop"
      ? "25"
      : info.project.name === "mobile"
        ? "23"
        : "21";
  await page.goto(`/dashboard/reviews/${id}`);
  await page
    .getByRole("combobox", { name: "Status penanganan", exact: true })
    .selectOption("closed");
  const reason = `QA ${info.project.name}: merchant contacted after checking finalized transfer. ${crypto.randomUUID()}`;
  await page.getByLabel("Alasan dan bukti penanganan").fill(reason);
  await page
    .getByRole("button", { name: "Simpan penanganan", exact: true })
    .click();
  await page.getByRole("button", { name: "Batal", exact: true }).click();
  await expect(page.getByLabel("Alasan dan bukti penanganan")).toHaveValue(
    reason,
  );
  await page
    .getByRole("button", { name: "Simpan penanganan", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ya, simpan catatan", exact: true })
    .click();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Status review saat ini")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("stale login and conflicting review provide actionable recovery", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "review_operator", value: "1", url: baseURL! },
    { name: "project_stale", value: "1", url: baseURL! },
  ]);
  await page.goto("/dashboard/reviews/19");
  await expect(
    page.getByRole("link", { name: "Login ulang Microsoft" }),
  ).toHaveAttribute("href", "/login?reauth=1");
  await context.clearCookies({ name: "project_stale" });
  await context.addCookies([
    { name: "review_conflict", value: "1", url: baseURL! },
  ]);
  await page.reload();
  await page
    .getByLabel("Alasan dan bukti penanganan")
    .fill("QA operator checked transaction before update.");
  await page
    .getByRole("button", { name: "Simpan penanganan", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ya, simpan catatan", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Review sudah diperbarui" }),
  ).toContainText("operator lain");
  await expect(
    page.getByRole("button", { name: "Muat ulang review", exact: true }),
  ).toBeVisible();
});
