import Link from "next/link";
import { FolderKey, KeyRound, Webhook } from "lucide-react";
export default function ProjectTabs({
  id,
  section,
}: {
  id: string;
  section: "overview" | "api-keys" | "webhooks";
}) {
  return (
    <nav
      aria-label="Bagian project"
      className="mb-7 flex flex-wrap gap-x-5 border-b text-sm"
    >
      {[
        {
          key: "overview",
          label: "Overview",
          href: `/dashboard/projects/${id}`,
          icon: FolderKey,
        },
        {
          key: "api-keys",
          label: "API keys",
          href: `/dashboard/projects/${id}/api-keys`,
          icon: KeyRound,
        },
        {
          key: "webhooks",
          label: "Webhooks",
          href: `/dashboard/projects/${id}/webhooks`,
          icon: Webhook,
        },
      ].map(({ key, label, href, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={section === key ? "page" : undefined}
          className={`inline-flex min-h-11 items-center gap-2 ${section === key ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
        >
          <Icon size={16} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
