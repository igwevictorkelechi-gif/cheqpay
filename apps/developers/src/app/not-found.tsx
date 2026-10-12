import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-md px-5 py-24 text-center">
        <h1 className="title-lg">Page not found</h1>
        <p className="subhead mt-2">That page doesn&apos;t exist. Try the docs.</p>
        <Link href="/docs/" className="btn mt-8">Go to the docs</Link>
      </main>
    </div>
  );
}
