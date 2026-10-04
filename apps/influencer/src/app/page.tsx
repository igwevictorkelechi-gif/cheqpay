import Link from "next/link";
import { BadgePercent, ListChecks, Link2, Wallet } from "lucide-react";
import Logo from "@/components/Logo";

const STEPS = [
  { Icon: Link2, title: "Share your link", body: "Get your own code and tracking link. Share it in your posts, stories, bio and videos." },
  { Icon: BadgePercent, title: "Earn on every transaction", body: "When your audience joins CheqPay with your link, you earn a share of what we make on their transactions — not just once, but for months." },
  { Icon: ListChecks, title: "Complete tasks for bonuses", body: "Hit sign-up targets, create content for campaigns and get paid extra for each task you complete." },
  { Icon: Wallet, title: "Get paid into CheqPay", body: "Earnings land in your CheqPay Naira balance. Withdraw to your bank any time." },
];

export default function Landing() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <header className="flex items-center justify-between py-5">
        <Logo />
        <Link href="/login" className="btn-ghost !px-5 !py-2 text-sm">Sign in</Link>
      </header>

      <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#2a2142] via-[#1a1530] to-[#0E0C14] px-6 py-16 text-center md:py-24">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-gold/20 blur-3xl" />
        <p className="relative text-xs font-bold uppercase tracking-[0.3em] text-gold">The CheqPay influencer program</p>
        <h1 className="relative mx-auto mt-4 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
          Your audience moves money. <span className="text-gold">Get paid for it.</span>
        </h1>
        <p className="relative mx-auto mt-5 max-w-xl text-muted md:text-lg">
          Share CheqPay with your followers and earn on every transaction they make — sending money, paying bills, converting, trading crypto.
        </p>
        <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/apply" className="btn w-full !py-4 text-base sm:w-auto">Apply to join</Link>
          <Link href="/login" className="btn-ghost w-full !py-4 text-base sm:w-auto">I&apos;m already in</Link>
        </div>
      </section>

      <section className="grid gap-4 py-14 md:grid-cols-4">
        {STEPS.map(({ Icon, title, body }, i) => (
          <div key={title} className="card">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold/15 text-gold"><Icon className="h-5 w-5" /></span>
            <p className="mt-4 text-xs font-bold text-muted">STEP {i + 1}</p>
            <p className="mt-1 text-lg font-bold">{title}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
          </div>
        ))}
      </section>

      <section className="card mb-14 flex flex-col items-center justify-between gap-4 text-center md:flex-row md:text-left">
        <div>
          <p className="text-xl font-extrabold">Need a CheqPay account first?</p>
          <p className="mt-1 text-sm text-muted">You sign in here with your CheqPay account — your earnings are paid into it.</p>
        </div>
        <a href="https://mycheqpay.com/signup/" className="btn">Create an account</a>
      </section>

      <footer className="flex flex-col items-center justify-between gap-2 border-t border-border py-8 text-sm text-muted md:flex-row">
        <p>© {new Date().getFullYear()} CheqPay</p>
        <div className="flex gap-4">
          <a href="https://mycheqpay.com/terms/" className="hover:text-ink">Terms</a>
          <a href="https://mycheqpay.com/privacy/" className="hover:text-ink">Privacy</a>
          <a href="mailto:support@mycheqpay.com" className="hover:text-ink">support@mycheqpay.com</a>
        </div>
      </footer>
    </div>
  );
}
