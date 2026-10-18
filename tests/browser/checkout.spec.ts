import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createRequire } from "node:module";
const jsQR = createRequire(import.meta.url)(
  "jsqr",
) as typeof import("jsqr").default;

const token = "a".repeat(43); // Synthetic capability, never a real invoice.
const path = `/pay/${token}`;
const recipient = "GbYRzP87315WdGrk7bS68K4fgQJ98pk31X7AkT2D4Mgp";
const mint = "6zx2z6jcnqH7t69QA2HBc88mpVjbHvgGBNUYN5Ro43Vt";
const reference = "B7WG8mXBEGSTX4Z7qP2UrTtAoz3jdZezdknbvzc98MFV";
function fixture() {
  return {
    asset: "USDC",
    cluster: "localnet",
    status: "pending",
    amount: "25.000000",
    payable_amount: "25.000127",
    expires_at: new Date(Date.now() + 1800000).toISOString(),
    server_time: new Date().toISOString(),
    payment_enabled: true,
    recipient,
    mint,
    reference,
    review_reasons: [] as string[],
  };
}
async function stub(page: Page, data = fixture()) {
  await page.route("**/api/checkout", async (route) => {
    expect(route.request().headers()["x-checkout-token"]).toBe(token);
    expect(route.request().headers()["authorization"]).toBeUndefined();
    expect(route.request().headers()["referer"]).toBeUndefined();
    await route.fulfill({
      json: { ...data, server_time: new Date().toISOString() },
    });
  });
}
async function open(page: Page) {
  await page.goto(path);
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /QR pembayaran/ })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("responsive layout, readable token details, keyboard and accessibility", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await stub(page);
  await open(page);
  await expect(
    page.getByRole("heading", { name: "Selesaikan pembayaran", exact: true }),
  ).toBeVisible();
  await page.getByText("Periksa mint token", { exact: true }).click();
  await expect(page.getByText(mint, { exact: true })).toBeVisible();
  await noOverflow(page);
  const copy = page.getByRole("button", { name: "Salin alamat", exact: true });
  const bounds = await copy.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("link", { name: "zekivo pay" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByText("Rincian invoice", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Salin nominal", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(copy).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toBeFocused();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("checkout-pending.png"),
    fullPage: true,
  });
});

test("QR decodes to the exact wallet URI and all transfer fields", async ({
  page,
}) => {
  await stub(page);
  await open(page);
  const href = await page
    .getByRole("link", { name: "Buka wallet Solana Pay" })
    .getAttribute("href");
  const pixels = await page
    .getByRole("img", { name: /QR pembayaran/ })
    .evaluate((element) => {
      const img = element as HTMLImageElement;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        data: Array.from(
          ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        ),
      };
    });
  const decoded = jsQR(
    new Uint8ClampedArray(pixels.data),
    pixels.width,
    pixels.height,
  );
  expect(decoded?.data).toBe(href);
  const uri = new URL(href!);
  expect(uri.protocol).toBe("solana:");
  expect(uri.pathname).toBe(recipient);
  expect(uri.searchParams.get("amount")).toBe("25.000127");
  expect(uri.searchParams.get("spl-token")).toBe(mint);
  expect(uri.searchParams.get("reference")).toBe(reference);
});

test("clipboard success and denied permission keep manual fallback usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          sessionStorage.setItem("copied", value);
        },
      },
    });
  });
  await stub(page);
  await open(page);
  await page.getByRole("button", { name: "Salin alamat", exact: true }).click();
  await expect(
    page.getByText("Alamat disalin.", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("copied"))).toBe(
    recipient,
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    }),
  );
  await page
    .getByRole("button", { name: "Salin nominal", exact: true })
    .click();
  await expect(page.getByText(/Tidak dapat menyalin nominal/)).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Instruksi pembayaran" })
      .getByText("25.000127 USDC", { exact: true }),
  ).toBeVisible();
});

