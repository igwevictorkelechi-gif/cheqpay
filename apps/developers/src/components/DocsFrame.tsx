import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import DocsNav, { type NavGroup } from "./DocsNav";
import { DOCS, SECTIONS } from "@/content/docs";

export const DOC_GROUPS: NavGroup[] = SECTIONS.map((section) => ({
  section,
  items: DOCS.filter((d) => d.section === section).map((d) => ({ href: `/docs/${d.slug}/`, title: d.title })),
}));

/** Docs pages: header, sidebar, content. */
export default function DocsFrame({ children, groups = DOC_GROUPS }: { children: React.ReactNode; groups?: NavGroup[] }) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto flex max-w-6xl gap-10 px-5 pt-8">
        <aside className="sticky top-20 hidden h-[calc(100vh-6rem)] w-56 shrink-0 overflow-y-auto pb-10 lg:block">
          <DocsNav groups={groups} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      <SiteFooter />
    </div>
  );
}
