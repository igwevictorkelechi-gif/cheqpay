import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/api";

export default function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-[14px] text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} CheqPay. Developer support: <a className="link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>
        <div className="flex gap-4">
          <Link href="/docs/changelog/" className="hover:text-ink">Changelog</Link>
          <a href="https://mycheqpay.com/terms" className="hover:text-ink">Terms</a>
          <a href="https://mycheqpay.com/privacy" className="hover:text-ink">Privacy</a>
        </div>
      </div>
    </footer>
  );
}
