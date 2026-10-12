import type { Metadata } from "next";
import DocsFrame from "@/components/DocsFrame";
import PlansTable from "@/components/PlansTable";

export const metadata: Metadata = { title: "Pricing", description: "CheqPay API plans: free sandbox, then a monthly plan for live access." };

export default function Pricing() {
  return (
    <DocsFrame groups={[]}>
      <div className="appear max-w-4xl">
        <h1 className="title-lg">Pricing</h1>
        <p className="subhead mt-2 text-[17px]">The sandbox is free. Live access needs a verified business and a monthly plan, paid from your main NGN wallet.</p>
        <PlansTable />
      </div>
    </DocsFrame>
  );
}
