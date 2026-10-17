import { Suspense } from "react";
import { Wallet } from "lucide-react";
import OperationalStatus from "../operations";
import RefreshButton from "../refresh-button";
export const dynamic = "force-dynamic";
export default function WalletPage() {
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
            <Wallet aria-hidden="true" />
            Wallet &amp; scanner
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            Saldo token finalized, alamat penerima dan checkpoint scanner untuk
            seluruh project pada jaringan ini.
          </p>
        </div>
        <RefreshButton />
      </div>
      <Suspense
        fallback={
          <p
            role="status"
            className="rounded-xl border bg-white p-6 text-sm text-muted-foreground"
          >
            Memuat saldo dan checkpoint…
          </p>
        }
      >
        <OperationalStatus />
      </Suspense>
    </div>
  );
}
