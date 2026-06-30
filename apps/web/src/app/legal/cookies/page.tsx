"use client";

import InfoPage, { Section } from "@/components/InfoPage";

export default function CookiesPage() {
  return (
    <InfoPage title="Cookie Policy" subtitle="Last updated: 30 June 2026">
      <Section>
        <p>
          This Cookie Policy explains how CheqPay uses cookies and similar technologies to
          recognise you when you use our app and website.
        </p>
      </Section>

      <Section heading="1. What are cookies?">
        <p>
          Cookies are small data files stored on your device. They help apps remember your
          preferences and keep you securely signed in.
        </p>
      </Section>

      <Section heading="2. How we use cookies">
        <ul className="list-disc space-y-1 pl-5">
          <li>Essential: to authenticate you and keep your session secure.</li>
          <li>Preferences: to remember settings such as display options.</li>
          <li>Analytics: to understand how the app is used so we can improve it.</li>
        </ul>
      </Section>

      <Section heading="3. Managing cookies">
        <p>
          You can control or delete cookies through your browser or device settings.
          Disabling essential cookies may affect your ability to sign in and transact.
        </p>
      </Section>

      <Section heading="4. Contact">
        <p>Questions about cookies? Email support@cheqpay.com.</p>
      </Section>

      <p className="mt-8 text-xs text-muted">
        This document is a general template and should be reviewed by qualified legal
        counsel before relying on it in production.
      </p>
    </InfoPage>
  );
}
