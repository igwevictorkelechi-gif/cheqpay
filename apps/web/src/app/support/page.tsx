"use client";

import { useRouter } from "next/navigation";
import { Mail, MessageCircle, Phone, HelpCircle, FileText } from "lucide-react";
import InfoPage, { Section } from "@/components/InfoPage";

export default function SupportPage() {
  const router = useRouter();

  const channels = [
    {
      icon: Mail,
      title: "Email us",
      subtitle: "support@cheqpay.com",
      href: "mailto:support@cheqpay.com",
    },
    {
      icon: MessageCircle,
      title: "Live chat / WhatsApp",
      subtitle: "Chat with our team",
      href: "https://wa.me/2348000000000",
    },
    {
      icon: Phone,
      title: "Call us",
      subtitle: "+234 800 000 0000",
      href: "tel:+2348000000000",
    },
  ];

  return (
    <InfoPage title="Help & Support" subtitle="We're here to help, 24/7.">
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
