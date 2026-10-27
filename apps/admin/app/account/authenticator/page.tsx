"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import DashboardLayout from "@/components/DashboardLayout";
import { CheckCircle2, Loader2, ShieldCheck, Smartphone } from "lucide-react";

// A sub admin's own authenticator. Approving anything that moves money (a gift
// card payout, say) asks for a code from it, and once it's set up, so does
// signing in. It's theirs alone: the owner's authenticator is never shared.
export default function AccountAuthenticatorPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [enrolled, setEnrolled] = useState(false);
  const [setupUrl, setSetupUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (d.role === "super") {
          router.replace("/adjust-balance");
          return;
        }
        return fetch("/api/account/otp", { cache: "no-store" })
          .then((r) => r.json())
          .then((o) => setEnrolled(!!o.enrolled));
      })
      .catch(() => setError("Could not check your authenticator. Refresh to try again."))
      .finally(() => setLoading(false));
  }, [router]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/account/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "setup" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not start the setup.");
      setSetupUrl(d.otpauthUrl);
      setSecret(d.secret);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/account/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "activate", code: code.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "That code didn’t match.");
      setEnrolled(true);
      setDone(true);
      setSetupUrl(null);
      setSecret("");
      setCode("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Authenticator</h1>
            <p className="text-sm text-gray-500">Your own codes for approvals and sign-in</p>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          ) : enrolled ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                <CheckCircle2 size={16} />
                {done ? "Authenticator set up. You’ll be asked for a code when you sign in." : "Your authenticator is set up."}
              </div>
              <p className="text-sm text-gray-600">
                When you approve something that moves money, enter the 6-digit code it shows. Lost your phone? Ask a
                Super Admin to reset your authenticator (Roles &amp; Access), then set it up again here.
              </p>
            </div>
          ) : !setupUrl ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Approving gift cards, withdrawals and other money actions needs a code from an authenticator app on your
                phone (Google Authenticator, Authy, 1Password). Set yours up once; it’s yours alone.
              </p>
              <button
                onClick={start}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone size={16} />} Set up authenticator
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-gray-700">1. Scan this QR in your authenticator app</p>
              {/* Real white (not the themed bg-white token) so the QR scans. */}
              <div className="inline-block rounded-lg p-3" style={{ background: "#ffffff" }}>
                <QRCodeSVG value={setupUrl} size={180} bgColor="#ffffff" fgColor="#000000" />
              </div>
              <p className="text-xs text-gray-500">
                Can’t scan? Enter this key instead: <span className="break-all font-mono text-gray-800">{secret}</span>
              </p>
              <p className="text-sm font-semibold text-gray-700">2. Enter the 6-digit code it shows</p>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  onClick={activate}
                  disabled={busy || code.length !== 6}
                  className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
                </button>
              </div>
            </div>
          )}

          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>
      </div>
    </DashboardLayout>
  );
}
