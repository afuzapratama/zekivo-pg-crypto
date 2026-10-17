"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
export default function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      className="min-h-11"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw
        size={15}
        aria-hidden="true"
        className={pending ? "animate-spin" : ""}
      />
      {pending ? "Memperbarui…" : "Perbarui data"}
    </Button>
  );
}
