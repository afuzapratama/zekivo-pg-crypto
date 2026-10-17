import Fastify from "fastify";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SolanaRpc } from "../../solana/src/rpc.js";
import { DevnetSetup } from "./setup.js";
import { MockUsdtSetup, mockMintSigner } from "./mock-usdt.js";

const port = 4400;
const origin = `http://localhost:${port}`;
const setup = new DevnetSetup(new SolanaRpc("https://api.devnet.solana.com"));
const mock = new MockUsdtSetup(
  new SolanaRpc("https://api.devnet.solana.com"),
  await mockMintSigner(),
);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("./client.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  minify: true,
});
const js = bundle.outputFiles[0]!.text;
const app = Fastify({ bodyLimit: 8192, logger: false });
app.addHook("onRequest", async (request, reply) => {
  if (
    request.headers.host !== `localhost:${port}` ||
    (request.method === "POST" && request.headers.origin !== origin)
  )
    return reply
      .code(403)
      .send({ error: "Open setup through http://localhost:4400" });
  reply
    .header("Cache-Control", "no-store")
    .header("Referrer-Policy", "no-referrer")
    .header("X-Content-Type-Options", "nosniff")
    .header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
});
app.setErrorHandler((error, _request, reply) =>
  reply
    .code(400)
    .send({ error: error instanceof Error ? error.message : "Setup failed" }),
);
function mockHtml(html: string) {
  return html
    .replace('<html lang="id">', '<html lang="id" data-mock="true">')
    .replaceAll("USDC", "Mock USDT")
    .replace("Siapkan wallet penerima.", "Siapkan Mock USDT Devnet.")
    .replace(
      "Buat akun token Mock USDT agar gateway dapat memantau pembayaran ke wallet Zekivo.",
      "Buat token uji dengan 6 desimal, saldo awal 100 Mock USDT untuk pembeli, dan akun token penerima PG. Ini bukan USDT asli dan tidak memiliki nilai uang.",
    )
    .replace(
      "Transaksi hanya membuat akun token Mock USDT penerima.",
      "Transaksi membuat mint baru, dua akun token, dan mencetak 100 Mock USDT ke pembeli. Wallet pembeli menjadi mint authority; tidak ada freeze authority.",
    )
    .replace(
      "Connect Phantom &amp; buat akun Mock USDT",
      "Connect Phantom &amp; buat 100 Mock USDT",
    )
    .replace(
      "Tidak ada transfer Mock USDT atau permintaan seed phrase.",
      "Saldo USDC tidak digunakan. Phantom mungkin menampilkan Unknown Token karena metadata nama belum dipasang.",
    )
    .replace(
      "Tidak mengirim pembayaran invoice.",
      "Token uji Devnet · Bukan produk Tether · Belum membayar invoice.",
    );
}
for (const path of ["/", "/mock-usdt"])
  app.get(path, async (request, reply) =>
    reply
      .type("text/html")
      .send(
        (request.url === "/mock-usdt" ? mockHtml : (s: string) => s)(
          `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Zekivo · Setup Devnet</title><style>:root{--primary:#087663;--border:#dfe6e9;--muted:#586873}*{box-sizing:border-box}body{font:14px Arial,Helvetica,sans-serif;background:#f8fafb;color:#17232b;margin:0;overflow-wrap:anywhere}header{background:white;border-bottom:1px solid var(--border);padding:22px max(20px,calc((100vw - 960px)/2));display:flex;align-items:center;gap:12px;font-weight:600;font-size:18px}header span{display:grid;place-items:center;background:var(--primary);color:white;border-radius:9px;width:32px;height:32px}main{max-width:960px;margin:44px auto;padding:0 20px}h1{font-size:32px;letter-spacing:-1px;line-height:1.2;margin:20px 0}p{line-height:1.8;color:var(--muted);max-width:740px}.tag{display:inline-block;border:1px solid var(--border);border-radius:6px;background:white;padding:7px 10px;font-size:10px;letter-spacing:1px}.panel{padding:24px;background:white;border:1px solid var(--border);border-radius:12px;margin-top:24px}button{font:inherit;font-weight:500;min-height:44px;padding:12px 16px;margin:12px 8px 4px 0;cursor:pointer;border-radius:7px;border:1px solid var(--border);background:white;color:#17232b}button:first-of-type{background:var(--primary);color:white;border-color:var(--primary)}button:disabled{opacity:.5;cursor:wait}button:focus-visible{outline:3px solid var(--primary);outline-offset:3px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#152329;color:#d7e8e1;padding:22px;border:1px solid #25363c;border-radius:10px;font:12px/1.9 ui-monospace,monospace;margin:24px 0}strong{color:#17232b}footer{padding:20px 0;border-top:1px solid var(--border);font-size:11px;color:var(--muted);margin-top:40px}#summary{padding:16px 18px;border:1px solid #c7e3d9;background:#edf6f3;color:#215a49;border-radius:8px;margin:24px 0;line-height:1.8}@media(max-width:600px){main{margin:28px auto}h1{font-size:28px}.panel{padding:18px}button{width:100%;margin-right:0}pre{padding:16px}}</style><header><span>z.</span>zekivo pay <small style="font-size:12px;color:#586873;font-weight:400">/ operator tools</small></header><main><span class="tag">SOLANA DEVNET · SETUP WALLET</span><h1>Siapkan wallet penerima.</h1><p>Buat akun token USDC agar gateway dapat memantau pembayaran ke wallet Zekivo.</p><div class="panel"><p>Wallet penerima: <strong>GGQtua3Q7Sdr4K3eCvJA7kiHXCsTCgGBrm7FqoJsPEkk</strong></p><p>Gunakan Phantom desktop, akun pembeli <strong>3toF…pVLkt</strong>, jaringan <strong>Devnet</strong>. Transaksi hanya membuat akun token USDC penerima. Pembeli membayar fee dan deposit akun memakai SOL Devnet. Tidak ada transfer USDC atau permintaan seed phrase. Priority fee setup ini ditetapkan nol; gunakan biaya yang disiapkan tanpa mengubahnya di Phantom.</p><button id="connect">Connect Phantom &amp; buat akun USDC</button><button id="inspect">Cek akun penerima</button></div><p id="summary" role="status" aria-live="polite">Memeriksa akun penerima di Devnet…</p><details><summary>Rincian teknis / hasil transaksi</summary><pre>Memeriksa Devnet…</pre></details><footer>Zekivo · Operator setup · Tidak mengirim pembayaran invoice.</footer></main><script src="/client.js" defer></script></html>`,
        ),
      ),
  );