test("offline reconnect and refresh retain invoice and server-owned state", async ({
  page,
}) => {
  const data = fixture();
  let offline = false;
  await page.route("**/api/checkout", (route) =>
    offline
      ? route.abort("internetdisconnected")
      : route.fulfill({
          json: { ...data, server_time: new Date().toISOString() },
        }),
  );
  await open(page);
  offline = true;
  await expect(
    page.getByText("Koneksi terputus · mencoba kembali otomatis", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toHaveCount(0);
  offline = false;
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toBeVisible();
  data.status = "paid";
  await expect(
    page
      .getByRole("heading", { name: "Pembayaran diterima", exact: true })
      .first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Terverifikasi · finalized", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toHaveCount(0);
});

test("expiry countdown hides instructions while polling can recover an on-time payment", async ({
  page,
}) => {
  const data = fixture();
  data.expires_at = new Date(Date.now() + 4000).toISOString();
  await stub(page, data);
  await open(page);
  await expect(
    page.getByText("Jangan kirim pembayaran baru", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toHaveCount(0);
  data.status = "paid";
  await expect(
    page.getByText("Terverifikasi · finalized", { exact: true }),
  ).toBeVisible();
});

test("review, confirming and disabled invoices never expose a send action", async ({
  page,
}, info) => {
  const data = fixture();
  data.review_reasons = ["partial"];
  await stub(page, data);
  await page.goto(path);
  await expect(
    page.getByText("Jumlah pembayaran kurang", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("checkout-review.png"),
    fullPage: true,
  });
  data.review_reasons = [];
  data.status = "confirming";
  await page.reload();
  await expect(
    page
      .getByRole("heading", { name: "Menunggu konfirmasi", exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toHaveCount(0);
  data.status = "pending";
  data.payment_enabled = false;
  await page.reload();
  await expect(
    page.getByText("Invoice ini belum diaktifkan untuk menerima transfer.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toHaveCount(0);
});

test("invalid link and first-load server failure have useful recovery states", async ({
  page,
}) => {
  await page.route("**/api/checkout", (route) =>
    route.fulfill({ status: 404, json: { error: "not_found" } }),
  );
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Link tidak ditemukan", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.unroute("**/api/checkout");
  await page.route("**/api/checkout", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.reload();
  await expect(
    page.getByText("Server belum dapat dihubungi", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toHaveCount(0);
});

test("wallet launch offers manual fallback without claiming an app is installed", async ({
  page,
}) => {
  await stub(page);
  await open(page);
  const wallet = page.getByRole("link", { name: "Buka wallet Solana Pay" });
  // Avoid asking the test OS to handle an external scheme; exercise the click handler.
  await wallet.evaluate((element) =>
    element.addEventListener("click", (event) => event.preventDefault()),
  );
  await wallet.click();
  await expect(page.getByText(/Wallet belum terbuka/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Salin alamat", exact: true }),
  ).toBeVisible();
});

test("browser online event immediately refreshes and a wall-clock change cannot extend expiry", async ({
  page,
  context,
}) => {
  const data = fixture();
  data.expires_at = new Date(Date.now() + 8000).toISOString();
  await stub(page, data);
  await open(page);
  await context.setOffline(true);
  await expect(
    page.getByText("Koneksi terputus · mencoba kembali otomatis", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toHaveCount(0);
  await context.setOffline(false);
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toBeVisible();
  await page.evaluate(() => {
    Date.now = () => 0;
  });
  await expect(
    page.getByText("Jangan kirim pembayaran baru", { exact: true }),
  ).toBeVisible();
});

test("a QR rendering failure retains copy and wallet fallback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.toDataURL = () => {
      throw new Error("canvas unavailable");
    };
  });
  await stub(page);
  await page.goto(path);
  await expect(
    page.getByText("QR belum tersedia. Gunakan salin alamat dan nominal.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Salin nominal", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toBeVisible();
});

test("asset selection uses approved quote and refreshes QR without extending expiry", async ({
  page,
}) => {
  const data = {
    ...fixture(),
    invoice_version: 1,
    payment_options: [
      { asset: "USDC", amount: "25.000000" },
      { asset: "USDT", amount: "25.100000" },
    ],
  };
  await stub(page, data);
  let complete: (() => void) | undefined;
  await page.route("**/api/checkout/asset", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      asset: "USDT",
      expected_version: 1,
    });
    expect(route.request().headers()["authorization"]).toBeUndefined();
    await new Promise<void>((resolve) => {
      complete = resolve;
    });
    Object.assign(data, {
      asset: "USDT",
      amount: "25.100000",
      payable_amount: "25.100019",
      mint: reference,
      reference: mint,
      invoice_version: 2,
    });
    await route.fulfill({ json: { invoice_version: 2 } });
  });
  await open(page);
  await page.getByText("Ganti aset pembayaran", { exact: true }).click();
  await page
    .getByRole("button", {
      name: "Belum mengirim, gunakan USDT · 25.100000",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Memperbarui pilihan aset…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toHaveCount(0);
  await expect.poll(() => Boolean(complete)).toBe(true);
  complete!();
  const wallet = page.getByRole("link", { name: "Buka wallet Solana Pay" });
  await expect(wallet).toBeVisible();
  const uri = new URL((await wallet.getAttribute("href"))!);
  expect(uri.searchParams.get("amount")).toBe("25.100019");
  expect(uri.searchParams.get("spl-token")).toBe(reference);
  expect(uri.searchParams.get("reference")).toBe(mint);
  await noOverflow(page);
});

test("asset selection conflict loads paid state instead of retrying a stale selection", async ({
  page,
}) => {
  const data = {
    ...fixture(),
    invoice_version: 1,
    payment_options: [
      { asset: "USDC", amount: "25.000000" },
      { asset: "USDT", amount: "25.100000" },
    ],
  };
  await stub(page, data);
  await page.route("**/api/checkout/asset", async (route) => {
    data.status = "paid";
    data.invoice_version = 2;
    await route.fulfill({
      status: 409,
      json: { error: "invoice_changed_or_selection_closed" },
    });
  });
  await open(page);
  await page.getByText("Ganti aset pembayaran", { exact: true }).click();
  await page
    .getByRole("button", { name: /Belum mengirim, gunakan USDT/ })
    .click();
  await expect(
    page.getByText("Terverifikasi · finalized", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Buka wallet Solana Pay" }),
  ).toHaveCount(0);
});

test("asset proxy rejects cross-site requests, invented prices and oversized bodies", async ({
  request,
  baseURL,
}) => {
  const headers = { origin: baseURL!, "x-checkout-token": token };
  expect(
    (
      await request.post("/api/checkout/asset", {
        headers: { ...headers, origin: "https://untrusted.example" },
        data: { asset: "USDT", expected_version: 1 },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/checkout/asset", {
        headers,
        data: { asset: "USDT", expected_version: 1, amount: "0.01" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/checkout/asset", {
        headers,
        data: { asset: "USDT", expected_version: 1, extra: "x".repeat(1500) },
      })
    ).status(),
  ).toBe(413);
});

test("USD checkout displays original merchant price separately from converted token amount", async ({
  page,
}) => {
  await page.route("**/api/checkout", (route) =>
    route.fulfill({
      json: {
        ...fixture(),
        price_currency: "USD",
        price_amount: "25.83",
        amount: "25.855856",
        payable_amount: "25.855857",
        quote: {
          rate_usd_per_token: "0.999",
          converted_amount: "25.855856",
          source: "fixture",
        },
      },
    }),
  );
  await page.goto(path);
  await expect(
    page.getByText("$25.83", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Instruksi pembayaran" })
      .getByText("25.855857 USDC", { exact: true }),
  ).toBeVisible();
  await page.getByText("Rincian invoice", { exact: true }).click();
  await expect(
    page.getByText("1 USDC = $0.999", { exact: true }),
  ).toBeVisible();
  await noOverflow(page);
});
