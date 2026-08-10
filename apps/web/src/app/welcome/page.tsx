"use client";

import Link from "next/link";
import { useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import {
  ArrowRight,
  Bitcoin,
  CreditCard,
  Landmark,
  Lock,
  Menu,
  Receipt,
  Send,
  ShieldCheck,
  Smartphone,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * The public landing page — what somebody sees when they arrive at CheqPay in a
 * browser without an account.
 *
 * Deliberately outside AppShell: the shell is signed-in furniture (bottom tabs,
 * account sidebar) and none of it means anything to a visitor. This page is a
 * plain responsive document instead, so it reads correctly at every width from
 * a phone in landscape to a desktop monitor.
 *
 * It is also fully static — no API call, no auth check — so it renders on the
 * first paint even in the static export used for cPanel hosting, and works
 * before the API is reachable.
 */

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Landmark,
    title: "A Naira account of your own",
    body: "Get a dedicated account number after verification. Money sent to it from any Nigerian bank lands in your CheqPay balance.",
  },
  {
    icon: Send,
    title: "Send to any bank",
    body: "Transfer to any Nigerian bank account. We confirm the recipient's name before you part with a kobo.",
  },
  {
    icon: Users,
    title: "Send to a username",
    body: "Pay another CheqPay user instantly with nothing but their username. No account numbers, no waiting.",
  },
  {
    icon: Receipt,
    title: "Pay your bills",
    body: "Airtime, data, electricity and cable TV — topped up in seconds from the same balance.",
  },
  {
    icon: Bitcoin,
    title: "Buy and sell crypto",
    body: "Move between Naira and crypto at rates you can see before you commit.",
  },
  {
    icon: CreditCard,
    title: "Virtual cards",
    body: "Create a USD card for the subscriptions and online payments that will not take a Naira card.",
  },
];

const TRUST: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ShieldCheck,
    title: "Verified accounts",
    body: "Every account is identity-verified before it can move money, which is what keeps the platform clean for everyone on it.",
  },
  {
    icon: Lock,
    title: "Your session, your device",
    body: "App lock, two-factor sign-in, and a record of the devices your account has been used on.",
  },
  {
    icon: Smartphone,
    title: "Browser or app",
    body: "The same account works here in your browser and in the CheqPay mobile app. Start on one, finish on the other.",
  },
];

function Logo() {
  return (
    <Link href="/welcome" aria-label="CheqPay home" className="shrink-0">
      <BrandLogo priority className="h-auto w-[132px] sm:w-[150px]" />
    </Link>
  );
}