app.get("/client.js", async (_request, reply) =>
  reply.type("application/javascript").send(js),
);
app.get("/status", async () => setup.inspect());
app.post("/prepare", async (request) =>
  setup.prepare(
    z.object({ payer: z.string() }).strict().parse(request.body).payer,
  ),
);
app.post("/submit", async (request) => {
  const body = z
    .object({
      id: z.string().uuid(),
      transaction: z
        .string()
        .min(1)
        .max(3000)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .strict()
    .parse(request.body);
  return setup.submit(body.id, body.transaction);
});
app.get("/mock-usdt/status", async () => mock.inspect());
app.post("/mock-usdt/prepare", async (request) =>
  mock.prepare(
    z.object({ payer: z.string() }).strict().parse(request.body).payer,
  ),
);
app.post("/mock-usdt/submit", async (request) => {
  const body = z
    .object({
      id: z.string().uuid(),
      transaction: z
        .string()
        .min(1)
        .max(3000)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .strict()
    .parse(request.body);
  return mock.submit(body.id, body.transaction);
});
await setup.inspect();
await app.listen({ host: "127.0.0.1", port });
console.log(
  `Devnet setup ready: ${origin} — connect buyer Phantom; buyer signs with Phantom. Mock USDT: /mock-usdt`,
);
