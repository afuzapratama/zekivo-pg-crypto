import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("Devnet instance labels its network, verifies readiness and disables the local signer", async ({
  page,
  request,
}, info) => {
  test.skip(
    process.env.DEVNET_E2E !== "1",
    "Dedicated Devnet instance opt-in required",
  );
  await page.goto("/");
  await expect(page).toHaveURL(/\/docs\/devnet$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Uji pembayaran dari wallet.",
  );
  await expect(page.getByRole("status")).toHaveText(
    "Gateway Devnet siap menerima invoice.",
    { timeout: 30000 },
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
  expect((await request.get("/api/playground/health")).status()).toBe(404);
  expect(
    (
      await request.get("/api/devnet/status", {
        headers: { Host: "untrusted.example" },
      })
    ).status(),
  ).toBe(404);
  await page.screenshot({
    path: info.outputPath("devnet.png"),
    fullPage: true,
  });
});
