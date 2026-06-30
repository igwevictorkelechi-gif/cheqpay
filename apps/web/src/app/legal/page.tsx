"use client";

import { useRouter } from "next/navigation";
import InfoPage, { LinkRow } from "@/components/InfoPage";

export default function LegalHubPage() {
  const router = useRouter();
  return (
    <InfoPage title="Legal & policies" subtitle="The documents that govern your use of CheqPay.">
      <div className="space-y-3">
        <LinkRow
          emoji="🔒"
          title="Privacy Policy"
          subtitle="How we collect and use your data"
          onClick={() => router.push("/privacy")}
        />
        <LinkRow
          emoji="📜"
          title="Terms of Service"
          subtitle="The rules for using CheqPay"
          onClick={() => router.push("/terms")}
        />
        <LinkRow
          emoji="🛡️"
          title="AML & KYC Policy"
          subtitle="Anti-money-laundering commitments"
          onClick={() => router.push("/legal/aml")}
        />
        <LinkRow
          emoji="🍪"
          title="Cookie Policy"
          subtitle="How we use cookies"
          onClick={() => router.push("/legal/cookies")}
        />
      </div>
    </InfoPage>
  );
}
