"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export default function Logout({ csrf }: { csrf: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div>
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const response = await fetch("/api/admin/auth/logout", {
              method: "POST",
              headers: { "x-csrf-token": csrf },
            });
            if (!response.ok) throw new Error();
            window.location.assign("/login");
          } catch {
            setError("Belum berhasil keluar. Coba lagi.");
            setBusy(false);
          }
        }}
      >
        Keluar
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
