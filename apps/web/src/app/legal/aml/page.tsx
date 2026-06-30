"use client";

import InfoPage, { Section } from "@/components/InfoPage";

export default function AmlPage() {
  return (
    <InfoPage title="AML & KYC Policy" subtitle="Last updated: 30 June 2026">
      <Section>
        <p>
          CheqPay is committed to preventing money laundering, terrorist financing and
          other financial crime. This policy summarises the controls we apply.
        </p>
      </Section>

      <Section heading="1. Know Your Customer (KYC)">
        <p>
          We verify the identity of our users using government-issued ID, BVN and, where
          required, liveness checks. Higher transaction limits require higher verification
          tiers.
        </p>
      </Section>

      <Section heading="2. Transaction monitoring">
        <p>
          All transactions are screened in real time. We assess amount, velocity and
          destination, and may hold, review or block activity that appears suspicious.
        </p>
      </Section>

      <Section heading="3. Sanctions screening">
        <p>
          We screen wallet addresses and counterparties against sanctions and watch-lists.
          Transactions involving sanctioned parties are rejected.
        </p>
      </Section>

      <Section heading="4. Reporting">
        <p>
          Where required by law, we report suspicious activity to the relevant authorities
          and cooperate fully with regulators and law enforcement.
        </p>
      </Section>

      <Section heading="5. Record keeping">
        <p>
          We retain identity and transaction records for the period required by applicable
          regulations.
        </p>
      </Section>

      <p className="mt-8 text-xs text-muted">
        This document is a general template and should be reviewed by qualified legal
        counsel before relying on it in production.
      </p>
    </InfoPage>
  );
}
