/**
 * Enumerates the bill services for the static export.
 *
 * `generateStaticParams` has to live in a server component, and the page here
 * is "use client" — hence a layout that does nothing but list the paths.
 * Without it `output: "export"` fails: a static build must know every route at
 * build time.
 */
export function generateStaticParams() {
  return ["airtime", "data", "electricity", "cabletv", "betting"].map((service) => ({ service }));
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
