/**
 * Enumerates the assets that have a detail page for the static export.
 *
 * `generateStaticParams` has to live in a server component, and the page here
 * is "use client" — hence a layout that does nothing but list the paths.
 * Without it `output: "export"` fails: a static build must know every route at
 * build time.
 */
export function generateStaticParams() {
  return ["BTC", "USDT", "USDC", "NGN"].map((symbol) => ({ symbol }));
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
