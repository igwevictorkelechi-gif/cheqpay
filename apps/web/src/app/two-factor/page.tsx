"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, ShieldCheck, Copy, Loader2 } from "lucide-react";
import { supabase } from "@/services/supabase";

type Mode = "loading" | "disabled" | "enrolling" | "enabled";

export default function TwoFactorPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.[0];
    setMode(verified ? "enabled" : "disabled");
    setFactorId(verified?.id ?? null);
  };

  useEffect(() => {
    refresh().catch(() => setMode("disabled"));
  }, []);

  const startEnroll = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data: list } = await supabase.auth.mfa.listFactors();
      const stale = list?.all?.find((f) => f.factor_type === "totp" && f.status === "unverified");
      if (stale) await supabase.auth.mfa.unenroll({ factorId: stale.id });

      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error || !data) throw error;
      setFactorId(data.id);
      setSecret(data.totp.secret);
      setUri(data.totp.uri);
      setMode("enrolling");
    } catch {
      setError("Could not start setup. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!factorId || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
      if (cErr || !challenge) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (vErr) throw vErr;
      setCode("");
      await refresh();
    } catch {
      setError("That code didn’t match. Try the current one from your app.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!factorId) return;
    if (!window.confirm("Turn off 2FA? Your account will be less protected.")) return;
    setBusy(true);
    try {
      await supabase.auth.mfa.unenroll({ factorId });
      await refresh();
    } finally {
      setBusy(false);
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

        <h1 className="mb-2 mt-6 text-4xl font-extrabold text-ink">2-step authentication</h1>
        <p className="mb-6 text-base text-muted">
          Use an authenticator app like Google Authenticator for an extra layer of security.
        </p>

        {mode === "loading" && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        )}

        {mode === "enabled" && (
          <>
            <div className="flex items-center rounded-3xl bg-card p-5">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500/15">
                <ShieldCheck className="h-6 w-6 text-green-400" />
              </span>
              <div className="ml-4 flex-1">
                <p className="text-lg font-bold text-ink">2FA is on</p>
                <p className="mt-0.5 text-sm text-muted">Codes required at sign-in</p>
              </div>
            </div>
            <button
              onClick={disable}
              disabled={busy}
              className="mt-6 w-full rounded-full border border-red-500 bg-card py-4 text-base font-bold text-red-500"
            >
              {busy ? "…" : "Turn off 2FA"}
            </button>
          </>
        )}

        {mode === "disabled" && (
          <button
            onClick={startEnroll}
            disabled={busy}
            className="w-full rounded-full bg-brand py-4 text-base font-bold text-white"
          >
            {busy ? "…" : "Set up 2FA"}
          </button>
        )}

        {mode === "enrolling" && (
          <>
            <p className="mb-3 text-base font-semibold text-ink">1. Scan this in your authenticator app</p>
            <div className="mb-4 flex justify-center rounded-3xl bg-white p-6">
              {!!uri && <QRCodeSVG value={uri} size={200} />}
            </div>

            <p className="mb-2 text-sm text-muted">Or enter this key manually:</p>
            <button
              onClick={() => navigator.clipboard?.writeText(secret)}
              className="mb-6 flex w-full items-center justify-between rounded-2xl bg-card px-4 py-3"
            >
              <span className="truncate font-mono text-base text-ink">{secret}</span>
              <Copy className="h-4 w-4 shrink-0 text-muted" />
            </button>

            <p className="mb-3 text-base font-semibold text-ink">2. Enter the 6-digit code</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              placeholder="000000"
              className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-center text-2xl tracking-[0.5em] text-ink outline-none placeholder:text-muted"
            />

            <button
              onClick={verify}
              disabled={busy || code.length !== 6}
              className="mt-6 w-full rounded-full py-4 text-base font-bold text-white disabled:cursor-not-allowed"
              style={{ backgroundColor: code.length === 6 && !busy ? "#6B5B95" : "#2C2738" }}
            >
              {busy ? "…" : "Verify & enable"}
            </button>
          </>
        )}

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
