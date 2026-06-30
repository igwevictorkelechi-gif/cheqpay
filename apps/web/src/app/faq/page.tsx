"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import InfoPage from "@/components/InfoPage";

const FAQS: { q: string; a: string }[] = [
  {
    q: "What is CheqPay?",
    a: "CheqPay is an all-in-one app to send money, buy and sell crypto (BTC & USDT), convert between assets, and pay bills like airtime, data, electricity and cable TV.",
  },
  {
    q: "How do I fund my account?",
    a: "Tap Deposit to add Naira via bank transfer, or receive crypto to your in-app wallet from the Receive screen. Your balance updates once the payment is confirmed.",
  },
  {
    q: "How do I buy or sell crypto?",
    a: "Open the Crypto tab, pick an asset, and choose Buy or Sell. You'll see a live quote with the rate before you confirm. Buys use your NGN balance; sells credit it back.",
  },
  {
    q: "Can I convert BTC to USDT directly?",
    a: "Yes. On the Convert screen you can swap between NGN, BTC and USDT. BTC↔USDT conversions are priced from live market rates with our standard spread applied.",
  },
  {
    q: "How long do crypto withdrawals take?",
    a: "Once approved, withdrawals are broadcast to the network immediately. Confirmation time then depends on the blockchain — usually minutes for USDT (Tron) and up to an hour for Bitcoin.",
  },
  {
    q: "What are the fees?",
    a: "Crypto trades include a small spread on the exchange rate. Bill payments and Naira withdrawals may carry a network/processing fee, always shown before you confirm.",
  },
  {
    q: "Is there a minimum or limit?",
    a: "Minimums depend on the asset (e.g. 0.0001 BTC, 2 USDT). Daily limits depend on your KYC tier — verify your identity in Settings to raise them.",
  },
  {
    q: "How is my money kept safe?",
    a: "Funds sit in secured custodial wallets, transactions pass AML screening, and you can enable two-factor authentication. Sensitive data is encrypted in transit and at rest.",
  },
  {
    q: "I sent crypto to the wrong address — can it be reversed?",
    a: "No. Crypto transactions are irreversible. Always double-check the address and network before sending. CheqPay cannot recover funds sent to an incorrect address.",
  },
  {
    q: "How do I contact support?",
    a: "Visit Help & Support in the app, email support@cheqpay.com, or use the Contact us page. We aim to respond within 24 hours.",
  },
];

function Item({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen((v) => !v)}
      className="w-full rounded-2xl bg-card p-4 text-left active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-ink">{q}</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </div>
      {open && <p className="mt-3 text-sm leading-relaxed text-muted">{a}</p>}
    </button>
  );
}

export default function FaqPage() {
  return (
    <InfoPage title="FAQs" subtitle="Quick answers to the questions we hear most.">
      <div className="space-y-3">
        {FAQS.map((f) => (
          <Item key={f.q} {...f} />
        ))}
      </div>
    </InfoPage>
  );
}
