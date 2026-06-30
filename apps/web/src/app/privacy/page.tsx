"use client";

import InfoPage, { Section } from "@/components/InfoPage";

export default function PrivacyPage() {
  return (
    <InfoPage title="Privacy Policy" subtitle="Last updated: 30 June 2026">
      <Section>
        <p>
          This Privacy Policy explains how CheqPay (&quot;we&quot;, &quot;us&quot;)
          collects, uses, stores and protects your information when you use our app and
          services. By using CheqPay you agree to the practices described here.
        </p>
      </Section>

      <Section heading="1. Information we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>Account details: name, email, phone number and password.</li>
          <li>Identity (KYC) data: government ID, BVN and selfie where required by law.</li>
          <li>Transaction data: deposits, withdrawals, trades, conversions and bill payments.</li>
          <li>Device and usage data: IP address, device type and app activity.</li>
        </ul>
      </Section>

      <Section heading="2. How we use your information">
        <ul className="list-disc space-y-1 pl-5">
          <li>To provide, operate and improve our services.</li>
          <li>To verify your identity and comply with AML/KYC regulations.</li>
          <li>To process transactions and prevent fraud.</li>
          <li>To communicate with you about your account and support requests.</li>
        </ul>
      </Section>

      <Section heading="3. How we share information">
        <p>
          We share data only with regulated partners that help us operate — such as
          payment processors, custody and identity-verification providers — and with
          authorities where required by law. We never sell your personal data.
        </p>
      </Section>

      <Section heading="4. Data security">
        <p>
          We protect your data with encryption in transit and at rest, access controls
          and continuous monitoring. No system is perfectly secure, so we also encourage
          you to enable two-factor authentication and keep your credentials private.
        </p>
      </Section>

      <Section heading="5. Your rights">
        <p>
          You may access, correct or request deletion of your personal data, subject to
          legal record-keeping obligations. To exercise these rights, contact
          support@cheqpay.com.
        </p>
      </Section>

      <Section heading="6. Data retention">
        <p>
          We retain your information for as long as your account is active and as required
          by applicable financial regulations after closure.
        </p>
      </Section>

      <Section heading="7. Changes to this policy">
        <p>
          We may update this policy from time to time. Material changes will be notified
          in-app. Continued use after changes constitutes acceptance.
        </p>
      </Section>

      <Section heading="8. Contact">
        <p>
          Questions about your privacy? Email support@cheqpay.com.
        </p>
      </Section>

      <p className="mt-8 text-xs text-muted">
        This document is a general template and should be reviewed by qualified legal
        counsel before relying on it in production.
      </p>
    </InfoPage>
  );
}
