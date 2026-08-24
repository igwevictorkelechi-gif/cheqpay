"use client";

import { useRouter } from "next/navigation";
import InfoPage, { LinkRow, Section } from "@/components/InfoPage";

export default function AboutHubPage() {
  const router = useRouter();
  return (
    <InfoPage title="About CheqPay" subtitle="Everything you need to know about us.">
      {/* This page is public and indexed, so it carries real copy rather than
          only navigation. A page of link rows gives a search engine nothing to
          understand the business by. */}
      <Section>
        <p>
          CheqPay is a Nigerian fintech that brings the money jobs most people juggle
          across several apps into one verified account: a Naira account number of your
          own, transfers to any Nigerian bank, everyday bill payments, and a
          straightforward way to buy and sell Bitcoin and USDT.
        </p>
        <p className="mt-3">
          The idea is simple. Nigerians already move money constantly — to family, to
          traders, to landlords, to a data bundle that ran out mid-call. Doing it well
          should not mean one app for transfers, another for airtime, a third for
          crypto, and a spreadsheet to remember where the money went.
        </p>
      </Section>

      <Section heading="What you can do with a CheqPay account">
        <p>
          <strong>Get your own Naira account number.</strong> Once your identity is
          verified you are issued a dedicated account number. Money sent to it from any
          Nigerian bank arrives in your CheqPay balance — it works exactly like the
          account number you would give anyone else.
        </p>
        <p className="mt-3">
          <strong>Send money to any Nigerian bank.</strong> Enter the account number and
          we confirm the recipient&apos;s name before you part with a kobo, so a
          mistyped digit does not become somebody else&apos;s money. You can also pay
          another CheqPay user instantly with nothing but their username.
        </p>
        <p className="mt-3">
          <strong>Pay the bills you actually have.</strong> Airtime and data on MTN,
          Airtel, Glo and 9mobile, electricity tokens, and cable TV subscriptions —
          topped up in seconds from the same balance.
        </p>
        <p className="mt-3">
          <strong>Buy and sell crypto without leaving.</strong> Move between Naira,
          Bitcoin and USDT at a rate you see quoted before you commit, not one you
          discover afterwards.
        </p>
      </Section>

      <Section heading="How we think about your money">
        <p>
          Every account is identity-verified before it can move money. That is partly
          the law and partly the point: verification is what keeps a payments platform
          usable for the people who are not trying to abuse it.
        </p>
        <p className="mt-3">
          Sign-in is protected by two-factor authentication and an app lock, and your
          account keeps a record of the devices it has been used on, so an unfamiliar
          one is something you can see rather than something you find out about later.
          Transactions are screened before they settle, and sensitive personal data is
          encrypted both in transit and at rest.
        </p>
        <p className="mt-3">
          We are also plain about limits. Crypto transfers are irreversible, exchange
          rates carry a spread, and daily limits depend on your verification tier — all
          of which we would rather tell you here than have you learn from a support
          ticket.
        </p>
      </Section>

      <div className="space-y-3">
        <LinkRow
          emoji="🏢"
          title="Our story"
          subtitle="Who we are and what we stand for"
          onClick={() => router.push("/about/company")}
        />
        <LinkRow
          emoji="❓"
          title="FAQs"
          subtitle="Answers to common questions"
          onClick={() => router.push("/faq")}
        />
        <LinkRow
          emoji="💬"
          title="Help &amp; Support"
          subtitle="Get help with your account"
          onClick={() => router.push("/support")}
        />
        <LinkRow
          emoji="✉️"
          title="Contact us"
          subtitle="Reach our team"
          onClick={() => router.push("/contact")}
        />
        <LinkRow
          emoji="⚖️"
          title="Legal &amp; policies"
          subtitle="Privacy, terms and more"
          onClick={() => router.push("/legal")}
        />
      </div>
    </InfoPage>
  );
}
