import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("workspace home and integration guide remain accessible at each viewport", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Pembayaran crypto.",
  );
  await expect(
    page.getByRole("link", { name: "Jelajahi API" }),
  ).toHaveAttribute("href", "/docs/api");
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
  await page.screenshot({ path: info.outputPath("home.png"), fullPage: true });
  await page.getByRole("link", { name: "Dokumentasi", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Mulai integrasi pembayaran.",
  );
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
});
