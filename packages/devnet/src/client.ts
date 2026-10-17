import { getWallets } from "@wallet-standard/app";
import type { StandardConnectFeature } from "@wallet-standard/features";
import type { SolanaSignTransactionFeature } from "@solana/wallet-standard-features";

const mock = document.documentElement.dataset.mock === "true";
const output = document.querySelector("pre")!;
const connect = document.querySelector<HTMLButtonElement>("#connect")!;
const inspect = document.querySelector<HTMLButtonElement>("#inspect")!;
const show = (value: unknown) => {
  const summary = document.querySelector("#summary");
  if (summary) {
    const result =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : null;
    summary.textContent = mock
      ? result?.ready === true
        ? "Mock USDT Devnet sudah siap. Langkah berikutnya: aktifkan mint di gateway, lalu buat invoice uji USDT."
        : result?.signature
          ? "Transaksi dikirim. Tunggu finalized lalu klik Cek akun penerima. Ini setup token, belum pembayaran invoice."
          : String(
              result?.instruction ??
                (result?.ready === false
                  ? "Mock USDT belum dibuat. Hubungkan wallet pembeli untuk setup."
                  : value),
            )
      : result?.ready === true
        ? "Akun USDC penerima sudah siap. Saldo token bisa tetap 0 karena setup ini hanya membuat akun, belum mengirim pembayaran. Tidak perlu mengulang setup."
        : result?.ready === false && !result?.instruction
          ? "Akun USDC penerima belum dibuat. Hubungkan wallet pembeli untuk menandatangani transaksi setup."
          : result?.signature
            ? "Transaksi setup sudah dikirim. Tunggu finalized lalu klik Cek akun penerima. Potongan SOL adalah fee jaringan dan deposit akun; belum ada transfer USDC."
            : String(result?.instruction ?? value);
  }
  output.textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
};
async function api(path: string, body?: unknown) {
  const response = await fetch((mock ? "/mock-usdt" : "") + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Setup request failed");
  return result;
}
getWallets();
inspect.onclick = async () => {
  inspect.disabled = true;
  try {
    show(await api("/status"));
  } catch (e) {
    show(String(e));
  } finally {
    inspect.disabled = false;
  }
};
connect.onclick = async () => {
  connect.disabled = true;
  try {
    const wallet = getWallets()
      .get()
      .find(
        (w) =>
          w.name === "Phantom" &&
          w.chains.includes("solana:devnet") &&
          "standard:connect" in w.features &&
          "solana:signTransaction" in w.features,
      );
    if (!wallet)
      throw new Error(
        "Phantom dengan dukungan Wallet Standard Devnet belum terdeteksi. Buka melalui browser desktop dengan ekstensi Phantom aktif, lalu refresh.",
      );
    const features = wallet.features as StandardConnectFeature &
      SolanaSignTransactionFeature;
    if (
      !features["solana:signTransaction"].supportedTransactionVersions.includes(
        0,
      )
    )
      throw new Error(
        "Wallet belum mendukung transaksi Solana v0 yang dipakai setup ini.",
      );
    const { accounts } = await features["standard:connect"].connect();
    const account = accounts.find(
      (a) =>
        a.address === "3toF4H23Winv3CehGrxW7CaqMuFcbQVRfaDoa8upVLkt" &&
        a.chains.includes("solana:devnet"),
    );
    if (!account)
      throw new Error(
        "Pilih akun pembeli 3toF…pVLkt di Phantom dan pastikan Devnet aktif.",
      );
    const prepared = await api("/prepare", { payer: account.address });
    show({
      instruction: mock
        ? "Membuat mint dan dua akun token, mencetak 100 Mock USDT ke pembeli. Hanya SOL Devnet untuk fee/deposit. Tinjau di Phantom."
        : "Membuat akun USDC penerima; tidak mengirim USDC. Tinjau dan setujui di Phantom.",
      mint: prepared.mint,
      recipient: prepared.recipient,
      ata: prepared.ata,
      rent_lamports: prepared.rent_lamports,
      fee_lamports: prepared.fee_lamports,
    });
    const [signed] = await features["solana:signTransaction"].signTransaction({
      account,
      chain: "solana:devnet",
      transaction: Uint8Array.from(atob(prepared.transaction), (c) =>
        c.charCodeAt(0),
      ),
    });
    if (!signed) throw new Error("Wallet did not return a signed transaction");
    const result = await api("/submit", {
      id: prepared.id,
      transaction: btoa(String.fromCharCode(...signed.signedTransaction)),
    });
    show({
      ...result,
      explorer: `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`,
      next: "Tunggu finality, lalu klik Cek akun penerima. Jika timeout, cek akun/transaksi dahulu sebelum mencoba lagi.",
    });
  } catch (e) {
    show(String(e));
  } finally {
    connect.disabled = false;
  }
};
inspect.click();
