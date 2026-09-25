"use client";

import InfoPage, { Section } from "@/components/InfoPage";
import { DocLink, Mail, OperatorLine, Table } from "@/components/LegalBits";
import {
  COMPANY,
  COMPLAINTS,
  DISPUTE_REPORT_DAYS,
  GADGET_RETURN_DAYS,
  LEGAL_EFFECTIVE_DATE,
  PRIMARY_PARTNER,
  TERMS_CHANGE_NOTICE_DAYS,
  TIER_LIMITS,
  naira,
} from "@/lib/legal";

export default function TermsPage() {
  return (
    <InfoPage title="Terms of Service" subtitle={`Effective ${LEGAL_EFFECTIVE_DATE}`}>
      <Section>
        <p>
          These Terms of Service (the &quot;Terms&quot;) are an agreement between you and CheqPay. They govern your
          use of the CheqPay mobile app, the website at {COMPANY.website} and every service offered through them
          (together, the &quot;Services&quot;). By creating an account or using the Services you accept these Terms,
          our <DocLink href="/privacy">Privacy Policy</DocLink>, our{" "}
          <DocLink href="/legal/acceptable-use">Acceptable Use Policy</DocLink> and our{" "}
          <DocLink href="/legal/aml">AML &amp; KYC Policy</DocLink>. If you do not agree, do not use the Services.
        </p>
        <OperatorLine />
      </Section>

      <Section heading="1. Who provides your services">
        <p>
          CheqPay is a technology platform. We are <strong>not a bank</strong>. The regulated parts of the
          Services — holding your money, issuing your virtual account and cards, sending bank payouts, paying
          bills and holding supported digital assets — are provided by {PRIMARY_PARTNER.name}, {PRIMARY_PARTNER.role}
          , and by the banks and billers it works with. When you use those features you also deal with that
          partner, and its terms may apply alongside these.
        </p>
        <p>
          <strong>
            Your CheqPay balance is not a bank deposit and is not insured by the Nigeria Deposit Insurance
            Corporation (NDIC).
          </strong>
        </p>
      </Section>

      <Section heading="2. Eligibility">
        <ul className="list-disc space-y-1 pl-5">
          <li>You must be at least 18 years old and legally able to enter a binding contract.</li>
          <li>You must be a resident of Nigeria, or hold a valid Bank Verification Number (BVN) and Nigerian identity document.</li>
          <li>You may hold only one CheqPay account, in your own name, for your own use.</li>
          <li>
            You must not be subject to sanctions, or acting for someone who is, and must not be barred from using
            financial services under Nigerian law.
          </li>
        </ul>
      </Section>

      <Section heading="3. Your account and security">
        <p>
          Your account is personal to you. You are responsible for keeping your sign-in codes, transaction PIN,
          device and email account secure, and for everything done with them. Never share a one-time code or
          your PIN with anyone — CheqPay staff will never ask for them.
        </p>
        <p>
          Anything confirmed with your transaction PIN, a one-time code or your device&apos;s biometrics is treated
          as authorised by you. If you turn on <em>Instant withdrawal</em>, crypto withdrawals skip the extra
          two-step check; you accept that this reduces your protection.
        </p>
        <p>
          If you think someone else has access to your account, tell us at once at{" "}
          <Mail to={COMPANY.supportEmail} /> so we can lock it.
        </p>
      </Section>

      <Section heading="4. Identity verification and limits">
        <p>
          The law requires us to verify who you are before you can move money. We collect and check your details
          as set out in the <DocLink href="/legal/aml">AML &amp; KYC Policy</DocLink>. The more we have verified,
          the higher your limits:
        </p>
        <Table
          head={["Level", "What we verify", "Per transaction", "Daily deposits", "Daily withdrawals"]}
          rows={TIER_LIMITS.map((t) => [
            `Tier ${t.tier}`,
            t.requires,
            naira(t.singleTx),
            naira(t.dailyDeposit),
            naira(t.dailyWithdrawal),
          ])}
        />
        <p>
          Accounts that have not completed verification cannot send, withdraw or pay. We may ask for more
          information at any time, and may change limits to meet our legal and risk obligations. The limits shown
          in the app are the ones that apply to you.
        </p>
      </Section>

      <Section heading="5. The services">
        <p>
          <strong>Naira wallet.</strong> You can fund your wallet by transfer to your CheqPay virtual account and
          withdraw to a Nigerian bank account in your name. Check the account details before you confirm: a
          payout sent to the details you entered cannot always be recovered.
        </p>
        <p>
          <strong>Transfers to other CheqPay users.</strong> Payments to another user&apos;s username are instant
          and final once completed. Only pay people you know and trust.
        </p>
        <p>
          <strong>Bill payments.</strong> Bill payments — such as airtime, data, electricity and cable TV — are
          delivered by the biller. Check the phone number, meter or smartcard number before paying — we cannot
          reverse a payment made to the wrong details. If a bill payment fails, we refund it to your wallet.
        </p>
        <p>
          <strong>US dollar account and virtual cards.</strong> These are issued through our partner and need
          extra verification. Card payments are also subject to the card network&apos;s rules and the
          merchant&apos;s own terms.
        </p>
        <p>
          <strong>Conversions and digital assets.</strong> You can convert between supported currencies at the
          rate shown before you confirm. You can receive supported stablecoins to your personal deposit address;
          on some networks a stablecoin deposit is credited to your balance as US dollars — the app tells you
          which before you send. Digital-asset withdrawals are available only on the networks the app offers.
          Read section 8 before using these features.
        </p>
        <p>
          <strong>Gadget store.</strong> When you buy a gadget, you are buying it from us for delivery to the
          address you give. Delivery times shown are estimates. If an item arrives faulty or is not as described,
          tell us within {GADGET_RETURN_DAYS} days of delivery and we will repair, replace or refund it. This does
          not limit your rights under the Federal Competition and Consumer Protection Act 2018.
        </p>
        <p>
          <strong>Event tickets.</strong> Ticket sales are final. Each ticket carries a unique reference and QR
          code, is valid for one entry, and may be refused if it has already been used. If an event is cancelled,
          we refund your ticket price to your CheqPay balance; if it is postponed, your ticket stays valid for the
          new date or you can ask us for a refund before it takes place.
        </p>
        <p>
          <strong>Cashback and promotions.</strong> Cashback and rewards are discretionary, may change or end at
          any time, and may be taken back if the transaction that earned them is reversed or the reward was
          obtained by abuse.
        </p>
      </Section>

      <Section heading="6. Fees and rates">
        <p>
          Any fee, exchange rate or spread is shown before you confirm a transaction. By confirming, you accept
          the amounts shown. Quoted rates are valid only for the short time displayed; after that we show a new
          quote. Your bank, mobile network or the blockchain network may charge their own fees.
        </p>
      </Section>

      <Section heading="7. Errors, reversals and disputes">
        <p>
          Tell us within {DISPUTE_REPORT_DAYS} days if you see a transaction you did not authorise or one that went
          wrong. We will investigate and keep you informed.
        </p>
        <p>
          If money is credited to your account by mistake — by us, a partner or another person — it is not yours.
          You agree that we may reverse the credit, and that if you have already spent or moved it you must repay
          it. We will tell you when we do this.
        </p>
      </Section>

      <Section heading="8. Digital-asset risks">
        <ul className="list-disc space-y-1 pl-5">
          <li>Digital assets, including stablecoins, are not legal tender in Nigeria and are not protected by the NDIC or the Central Bank of Nigeria.</li>
          <li>Their value can change quickly, and a stablecoin can lose its peg.</li>
          <li>
            Blockchain transfers are irreversible. Assets sent to the wrong address or on the wrong network — for
            example opBNB instead of BNB Smart Chain — may be lost permanently. Always check the address and the
            network shown in the app.
          </li>
          <li>
            The law on digital assets in Nigeria is changing. We may have to limit, suspend or withdraw these
            features to comply with regulators, including the Securities and Exchange Commission.
          </li>
        </ul>
      </Section>

      <Section heading="9. Holds, suspension and closure">
        <p>
          To protect you and meet our legal duties, we may delay or hold a transaction for review, freeze funds,
          or suspend or close an account — for example if we suspect fraud, money laundering, a breach of these
          Terms, or if a regulator or court requires it. Where the law allows, we will tell you why. We may be
          required to report activity to the Nigerian Financial Intelligence Unit or other authorities, and the
          law may prevent us from telling you that we have.
        </p>
        <p>
          You can close your account at any time from the app. You must first withdraw your balance and wait for
          pending transactions to settle. We keep certain records after closure as the law requires (see the{" "}
          <DocLink href="/privacy">Privacy Policy</DocLink>).
        </p>
      </Section>

      <Section heading="10. Acceptable use">
        <p>
          You must follow our <DocLink href="/legal/acceptable-use">Acceptable Use Policy</DocLink>. Breaking it
          can lead to transactions being reversed, your account and the devices and networks you use being blocked,
          and a report to the authorities.
        </p>
      </Section>

      <Section heading="11. The app and our content">
        <p>
          We grant you a personal, non-transferable licence to use the CheqPay app for yourself. You may not copy,
          modify, reverse-engineer or resell it. CheqPay&apos;s name, logos and content belong to us.
        </p>
        <p>
          The Services depend on partners, banks, billers and networks we do not control. We work to keep the
          Services available but cannot promise they will be uninterrupted or error-free.
        </p>
      </Section>

      <Section heading="12. Our responsibility to you">
        <p>
          We are responsible for losses caused by our own negligence or breach of these Terms. We are not
          responsible for losses you could not reasonably have expected, losses caused by your own error (such as
          wrong account, meter or wallet details), losses from market movements in digital assets, or events
          beyond our reasonable control.
        </p>
        <p>
          Nothing in these Terms limits liability that cannot be limited by law, including liability for fraud,
          or your rights as a consumer under the Federal Competition and Consumer Protection Act 2018.
        </p>
      </Section>

      <Section heading="13. Complaints">
        <p>
          Email <Mail to={COMPANY.supportEmail} /> or use in-app support. We will acknowledge your complaint within{" "}
          {COMPLAINTS.acknowledgeWithinBusinessDays} business day and aim to resolve it within{" "}
          {COMPLAINTS.resolveWithinDays} days. If you are not satisfied with our response, you may refer the
          matter to the Federal Competition and Consumer Protection Commission (FCCPC), or, for how we handle your
          personal data, to the Nigeria Data Protection Commission (NDPC).
        </p>
      </Section>

      <Section heading="14. Changes to these Terms">
        <p>
          We may update these Terms. We will tell you in the app or by email at least{" "}
          {TERMS_CHANGE_NOTICE_DAYS} days before a change that affects you adversely takes effect, unless the law
          or a regulator requires us to act sooner. If you do not agree to a change, you can close your account
          before it takes effect.
        </p>
      </Section>

      <Section heading="15. Law and disputes">
        <p>
          These Terms are governed by the laws of the Federal Republic of Nigeria. We will first try to settle any
          dispute through our complaints process. If that does not work, the courts of Nigeria have jurisdiction.
          These Terms are written in English.
        </p>
      </Section>
    </InfoPage>
  );
}
