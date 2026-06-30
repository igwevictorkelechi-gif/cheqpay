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
          <li>Buy and sell Bitcoin and USDT at live market rates.</li>
          <li>Convert instantly between NGN, BTC and USDT.</li>
          <li>Send and receive crypto to any wallet.</li>
          <li>Pay for airtime, data, electricity, cable TV and more.</li>
          <li>Fund and withdraw to your Nigerian bank account.</li>
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
          Your funds and data are protected with bank-grade encryption, custodial wallet
          safeguards, AML screening and optional two-factor authentication. We never share
          your information without your consent.
        </p>
      </Section>
    </InfoPage>
  );
}
