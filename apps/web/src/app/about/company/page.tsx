"use client";

import InfoPage, { Section } from "@/components/InfoPage";

export default function CompanyPage() {
  return (
    <InfoPage title="Our story">
      <Section heading="Who we are">
        <p>
          CheqPay was founded to make money — fiat and crypto — move freely and safely
          for everyone in Nigeria. We believe finance should be borderless, instant and
          fair, without the friction and hidden fees of traditional banking.
        </p>
      </Section>

      <Section heading="What we do">
        <p>From a single app you can:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Get your own Naira account number and withdraw to any Nigerian bank.</li>
          <li>Pay another CheqPay user instantly by username.</li>
          <li>Pay for airtime, data, electricity, cable TV and more.</li>
          <li>Hold US dollars and convert between Naira, dollars and supported digital assets at a quoted rate.</li>
          <li>Receive USDT and USDC to your own deposit address.</li>
          <li>Buy gadgets and event tickets from your balance.</li>
        </ul>
      </Section>

      <Section heading="Our mission">
        <p>
          To give every Nigerian a simple, secure gateway to the global digital economy —
          beyond finance.
        </p>
      </Section>

      <Section heading="Security first">
        <p>
          Every account is identity-verified. Your data is encrypted in transit and at rest,
          transactions are screened for fraud and money laundering, and you can add two-factor
          authentication and an app lock. Your money is held by our licensed payment partner.
          We never sell your data, and we share it only as our Privacy Policy explains.
        </p>
      </Section>
    </InfoPage>
  );
}
