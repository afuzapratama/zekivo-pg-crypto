import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Wallet, ArrowUpRight } from "lucide-react";
import Status from "./status";
export default function DevnetPage() {
  const staging =
    process.env.APP_ENV === "staging" &&
    process.env.SOLANA_CLUSTER === "devnet";
  return (
    <>
      <Badge variant="outline" className="bg-white">
        SOLANA DEVNET · USDC & MOCK USDT
      </Badge>
      <h1>Uji pembayaran dari wallet.</h1>
      <p>
        Gunakan USDC Circle Devnet atau Mock USDT proyek dari Phantom pembeli.
        Pembayaran masuk langsung ke wallet penerima Zekivo; gateway
        memverifikasi nominal dan finality.
      </p>
      {staging ? (
        <Status />
      ) : (
        <Card className="mt-6 shadow-none">
          <CardContent className="p-6">
            <p className="mb-4 text-sm text-muted-foreground">
              Instance ini tetap localnet. Devnet berjalan terpisah pada port
              13100 agar database dan transaksi pengujian tidak bercampur.
            </p>
            <Button asChild className="min-h-11">
              <a href="http://localhost:13100/docs/devnet">
                Buka instance Devnet <ArrowUpRight aria-hidden="true" />
              </a>
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="my-6 grid gap-5 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardContent className="p-6">
            <h2 className="mb-4 flex items-center gap-2 font-semibold">
              <Wallet size={18} aria-hidden="true" />
              Alur pengujian pertama
            </h2>
            <ol className="list-decimal space-y-3 pl-5 text-sm leading-7 text-muted-foreground">
              <li>
                Jalankan <code>pnpm devnet:invoice</code> pada terminal host
                untuk membuat atau membuka kembali invoice USDC. Gunakan{" "}
                <code>pnpm devnet:invoice --usdt</code> untuk Mock USDT.
              </li>
              <li>
                Buka checkout_url dari hasil perintah. Pilih akun pembeli dan
                jaringan Devnet di Phantom.
              </li>
              <li>
                Untuk uji manual, salin alamat penerima dan kirim nominal persis
                dari checkout. Jangan membulatkan digit tambahan.
              </li>
              <li>
                Tunggu finalized sampai checkout menampilkan pembayaran
                diterima. Jalankan <code>pnpm devnet:inspect</code> (tambahkan{" "}
                <code>--usdt</code> untuk invoice Mock USDT) untuk melihat
                transfer dan event.
              </li>
            </ol>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-6">
            <h2 className="mb-4 font-semibold">Batas pengujian ini</h2>
            <ul className="list-disc space-y-3 pl-5 text-sm leading-7 text-muted-foreground">
              <li>
                USDC Circle Devnet dan Mock USDT proyek. Mock USDT bukan token
                Tether dan tidak memiliki nilai uang.
              </li>
              <li>
                Tombol pembayaran otomatis playground localnet tidak tersedia
                pada instance ini.
              </li>
              <li>
                Transfer ditandatangani pengguna di Phantom. Server tidak
                mempunyai private key wallet.
              </li>
              <li>
                Event payment.confirmed dicatat setelah pembayaran sah. Delivery
                webhook menunggu endpoint merchant HTTPS yang kita kendalikan.
              </li>
              <li>
                Jangan membayar ulang saat menunggu status. Devnet adalah dana
                test; Mainnet belum diaktifkan.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
