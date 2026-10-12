import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DocsFrame from "@/components/DocsFrame";
import { DOCS, docBySlug } from "@/content/docs";

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const doc = docBySlug((await params).slug);
  return doc ? { title: doc.title, description: doc.summary } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const doc = docBySlug((await params).slug);
  if (!doc) notFound();
  const i = DOCS.indexOf(doc);
  const prev = DOCS[i - 1];
  const next = DOCS[i + 1];
  return (
    <DocsFrame>
      <article className="appear max-w-3xl">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-brand-light">{doc.section}</p>
        <h1 className="title-lg mt-1">{doc.title}</h1>
        <p className="subhead mt-2 text-[17px]">{doc.summary}</p>
        <div className="prose-doc mt-6">{doc.body()}</div>
        <div className="mt-12 flex justify-between gap-4 border-t border-border/60 pt-6 text-[15px]">
          {prev ? <Link href={`/docs/${prev.slug}/`} className="link">← {prev.title}</Link> : <span />}
          {next ? <Link href={`/docs/${next.slug}/`} className="link">{next.title} →</Link> : <span />}
        </div>
      </article>
    </DocsFrame>
  );
}
