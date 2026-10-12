"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavGroup {
  section: string;
  items: { href: string; title: string }[];
}

/** The docs and reference sidebar. */
export default function DocsNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  return (
    <nav className="space-y-6 text-[15px]">
      {groups.map((g) => (
        <div key={g.section}>
          <div className="mb-1.5 px-3 text-[12px] font-semibold uppercase tracking-wide text-muted">{g.section}</div>
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const on = path === i.href || path === i.href.replace(/\/$/, "");
              return (
                <li key={i.href}>
                  <Link href={i.href} className={`block rounded-lg px-3 py-1.5 transition ${on ? "bg-brand/12 font-semibold text-brand-light" : "text-ink/80 hover:bg-circle"}`}>
                    {i.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