export default function WelcomePage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface text-ink">
      {/* ---- Top bar ---- */}
      <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Logo />

          <nav className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-medium text-ink/80 transition-colors hover:text-ink">
              Features
            </a>
            <a href="#security" className="text-sm font-medium text-ink/80 transition-colors hover:text-ink">
              Security
            </a>
            <Link href="/support" className="text-sm font-medium text-ink/80 transition-colors hover:text-ink">
              Support
            </Link>
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-circle"
            >
              Sign in
            </Link>
            <Link href="/signup" className="btn-primary !px-5 !py-2.5 text-sm">
              Create account
            </Link>
          </div>

          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="rounded-xl p-2 text-ink transition-colors hover:bg-circle md:hidden"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-border bg-surface px-5 py-4 md:hidden">
            <nav className="flex flex-col gap-1">
              <a
                href="#features"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink/80 hover:bg-circle"
              >
                Features
              </a>
              <a
                href="#security"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink/80 hover:bg-circle"
              >
                Security
              </a>
              <Link
                href="/support"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink/80 hover:bg-circle"
              >
                Support
              </Link>
            </nav>
            <div className="mt-3 flex flex-col gap-2">
              <Link href="/login" className="btn-secondary w-full">
                Sign in
              </Link>
              <Link href="/signup" className="btn-primary w-full">
                Create account
              </Link>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* ---- Hero ---- */}
        <section className="relative overflow-hidden">
          {/* Brand wash behind the headline. pointer-events-none so it can never
              swallow a click on the buttons sitting above it. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[min(90vw,760px)] -translate-x-1/2 rounded-full bg-brand/25 blur-[110px]"
          />
          <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20 lg:pt-28">
            <div className="mx-auto max-w-3xl text-center">
              <span className="badge border border-border bg-card text-muted">
                Naira and crypto, one account
              </span>

              {/* Fluid type: scales with the viewport instead of jumping at
                  breakpoints, which is what keeps a landscape phone readable. */}
              <h1 className="mt-5 text-[clamp(2rem,7vw,3.75rem)] font-bold leading-[1.08] tracking-tight">
                Money that moves
                <span className="block bg-gradient-to-r from-brand-light to-brand bg-clip-text text-transparent">
                  as fast as you do
                </span>
              </h1>

              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
                Send money, pay bills, and buy crypto from one Naira balance.
                Open an account in minutes — in your browser or on your phone.
              </p>

              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/signup" className="btn-primary w-full sm:w-auto">
                  Create a free account
                  <ArrowRight size={18} className="ml-2" />
                </Link>
                <Link href="/login" className="btn-secondary w-full sm:w-auto">
                  I already have one
                </Link>
              </div>

              <p className="mt-4 text-xs text-muted">
                Free to open. No monthly fee.
              </p>
            </div>
          </div>
        </section>

        {/* ---- Features ---- */}
        <section id="features" className="scroll-mt-20 border-t border-border bg-surface-soft/40">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <div className="max-w-2xl">
              <h2 className="text-[clamp(1.5rem,4vw,2.25rem)] font-bold tracking-tight">
                Everything in one balance
              </h2>
              <p className="mt-3 text-muted">
                No juggling apps to get through a normal week.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.title} className="card-lg h-full">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/15 text-brand-light">
                      <Icon size={22} />
                    </span>
                    <h3 className="mt-4 font-semibold text-ink">{f.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---- Security ---- */}
        <section id="security" className="scroll-mt-20 border-t border-border">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <div className="max-w-2xl">
              <h2 className="text-[clamp(1.5rem,4vw,2.25rem)] font-bold tracking-tight">
                Built to be trusted with money
              </h2>
              <p className="mt-3 text-muted">
                The parts you should be able to take for granted.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {TRUST.map((t) => {
                const Icon = t.icon;
                return (
                  <div key={t.title} className="card-lg h-full">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/15 text-brand-light">
                      <Icon size={22} />
                    </span>
                    <h3 className="mt-4 font-semibold text-ink">{t.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{t.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---- Closing call to action ---- */}
        <section className="border-t border-border bg-surface-soft/40">
          <div className="mx-auto max-w-3xl px-5 py-16 text-center sm:px-8 sm:py-24">
            <h2 className="text-[clamp(1.5rem,4vw,2.25rem)] font-bold tracking-tight">
              Open your account today
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-muted">
              It takes a few minutes, and you can do the whole thing from this page.
            </p>
            <Link href="/signup" className="btn-primary mt-8 w-full sm:w-auto">
              Get started
              <ArrowRight size={18} className="ml-2" />
            </Link>
          </div>
        </section>
      </main>

      {/* ---- Footer ---- */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xs">
              <Logo />
              <p className="mt-3 text-sm text-muted">
                Naira and crypto in one account.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-8 text-sm sm:gap-14">
              <div>
                <p className="font-semibold text-ink">Company</p>
                <ul className="mt-3 space-y-2">
                  <li><Link href="/about" className="text-muted hover:text-ink">About</Link></li>
                  <li><Link href="/contact" className="text-muted hover:text-ink">Contact</Link></li>
                  <li><Link href="/support" className="text-muted hover:text-ink">Support</Link></li>
                  <li><Link href="/faq" className="text-muted hover:text-ink">FAQ</Link></li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-ink">Legal</p>
                <ul className="mt-3 space-y-2">
                  <li><Link href="/terms" className="text-muted hover:text-ink">Terms</Link></li>
                  <li><Link href="/privacy" className="text-muted hover:text-ink">Privacy</Link></li>
                  <li><Link href="/legal/aml" className="text-muted hover:text-ink">AML policy</Link></li>
                  <li><Link href="/legal/cookies" className="text-muted hover:text-ink">Cookies</Link></li>
                </ul>
              </div>
            </div>
          </div>

          <p className="mt-10 border-t border-border pt-6 text-xs text-muted">
            © {new Date().getFullYear()} CheqPay. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
