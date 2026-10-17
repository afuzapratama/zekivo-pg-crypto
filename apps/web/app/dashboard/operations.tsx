import { Wallet, Activity, Radio, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  adminGet,
  AdminApiError,
  dateTime,
  tokenLabel,
  type Operations,
} from "@/lib/admin";
export default async function OperationalStatus() {
  let data: Operations;
  try {
    data = await adminGet<Operations>("operations");
  } catch (error) {
    if (!(error instanceof AdminApiError)) throw error;
    return (
      <section
        aria-label="Saldo wallet dan scanner"
        className="mb-8 rounded-xl border bg-white p-6"
      >
        <h2 className="flex items-center gap-2 font-semibold">
          <Activity size={18} aria-hidden="true" />
          Saldo dan pemantauan
        </h2>
        <p
          role="status"
          className="mt-3 text-sm leading-6 text-muted-foreground"
        >
          Saldo dan checkpoint belum dapat diverifikasi. Coba perbarui data;
          angka tidak ditampilkan sampai RPC tersedia.
        </p>
      </section>
    );
  }
  const states: Record<string, string> = {
    current: "Terpantau",
    lagging: "Tertinggal",
    unknown: "Belum terverifikasi",
    disabled: "Monitoring nonaktif",
  };
  return (
    <section aria-label="Saldo wallet dan scanner" className="mb-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Wallet size={18} className="text-primary" aria-hidden="true" />
            Saldo dan pemantauan
          </h2>
          <p className="mt-1 text-[11px] leading-6 text-muted-foreground">
            Saldo finalized · Wallet bersama seluruh project · Tidak mengikuti
            filter project.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5 bg-white">
          <Radio size={12} aria-hidden="true" />
          RPC terjangkau
        </Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {data.wallets.map((wallet) => (
          <Card key={wallet.asset} className="shadow-none">
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Saldo {tokenLabel(wallet.asset, data.cluster)}
                </h3>
                <Badge
                  variant="outline"
                  className={
                    wallet.state === "current"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }
                >
                  {states[wallet.state] ?? states.unknown}
                </Badge>
              </div>
              <p className="mt-4 break-all text-2xl font-semibold tabular-nums">
                {wallet.balance}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  {tokenLabel(wallet.asset, data.cluster)}
                </span>
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Checkpoint slot</p>
                  <p className="mt-2 font-mono">
                    {wallet.checkpoint_slot ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Lag finalized</p>
                  <p className="mt-2 font-mono">
                    {wallet.lag_slots === null
                      ? "—"
                      : `${wallet.lag_slots} slot`}
                  </p>
                </div>
              </div>
              <details className="mt-4 rounded-lg border bg-muted/20 px-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-xs">
                  Alamat &amp; status pemindaian
                  <ChevronDown size={13} aria-hidden="true" />
                </summary>
                <dl className="space-y-3 pb-4 text-[11px] leading-6">
                  {[
                    ["Receiving owner", wallet.recipient],
                    ["Akun token / ATA", wallet.token_account],
                    ["Mint", wallet.mint],
                    [
                      "Checkpoint diperbarui",
                      wallet.checkpoint_updated_at
                        ? `${dateTime(wallet.checkpoint_updated_at)} WIB`
                        : "Belum tersedia",
                    ],
                    [
                      "Umur checkpoint",
                      wallet.age_seconds === null
                        ? "Belum terverifikasi"
                        : `${wallet.age_seconds} detik saat snapshot`,
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="break-all font-mono">{value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
        Head finalized {data.finalized_head} · Snapshot {dateTime(data.as_of)}{" "}
        WIB · Cache maksimal 15 detik. Status berdasarkan checkpoint, bukan
        bukti proses worker hidup. Peringatan jika umur checkpoint &gt;120 detik
        atau lag &gt;300 slot.
      </p>
    </section>
  );
}
