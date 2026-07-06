"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

export default function WithdrawDonePage() {
  const router = useRouter();
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("amount");
    setAmount(raw ? Number(raw.replace(/\D/g, "")) : 0);
  }, []);

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col items-center bg-surface px-5 pb-10 pt-4">
        <div className="mt-24 flex flex-col items-center text-center">
          <CheckCircle2 className="h-20 w-20 text-green-400" />
          <h1 className="mt-6 text-2xl font-extrabold text-ink">Withdrawal on the way</h1>
          <p className="mt-2 text-sm text-muted">
            {amount > 0 ? (
              <>
                Your payout of{" "}
                <span className="font-bold text-ink">₦{amount.toLocaleString("en-NG")}</span> is
                processing. It usually lands in seconds.
              </>
            ) : (
              "Your payout is processing. It usually lands in seconds."
            )}
          </p>
        </div>

        <div className="mt-auto w-full pt-6">
          <button
            onClick={() => router.replace("/")}
            className="w-full rounded-2xl bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
