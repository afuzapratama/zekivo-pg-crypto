import { Badge } from "@/components/ui/badge";
const colors: Record<string, string> = {
  paid: "border-emerald-200 bg-emerald-50 text-emerald-800",
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  confirming: "border-blue-200 bg-blue-50 text-blue-800",
  expired: "border-slate-200 bg-slate-100 text-slate-700",
};
export default function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={`gap-1.5 px-2.5 py-1 font-medium ${colors[status] ?? ""}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {status}
    </Badge>
  );
}
