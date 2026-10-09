import Link from "next/link";
import { BadgePercent, ListChecks, Link2, Wallet } from "lucide-react";
import ApplyButton from "@/components/ApplyButton";
import Logo from "@/components/Logo";

const STEPS = [
  { Icon: Link2, title: "Share your link", body: "Your own code and link for posts, stories, bio and videos." },
  { Icon: BadgePercent, title: "Earn on every transaction", body: "A share of what we make each time your audience sends, pays bills or converts — for months, not once." },
  { Icon: ListChecks, title: "Paid brand tasks", body: "Hit sign-up targets and post for brands on CheqPay to earn extra." },
  { Icon: Wallet, title: "Paid into CheqPay", body: "Earnings land in your CheqPay wallet. Withdraw to your bank any time." },
];

export default function Landing() {
  return (
    <div className="mx-auto max-w-5xl px-5">
      <header className="flex items-center justify-between py-5">
        <Logo />
        <Link href="/login" className="btn-ghost !h-10 !px-4 text-[15px]">Sign in</Link>
      </header>

      <section className="appear pb-16 pt-14 text-center md:pt-24">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-brand-light">CheqPay Creators</p>
        <h1 className="mx-auto mt-4 max-w-3xl text-[40px] font-bold leading-[1.05] tracking-[-0.03em] md:text-[64px]">
          Your audience moves money.{" "}
          <span className="bg-gradient-to-r from-brand-light to-gold bg-clip-text text-transparent">Get paid for it.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-[19px] leading-snug text-muted">
          Share CheqPay with your followers and earn on every transaction they make.
        </p>
        <div className="mx-auto mt-9 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
          <ApplyButton className="btn sm:min-w-[200px]">Apply with CheqPay</ApplyButton>
          <Link href="/login" className="btn-tinted sm:min-w-[200px]">I&apos;m already a creator</Link>
        </div>
        <p className="footnote mt-4">Use your CheqPay account. New to CheqPay? You can create one on the way.</p>
      </section>

      <section className="grid gap-3 pb-16 sm:grid-cols-2 md:grid-cols-4">
        {STEPS.map(({ Icon, title, body }) => (
          <div key={title} className="card">
            <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-brand/12 text-brand-light"><Icon className="h-6 w-6" /></span>
            <p className="headline mt-4">{title}</p>
            <p className="subhead mt-1 leading-snug">{body}</p>
          </div>
        ))}
      </section>

      <footer className="flex flex-col items-center justify-between gap-3 border-t border-border/70 py-8 text-[13px] text-muted md:flex-row">
        <p>© {new Date().getFullYear()} CheqPay</p>
        <div className="flex gap-5">
          <a href="https://mycheqpay.com/terms/" className="hover:text-ink">Terms</a>
          <a href="https://mycheqpay.com/privacy/" className="hover:text-ink">Privacy</a>
          <a href="mailto:support@mycheqpay.com" className="hover:text-ink">Support</a>
        </div>
      </footer>
    </div>
  );
}
