"use client";

import InfoPage, { Section } from "@/components/InfoPage";

export default function TermsPage() {
  return (
    <InfoPage title="Terms of Service" subtitle="Last updated: 30 June 2026">
      <Section>
        <p>
          These Terms of Service (&quot;Terms&quot;) govern your access to and use of the
          CheqPay app and services. By creating an account or using CheqPay, you agree to
          these Terms.
        </p>
      </Section>

      <Section heading="1. Eligibility">
        <p>
          You must be at least 18 years old and able to form a binding contract. You agree
          to provide accurate information and to complete identity verification (KYC) when
          required.
        </p>
      </Section>

      <Section heading="2. Your account">
        <p>
          You are responsible for safeguarding your login credentials and for all activity
          on your account. Notify us immediately of any unauthorised use. We may suspend or
          close accounts that violate these Terms or applicable law.
        </p>
      </Section>

      <Section heading="3. Services">
        <p>
          CheqPay enables Naira payments, buying, selling and converting crypto, crypto
          transfers, and bill payments. Crypto prices are volatile; quotes are valid only
          for the short window shown before you confirm.
        </p>
      </Section>

      <Section heading="4. Fees and rates">
        <p>
          Applicable fees and exchange-rate spreads are shown before you confirm a
          transaction. By confirming, you accept the displayed amount and rate.
        </p>
      </Section>

      <Section heading="5. Crypto risks">
        <ul className="list-disc space-y-1 pl-5">
          <li>Crypto values can rise or fall significantly and rapidly.</li>
          <li>Blockchain transactions are irreversible once broadcast.</li>
          <li>You are responsible for providing correct wallet addresses and networks.</li>
        </ul>
      </Section>

      <Section heading="6. Prohibited use">
        <p>
          You may not use CheqPay for money laundering, fraud, financing illegal activity,
          or any purpose prohibited by law. We screen transactions and may report and block
          suspicious activity.
        </p>
      </Section>

      <Section heading="7. Limitation of liability">
        <p>
          To the fullest extent permitted by law, CheqPay is not liable for indirect or
          consequential losses, or for losses arising from market movements, user error, or
          events beyond our reasonable control.
        </p>
      </Section>

      <Section heading="8. Changes and termination">
        <p>
          We may update these Terms or discontinue features at any time. Material changes
          will be notified in-app. You may close your account at any time, subject to
          settlement of pending transactions.
        </p>
      </Section>

      <Section heading="9. Governing law">
        <p>These Terms are governed by the laws of the Federal Republic of Nigeria.</p>
      </Section>

      <Section heading="10. Contact">
        <p>Questions about these Terms? Email support@cheqpay.com.</p>
      </Section>

      <p className="mt-8 text-xs text-muted">
        This document is a general template and should be reviewed by qualified legal
        counsel before relying on it in production.
      </p>
    </InfoPage>
  );
}
