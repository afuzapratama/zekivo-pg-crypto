import Link from "next/link";
export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-2.5 text-base font-semibold tracking-tight text-foreground no-underline"
    >
      <span className="brand-mark" aria-hidden="true">
        z.
      </span>
      zekivo<span className="font-normal text-muted-foreground">pay</span>
    </Link>
  );
}
