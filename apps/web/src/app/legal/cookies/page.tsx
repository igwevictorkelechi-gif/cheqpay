"use client";

import InfoPage, { Section } from "@/components/InfoPage";
import { DocLink, Mail, Table } from "@/components/LegalBits";
import { COMPANY, LEGAL_EFFECTIVE_DATE } from "@/lib/legal";

export default function CookiesPage() {
  return (
    <InfoPage title="Cookie Policy" subtitle={`Effective ${LEGAL_EFFECTIVE_DATE}`}>
      <Section>
        <p>
          This policy explains what CheqPay stores on your device when you use our website and app. We keep it to
          what the service needs. <strong>We do not use advertising cookies, and we do not track you across
          other websites or apps.</strong>
        </p>
      </Section>

      <Section heading="1. What we store">
        <Table
          head={["What", "Why", "Type"]}
          rows={[
            ["Your sign-in session", "Keeps you signed in securely between visits", "Strictly necessary"],
            ["App-lock and security settings", "Locks the app after inactivity and remembers your security choices", "Strictly necessary"],
            ["Display and app preferences", "Remembers settings such as theme and dismissed tips", "Functional"],
            ["Cached account data", "Makes screens load faster on your device", "Functional"],
            ["Error reports (Sentry)", "Tells us when something breaks so we can fix it", "Performance"],
          ]}
        />
        <p>
          Most of these are kept in your browser&apos;s local storage or your phone&apos;s secure storage rather than
          as cookies, but they serve the same purpose and we treat them the same way.
        </p>
      </Section>

      <Section heading="2. Your choices">
        <p>
          Strictly necessary storage is needed for CheqPay to work: without it you cannot stay signed in or
          transact safely. You can clear everything at any time by signing out and clearing your browser&apos;s
          site data, or by uninstalling the app.
        </p>
      </Section>

      <Section heading="3. More information">
        <p>
          See our <DocLink href="/privacy">Privacy Policy</DocLink> for how we handle personal data, or contact{" "}
          <Mail to={COMPANY.privacyEmail} />.
        </p>
      </Section>
    </InfoPage>
  );
}
