"use client";

import { useState } from "react";
import { Mail, MapPin, Globe, Send } from "lucide-react";
import InfoPage, { Section } from "@/components/InfoPage";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const canSend = name.trim() && email.trim() && message.trim();

  function submit() {
    if (!canSend) return;
    const subject = encodeURIComponent(`CheqPay enquiry from ${name.trim()}`);
    const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`);
    window.location.href = `mailto:support@cheqpay.com?subject=${subject}&body=${body}`;
  }

  return (
    <InfoPage title="Contact us" subtitle="Send us a message and we'll get back to you.">
      <div className="space-y-4 rounded-3xl bg-card p-5">
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-muted">Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-ink placeholder-muted outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-muted">Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="you@example.com"
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-ink placeholder-muted outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-muted">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="How can we help?"
            className="w-full resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-ink placeholder-muted outline-none focus:border-brand"
          />
        </div>
        <button
          onClick={submit}
          disabled={!canSend}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand to-brand-light py-3.5 font-bold text-white active:scale-[0.99] disabled:opacity-40"
        >
          <Send className="h-4 w-4" /> Send message
        </button>
      </div>

      <Section heading="Other ways to reach us">
        <div className="space-y-3">
          <a
            href="mailto:support@cheqpay.com"
            className="flex items-center gap-3 text-sm text-ink"
          >
            <Mail className="h-5 w-5 text-brand-light" /> support@cheqpay.com
          </a>
          <div className="flex items-center gap-3 text-sm text-ink">
            <Globe className="h-5 w-5 text-brand-light" /> www.cheqpay.com
          </div>
          <div className="flex items-start gap-3 text-sm text-ink">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-light" /> Lagos, Nigeria
          </div>
        </div>
      </Section>
    </InfoPage>
  );
}
