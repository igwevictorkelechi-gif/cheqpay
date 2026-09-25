"use client";

import InfoPage, { Section } from "@/components/InfoPage";
import { DocLink, Mail, Table } from "@/components/LegalBits";
import { COMPANY, LEGAL_EFFECTIVE_DATE, PRIMARY_PARTNER, RECORD_RETENTION_YEARS, TIER_LIMITS, naira } from "@/lib/legal";

export default function AmlPage() {
  return (
    <InfoPage title="AML & KYC Policy" subtitle={`Effective ${LEGAL_EFFECTIVE_DATE}`}>
      <Section>
        <p>
          CheqPay is committed to preventing money laundering, terrorist financing and fraud. This policy
          summarises the controls we apply under the Money Laundering (Prevention and Prohibition) Act 2022, the
          Terrorism (Prevention and Prohibition) Act 2022 and the related regulations, together with our licensed
          partner, {PRIMARY_PARTNER.name}.
        </p>
      </Section>

      <Section heading="1. Knowing our customers">
        <p>Before you can move money, we verify who you are. We check:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>your legal name, date of birth and address;</li>
          <li>your Bank Verification Number (BVN);</li>
          <li>
            a government-issued ID — National Identification Number (NIN) slip, international passport, voter&apos;s
            card or driver&apos;s licence — with photos of the front and back.
          </li>
        </ul>
        <p>
          These details are checked against official records through {PRIMARY_PARTNER.name}. What you can do depends
          on how much has been verified:
        </p>
        <Table
          head={["Level", "Verified", "Per transaction", "Daily withdrawals"]}
          rows={TIER_LIMITS.map((t) => [`Tier ${t.tier}`, t.requires, naira(t.singleTx), naira(t.dailyWithdrawal)])}
        />
        <p>
          Tier 3 is granted only after enhanced due diligence by our compliance team, which may include asking
          about your source of funds and whether you hold, or are close to someone who holds, a prominent public
          position. We may ask any customer for more information at any time.
        </p>
      </Section>

      <Section heading="2. One person, one account">
        <p>
          Each person may hold one account, in their own name. An account whose BVN or phone number matches a
          blocked account is blocked too, so a closed account cannot simply be reopened under a new email.
        </p>
      </Section>

      <Section heading="3. Monitoring transactions">
        <p>
          Every transaction is checked against the account&apos;s limits as it happens. Digital-asset withdrawals
          are also checked against their size and how much and how often the account has transacted recently;
          those that cross our thresholds are held and reviewed by a person before they are released or refused.
          We may hold any transaction for review if something suggests risk.
        </p>
      </Section>

      <Section heading="4. Digital assets">
        <ul className="list-disc space-y-1 pl-5">
          <li>Each customer receives their own deposit address, so every incoming transfer is linked to a verified person.</li>
          <li>Only the official contracts of supported stablecoins are credited; look-alike tokens are ignored.</li>
          <li>Withdrawals to addresses on the sanctions lists we maintain are refused.</li>
        </ul>
      </Section>

      <Section heading="5. Sanctions">
        <p>
          We do not provide services to people or organisations under sanctions, or to anyone acting for them.
        </p>
      </Section>

      <Section heading="6. Controls on our own staff">
        <p>
          Staff actions that move money or raise a customer&apos;s limits need a fresh second-factor code, are
          capped, and are logged against the person who performed them. A customer&apos;s verification level can
          be raised only when their identity is on file.
        </p>
      </Section>

      <Section heading="7. Reporting">
        <p>
          Suspicious activity is reported to the Nigerian Financial Intelligence Unit (NFIU), directly or through
          our licensed partner, and to other authorities where the law requires. The law may prevent us from
          telling a customer that a report has been made. We may freeze funds, block accounts, devices and networks,
          and cooperate with law-enforcement requests.
        </p>
      </Section>

      <Section heading="8. Keeping records">
        <p>
          We keep identity, verification and transaction records for at least {RECORD_RETENTION_YEARS} years after
          an account is closed, as the Money Laundering (Prevention and Prohibition) Act 2022 requires. See the{" "}
          <DocLink href="/privacy">Privacy Policy</DocLink> for how we protect them.
        </p>
      </Section>

      <Section heading="9. Questions">
        <p>
          Contact <Mail to={COMPANY.supportEmail} />.
        </p>
      </Section>
    </InfoPage>
  );
}
