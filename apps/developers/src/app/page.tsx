import Link from "next/link";
import { ArrowRight, Banknote, CreditCard, Landmark, Receipt, ShieldCheck, Webhook } from "lucide-react";
import CodeBlock from "@/components/CodeBlock";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { PUBLIC_API } from "@/lib/api";

const FEATURES = [
  { Icon: Landmark, title: "Virtual accounts", body: "A bank account number in each customer's name. Transfers in land in their wallet, with a webhook." },
  { Icon: Banknote, title: "Wallets and transfers", body: "NGN and USD wallets for you and every verified customer. Move and convert between them instantly." },
  { Icon: Receipt, title: "Bill payments", body: "Airtime, data, electricity and cable TV from any naira wallet, with meter tokens returned." },
  { Icon: CreditCard, title: "USD virtual cards", body: "Issue dollar cards to verified customers, fund them from a wallet, freeze them in one call." },
  { Icon: Webhook, title: "Signed webhooks", body: "Every change is an event, signed in the open Standard Webhooks format and retried for a day." },
  { Icon: ShieldCheck, title: "Built for money", body: "Idempotent requests, scoped keys with IP allowlists, daily limits and a ledger that always adds up." },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-5">
        <section className="appear grid items-center gap-10 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="text-[15px] font-semibold text-brand-light">CheqPay API</p>
            <h1 className="mt-2 text-[44px] font-bold leading-[1.05] tracking-[-0.03em] md:text-[56px]">Money for your customers, in one API.</h1>
            <p className="subhead mt-5 text-[19px] leading-relaxed">
              Give your customers naira wallets with their own account numbers, pay their bills, and issue them dollar cards. Start free in the
              sandbox; go live when you&apos;re ready.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/dashboard/" className="btn">Get a test key <ArrowRight className="h-5 w-5" /></Link>
              <Link href="/docs/quickstart/" className="btn-tinted">Read the quickstart</Link>
            </div>
          </div>
          <CodeBlock
            code={`curl -X POST ${PUBLIC_API}/bills/payments \\
  -H "Authorization: Bearer cp_test_sk_…" \\
  -H "Idempotency-Key: 4f8c…" \\
  -H "Content-Type: application/json" \\
  -d '{"service":"airtime","biller_id":"mtn",
       "customer":"08031234567","amount":50000}'

{
  "object": "transaction",
  "id": "txn_6b0e…",
  "kind": "bill_payment",
  "status": "successful",
  "amount": 50000,
  "currency": "NGN"
}`}
          />
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ Icon, title, body }) => (
            <div key={title} className="card">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/12 text-brand-light"><Icon className="h-6 w-6" /></span>
              <h2 className="headline mt-4">{title}</h2>
              <p className="subhead mt-1">{body}</p>
            </div>
          ))}
        </section>

        <section className="mt-16 grid gap-6 rounded-4xl bg-card p-8 shadow-card ring-1 ring-border/40 md:grid-cols-3">
          {[
            ["1", "Open a sandbox", "Sign in with your CheqPay account. Test keys and ₦1,000,000 of simulated money, free."],
            ["2", "Build and test", "Every product works in test mode, with test values for every outcome."],
            ["3", "Go live", "Verify your business, pick a plan, and switch to a live key."],
          ].map(([n, t, b]) => (
            <div key={n}>
              <span className="text-[13px] font-bold text-brand-light">Step {n}</span>
              <h3 className="headline mt-1">{t}</h3>
              <p className="subhead mt-1">{b}</p>
            </div>
          ))}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
