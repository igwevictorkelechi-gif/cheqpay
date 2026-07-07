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
    </InfoPage>
  );
}
