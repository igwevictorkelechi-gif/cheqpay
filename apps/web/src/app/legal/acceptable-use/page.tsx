"use client";

import InfoPage, { Section } from "@/components/InfoPage";
import { DocLink, Mail } from "@/components/LegalBits";
import { COMPANY, LEGAL_EFFECTIVE_DATE } from "@/lib/legal";

export default function AcceptableUsePage() {
  return (
    <InfoPage title="Acceptable Use Policy" subtitle={`Effective ${LEGAL_EFFECTIVE_DATE}`}>
      <Section>
        <p>
          This policy sets out what you may not do with CheqPay. It forms part of our{" "}
          <DocLink href="/terms">Terms of Service</DocLink>. It exists to keep your money, other customers and the
          platform safe, and to keep us within the law.
        </p>
      </Section>

      <Section heading="1. Illegal and harmful activity">
        <p>You must not use CheqPay to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>launder money, finance terrorism, evade sanctions, or handle the proceeds of any crime;</li>
          <li>
            run or pay into fraud and scams — including advance-fee (&quot;419&quot;), romance, investment, Ponzi and
            &quot;double your money&quot; schemes, and fake sellers;
          </li>
          <li>buy or sell anything illegal in Nigeria, including drugs, weapons, counterfeit goods and stolen property;</li>
          <li>pay for unlicensed gambling, or for gambling by anyone under 18;</li>
          <li>evade tax, currency or reporting rules, including by splitting payments to stay under limits.</li>
        </ul>
      </Section>

      <Section heading="2. Your identity and your account">
        <ul className="list-disc space-y-1 pl-5">
          <li>Do not open or use an account in someone else&apos;s name, or with another person&apos;s BVN or ID.</li>
          <li>
            Do not let anyone else use your account, and do not receive or move money for other people in exchange
            for payment — this is acting as a &quot;money mule&quot; and is a crime.
          </li>
          <li>Do not hold more than one account, or open a new one after we have blocked or closed yours.</li>
          <li>Do not give false or misleading information, or use forged documents.</li>
        </ul>
      </Section>

      <Section heading="3. Abusing the service">
        <ul className="list-disc space-y-1 pl-5">
          <li>Do not exploit errors, pricing mistakes or bugs for gain, or keep money credited to you by mistake.</li>
          <li>Do not abuse cashback, referrals, discount codes or promotions, including through multiple or fake accounts.</li>
          <li>Do not make false disputes or chargebacks.</li>
          <li>Do not buy gadgets or event tickets using stolen funds or another person&apos;s account.</li>
        </ul>
      </Section>

      <Section heading="4. Security and testing">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Do not try to access any account, data or system you are not authorised to use, including the CheqPay
            admin systems.
          </li>
          <li>Do not probe, scan or test the security of CheqPay, or run automated tools or bots against it.</li>
          <li>Do not interfere with or overload the service, or copy, scrape or reverse-engineer it.</li>
        </ul>
        <p>
          <strong>
            Security testing is authorised only when CheqPay has agreed to it in writing, in advance. Describing
            your activity as a &quot;test&quot;, &quot;pentest&quot; or research does not authorise it.
          </strong>{" "}
          If you find a vulnerability, report it to <Mail to={COMPANY.securityEmail} /> without using it, accessing
          other people&apos;s data or moving any money. We will not pursue good-faith reports made this way.
        </p>
      </Section>

      <Section heading="5. How you treat others">
        <p>
          Do not harass, threaten or abuse other customers or CheqPay staff, or use your username, messages or
          payment references to do so.
        </p>
      </Section>

      <Section heading="6. What happens if you break this policy">
        <p>We may, depending on how serious the breach is:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>refuse, hold or reverse transactions, and freeze funds;</li>
          <li>take back cashback, rewards or money credited by mistake;</li>
          <li>block your account, and the devices, networks and identity details linked to it, so you cannot return;</li>
          <li>recover any loss you have caused us from your balance or through the courts;</li>
          <li>report you to the Nigerian Financial Intelligence Unit, the police or other authorities.</li>
        </ul>
      </Section>

      <Section heading="7. Reporting misuse">
        <p>
          If you think someone is misusing CheqPay, or you have been scammed, contact{" "}
          <Mail to={COMPANY.supportEmail} /> as soon as possible.
        </p>
      </Section>
    </InfoPage>
  );
}
