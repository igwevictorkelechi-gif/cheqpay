"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2, XCircle, Loader2 } from "lucide-react";
import { useAuthStore } from "@/store";
import { authService } from "@/services/auth";
import { api, ApiError } from "@/services/api";

const consequences = [
  "Your wallets, balances and transaction history are erased",
  "Your virtual account and any crypto addresses are closed",
  "This cannot be undone — you’ll need to sign up again",
];

export default function DeleteAccountPage() {
  const router = useRouter();
  const { logout } = useAuthStore();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirm.trim().toUpperCase() === "DELETE" && !busy;

  const doDelete = async () => {
    if (!canDelete) return;
    if (!window.confirm("This permanently deletes your CheqPay account and all its data. Continue?")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      try {
        await authService.logout();
      } catch {
        /* ignore — account is already gone */
      }
      logout();
      router.push("/login");
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.status === 409) {
        setError("You still have funds in your wallet. Withdraw everything before deleting your account.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    }
  };

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-3">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <span className="mt-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-red-500/15">
          <Trash2 className="h-7 w-7 text-red-500" />
        </span>

        <h1 className="mb-2 mt-5 text-4xl font-extrabold text-ink">Delete account</h1>
        <p className="mb-6 text-base text-muted">
          We’re sorry to see you go. Deleting your account is permanent.
        </p>

        <div className="space-y-3.5 rounded-3xl bg-card p-5">
          {consequences.map((c) => (
            <div key={c} className="flex items-start gap-3">
              <XCircle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-red-500" />
              <p className="text-sm text-ink">{c}</p>
            </div>
          ))}
        </div>

        <p className="mb-2 mt-6 text-sm text-muted">
          Type <span className="font-bold text-ink">DELETE</span> to confirm
        </p>
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="DELETE"
          className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-base text-ink outline-none placeholder:text-muted"
        />

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button
          onClick={doDelete}
          disabled={!canDelete}
          className="mt-6 flex w-full items-center justify-center rounded-full py-4 text-base font-bold text-white disabled:cursor-not-allowed"
          style={{ backgroundColor: canDelete ? "#EF4444" : "#2C2738" }}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Permanently delete my account"}
        </button>
      </div>
    </div>
  );
}
