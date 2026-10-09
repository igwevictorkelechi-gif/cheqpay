"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { startCheqPaySignIn } from "@/lib/cheqpaySignIn";
import { supabase } from "@/lib/supabase";

/** Apply: straight to the application when signed in, otherwise via CheqPay sign-in (which can also create the account). */
export default function ApplyButton({ className = "btn", children }: { className?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const { data } = await supabase.auth.getSession();
        if (data.session) return router.push("/apply");
        await startCheqPaySignIn("/apply").catch(() => {
          setBusy(false);
          router.push("/login?next=/apply");
        });
      }}
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : children}
    </button>
  );
}
