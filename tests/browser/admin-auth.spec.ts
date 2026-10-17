import { test, expect } from "@playwright/test";
test("login form preserves same-origin Origin for the CSRF guard", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.ADMIN_AUTH_E2E !== "1",
    "Requires configured admin login instance; POST is intercepted without contacting Entra",
  );
  const response = await page.goto("/login");
  expect(response?.headers()["referrer-policy"]).toBe("same-origin");
  await page.route("**/api/admin/auth/login", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers().origin).toBe(new URL(baseURL!).origin);
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "Login request origin verified",
    });
  });
  await page.getByRole("button", { name: "Masuk dengan Microsoft" }).click();
  await expect(page.locator("body")).toHaveText(
    "Login request origin verified",
  );
});
