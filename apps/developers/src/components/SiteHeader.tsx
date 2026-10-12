import Link from "next/link";
import Logo from "./Logo";

const LINKS = [
  { href: "/docs/", label: "Docs" },
  { href: "/reference/", label: "API reference" },
  { href: "/pricing/", label: "Pricing" },
];

/** The public pages' header. */
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/50 bg-surface/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-full px-3.5 py-1.5 text-[15px] font-medium text-muted transition hover:bg-circle hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <Link href="/dashboard/" className="btn !h-9 !px-5 text-[15px]">Dashboard</Link>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="chip !min-h-[34px] text-[14px]">{l.label}</Link>
        ))}
      </nav>
    </header>
  );
}
