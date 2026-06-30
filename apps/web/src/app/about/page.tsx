"use client";

import { useRouter } from "next/navigation";
import InfoPage, { LinkRow, Section } from "@/components/InfoPage";

export default function AboutHubPage() {
  const router = useRouter();
  return (
    <InfoPage title="About CheqPay" subtitle="Everything you need to know about us.">
      <Section>
        <p>
          CheqPay is a Nigerian fintech that lets you send money, buy and sell crypto
          (BTC &amp; USDT), convert between assets, and pay everyday bills — all in one
          secure app.
        </p>
      </Section>

      <div className="space-y-3">
        <LinkRow
          emoji="🏢"
          title="Our story"
          subtitle="Who we are and what we stand for"
          onClick={() => router.push("/about/company")}
        />
        <LinkRow
          emoji="❓"
          title="FAQs"
          subtitle="Answers to common questions"
          onClick={() => router.push("/faq")}
        />
        <LinkRow
          emoji="💬"
          title="Help &amp; Support"
          subtitle="Get help with your account"
          onClick={() => router.push("/support")}
        />
        <LinkRow
          emoji="✉️"
          title="Contact us"
          subtitle="Reach our team"
          onClick={() => router.push("/contact")}
        />
        <LinkRow
          emoji="⚖️"
          title="Legal &amp; policies"
          subtitle="Privacy, terms and more"
          onClick={() => router.push("/legal")}
        />
      </div>
    </InfoPage>
  );
}
