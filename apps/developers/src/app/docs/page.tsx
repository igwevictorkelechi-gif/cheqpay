import type { Metadata } from "next";
import Link from "next/link";
import DocsFrame from "@/components/DocsFrame";
import { DOCS, SECTIONS } from "@/content/docs";

export const metadata: Metadata = { title: "Docs", description: "Guides for the CheqPay API." };

export default function DocsIndex() {
  return (
    <DocsFrame>
      <div className="appear">
        <h1 className="title-lg">Documentation</h1>
        <p className="subhead mt-2 text-[17px]">Everything you need to build on CheqPay. New here? Start with the <Link href="/docs/quickstart/" className="link">quickstart</Link>.</p>
        {SECTIONS.map((section) => (
          <section key={section} className="mt-10">
            <h2 className="section-label !px-0">{section}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {DOCS.filter((d) => d.section === section).map((d) => (
                <Link key={d.slug} href={`/docs/${d.slug}/`} className="card block transition hover:ring-brand/40">
                  <div className="headline">{d.title}</div>
                  <p className="subhead mt-1">{d.summary}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </DocsFrame>
  );
}
