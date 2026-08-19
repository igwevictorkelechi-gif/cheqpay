"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageCircle, Phone, HelpCircle, FileText, Sparkles } from "lucide-react";
import InfoPage, { Section } from "@/components/InfoPage";
import { api } from "@/services/api";

type Channel = { icon: typeof Mail; title: string; subtitle: string; href: string };

export default function SupportPage() {
  const router = useRouter();
  const [contact, setContact] = useState<{ email: string; phone: string; whatsapp: string }>({
    email: "support@cheqpay.com",
    phone: "",
    whatsapp: "",
  });

  useEffect(() => {
    api
      .getSupportContact()
      .then(setContact)
      .catch(() => undefined);
  }, []);

  // Only render channels the business has configured — no placeholder numbers.
  const channels: Channel[] = [
    contact.email && {
      icon: Mail,
      title: "Email us",
      subtitle: contact.email,
      href: `mailto:${contact.email}`,
    },
    contact.whatsapp && {
      icon: MessageCircle,
      title: "WhatsApp",
      subtitle: "Chat with our team",
      href: `https://wa.me/${contact.whatsapp.replace(/[^\d]/g, "")}`,
    },
    contact.phone && {
      icon: Phone,
      title: "Call us",
      subtitle: contact.phone,
      href: `tel:${contact.phone.replace(/\s/g, "")}`,
    },
  ].filter(Boolean) as Channel[];

  return (
    <InfoPage title="Help & Support" subtitle="We're here to help, 24/7.">
      <button
        onClick={() => router.push("/support/chat")}
        className="mb-3 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-brand to-brand-light p-4 text-left active:scale-[0.99]"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
          <Sparkles className="h-5 w-5 text-white" />
        </span>
        <div className="flex-1">
          <p className="font-bold text-white">Chat with Cheq</p>
          <p className="text-sm text-white/80">Instant answers from our AI assistant</p>
        </div>
      </button>
      <div className="space-y-3">
        {channels.map((c) => {
          const Icon = c.icon;
          return (
            <a
              key={c.title}
              href={c.href}
              target={c.href.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
              className="flex items-center gap-3 rounded-2xl bg-card p-4 active:scale-[0.99]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/20">
                <Icon className="h-5 w-5 text-brand-light" />
              </span>
              <div className="flex-1">
                <p className="font-bold text-ink">{c.title}</p>
                <p className="text-sm text-muted">{c.subtitle}</p>
              </div>
            </a>
          );
        })}
      </div>

      <div className="mt-6 space-y-3">
        <button
          onClick={() => router.push("/faq")}
          className="flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left active:scale-[0.99]"
        >
          <HelpCircle className="h-5 w-5 text-muted" />
          <span className="flex-1 font-semibold text-ink">Browse FAQs</span>
        </button>
        <button
          onClick={() => router.push("/legal")}
          className="flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left active:scale-[0.99]"
        >
          <FileText className="h-5 w-5 text-muted" />
          <span className="flex-1 font-semibold text-ink">Legal &amp; policies</span>
        </button>
      </div>

      <Section heading="Before you reach out">
        <p>
          For the fastest help, include your registered email and the transaction
          reference (you&apos;ll find it on the Transactions screen). Never share your
          password, OTP or recovery phrase with anyone — CheqPay staff will never ask
          for them.
        </p>
      </Section>

      <Section heading="Things we get asked most">
        <p>
          <strong>A deposit has not arrived.</strong> Bank transfers into your CheqPay
          account number usually land within minutes, but a bank can hold one longer at
          peak times. Check that the transfer went to your own dedicated account number
          and, if it has been more than an hour, send us the bank&apos;s transaction
          reference and we will trace it.
        </p>
        <p className="mt-3">
          <strong>A withdrawal is still processing.</strong> Naira payouts settle
          through the receiving bank, so the last leg is theirs rather than ours. Crypto
          withdrawals are broadcast immediately and then wait on network confirmations —
          usually minutes for USDT and up to about an hour for Bitcoin.
        </p>
        <p className="mt-3">
          <strong>Verification was not approved.</strong> The commonest cause is a name
          that does not match the one on your BVN, or a document photo where an edge or
          a digit is cut off. Resubmit with the full document in frame and the name
          exactly as your bank has it.
        </p>
        <p className="mt-3">
          <strong>A bill payment did not deliver.</strong> If the value never arrived,
          the amount is returned to your CheqPay balance automatically. Send us the
          transaction reference and the phone number or meter number you were paying and
          we will confirm what happened.
        </p>
      </Section>
    </InfoPage>
  );
}
