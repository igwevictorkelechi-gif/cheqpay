"use client";

import InfoPage, { Section } from "@/components/InfoPage";
import { DocLink, Mail, OperatorLine, Table } from "@/components/LegalBits";
import {
  COMPANY,
  DATA_LOCATIONS,
  LEGAL_EFFECTIVE_DATE,
  PRIMARY_PARTNER,
  RECORD_RETENTION_YEARS,
  SUB_PROCESSORS,
} from "@/lib/legal";

export default function PrivacyPage() {
  return (
    <InfoPage title="Privacy Policy" subtitle={`Effective ${LEGAL_EFFECTIVE_DATE}`}>
      <Section>
        <p>
          This Privacy Policy explains what personal data CheqPay collects, why, who we share it with, how long we
          keep it and the rights you have. It is written to meet the Nigeria Data Protection Act 2023 (the
          &quot;NDPA&quot;).
        </p>
        <OperatorLine />
        <p>
          CheqPay is the <strong>data controller</strong> for the personal data described here. For privacy
          questions or to exercise your rights, contact <Mail to={COMPANY.privacyEmail} />.
        </p>
      </Section>

      <Section heading="1. What we collect">
        <p>
          <strong>You give us:</strong>
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Account details: full name, email address, phone number and username.</li>
          <li>
            Identity details for verification: legal name, date of birth, address, Bank Verification Number (BVN),
            and a government-issued ID (its type, number and photos of the front and back).
          </li>
          <li>
            For a US dollar account: nationality, employment status and employer, and US residency status.
          </li>
          <li>Bank accounts you save for withdrawals, and the next of kin you choose to add.</li>
          <li>Delivery details (address and phone) when you order a gadget.</li>
          <li>What you tell us when you contact support.</li>
        </ul>
        <p>
          <strong>We create or collect as you use CheqPay:</strong>
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Transaction records: deposits, withdrawals, transfers, conversions, bill payments, card payments,
            digital-asset deposits and withdrawals, purchases and tickets.
          </li>
          <li>
            Security and device data: IP address, device and browser type, app version, sign-in times, and the
            push-notification token for your device.
          </li>
          <li>
            A secure hash of your transaction PIN — never the PIN itself. Face ID and fingerprint checks happen on
            your device; we never receive your biometric data.
          </li>
        </ul>
        <p>
          <strong>We receive from others:</strong> results of identity and BVN checks from{" "}
          {PRIMARY_PARTNER.name}, and details of payments made to your account by banks and other senders.
        </p>
      </Section>

      <Section heading="2. Why we use it, and our legal basis">
        <p>The NDPA requires a lawful basis for each use of your data. Ours are:</p>
        <Table
          head={["Purpose", "Legal basis"]}
          rows={[
            ["Opening and running your account, processing your transactions and deliveries", "Performance of our contract with you"],
            ["Verifying your identity, monitoring for fraud and money laundering, keeping records, reporting to authorities", "Legal obligation"],
            ["Protecting accounts and the platform: blocking suspicious devices and networks, investigating misuse", "Legitimate interests (security and fraud prevention)"],
            ["Service messages about your account, transactions and security", "Performance of our contract with you"],
            ["Promotional notifications — off unless you turn them on", "Your consent, which you can withdraw in notification settings"],
          ]}
        />
      </Section>

      <Section heading="3. Automated decisions">
        <p>
          Some checks are automated: for example, a withdrawal may be held for review because of its size or how
          often you have transacted, and your verification level may be set from the result of an identity check.
          A held transaction is reviewed by a person before it is refused. You can ask for any automated decision
          about you to be reviewed by a person by contacting <Mail to={COMPANY.privacyEmail} />.
        </p>
      </Section>

      <Section heading="4. Who we share it with">
        <p>
          <strong>We never sell your personal data.</strong> We share it only with the service providers who help
          us run CheqPay, under contracts that require them to protect it and use it only on our instructions:
        </p>
        <Table head={["Provider", "What for", "Data involved"]} rows={SUB_PROCESSORS.map((p) => [p.name, p.purpose, p.data])} />
        <p>We also share data:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>With the person you pay: your name or username appears on transfers you send.</li>
          <li>
            With regulators, law enforcement and the Nigerian Financial Intelligence Unit where the law requires
            it.
          </li>
          <li>With a buyer or successor if CheqPay is sold or reorganised, under the same protections.</li>
        </ul>
      </Section>

      <Section heading="5. Transfers outside Nigeria">
        <p>Some of our providers store or process data outside Nigeria:</p>
        <Table head={["Data", "Location", "Provider"]} rows={DATA_LOCATIONS.map((d) => [d.what, d.where, d.provider])} />
        <p>
          We transfer data abroad only where it is needed to provide the Services to you, and under safeguards the
          NDPA recognises, including the providers&apos; data-protection agreements. You can ask us for details of
          these safeguards.
        </p>
      </Section>

      <Section heading="6. How long we keep it">
        <ul className="list-disc space-y-1 pl-5">
          <li>While your account is open, we keep what we need to run it.</li>
          <li>
            When you close your account, we delete or anonymise your personal data, except identity, transaction
            and verification records, which the Money Laundering (Prevention and Prohibition) Act 2022 requires us
            to keep for at least {RECORD_RETENTION_YEARS} years after the account is closed. After that period they
            are deleted.
          </li>
          <li>Security logs are kept for as long as they are needed to protect accounts and investigate misuse.</li>
        </ul>
      </Section>

      <Section heading="7. How we protect it">
        <ul className="list-disc space-y-1 pl-5">
          <li>All data is encrypted in transit, and our database is encrypted at rest.</li>
          <li>
            Your BVN and ID number are additionally encrypted field by field. Staff see only the last four digits;
            the full number is shown only for a compliance review, and every such view is logged against the person
            who made it.
          </li>
          <li>ID-document photos are kept in private storage, reachable only through short-lived signed links.</li>
          <li>Staff access is limited to what their role needs, and every sensitive staff action is logged against the person who performed it.</li>
        </ul>
        <p>
          If a breach puts your data at risk, we will notify the Nigeria Data Protection Commission within 72 hours
          of becoming aware of it, and tell you without undue delay where it is likely to put your rights at high
          risk.
        </p>
      </Section>

      <Section heading="8. Your rights">
        <p>Under the NDPA you have the right to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>be told how your data is used (this policy);</li>
          <li>get a copy of your data;</li>
          <li>have inaccurate data corrected;</li>
          <li>have your data deleted, subject to the records the law requires us to keep;</li>
          <li>restrict or object to some uses, including anything based on legitimate interests;</li>
          <li>receive your data in a portable format;</li>
          <li>withdraw consent at any time, where we rely on it;</li>
          <li>have an automated decision reviewed by a person.</li>
        </ul>
        <p>
          You can delete your account yourself from the Account screen in the app. For any other request,
          email <Mail to={COMPANY.privacyEmail} />. We may need to confirm your identity, and we will respond within
          30 days. If you are unhappy with how we handle your data, you can complain to the Nigeria Data Protection
          Commission (NDPC).
        </p>
      </Section>

      <Section heading="9. Children">
        <p>
          CheqPay is only for people aged 18 and over. We do not knowingly collect data from anyone younger; if we
          learn we have, we will close the account and delete the data, except where the law requires us to keep
          it.
        </p>
      </Section>

      <Section heading="10. Cookies and similar technologies">
        <p>
          See our <DocLink href="/legal/cookies">Cookie Policy</DocLink>. In short: we use only what is needed to
          keep you signed in and remember your settings, plus error monitoring. We do not use advertising or
          cross-site tracking.
        </p>
      </Section>

      <Section heading="11. Changes to this policy">
        <p>
          If we make a material change, we will tell you in the app or by email before it takes effect. The date
          at the top shows when this version began.
        </p>
      </Section>
    </InfoPage>
  );
}
