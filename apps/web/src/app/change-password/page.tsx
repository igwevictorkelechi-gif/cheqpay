"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/services/supabase";
import { useAuthStore } from "@/store";

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <p className="mb-1 text-xs text-muted">{label}</p>
      <div className="flex items-center">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-base text-ink outline-none"
        />
        <button onClick={() => setShow((s) => !s)} className="text-muted">
          {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = next.length >= 8 && next === confirm && current.length > 0;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      if (user?.email) {
        const { error: reErr } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: current,
        });
        if (reErr) {
          setError("Your current password is incorrect.");
          return;
        }
      }
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      setDone(true);
      setTimeout(() => router.back(), 1200);
    } catch {
      setError("Could not update. Please try again.");
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
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <h1 className="mb-6 mt-6 text-4xl font-extrabold text-ink">Change password</h1>

        <div className="space-y-3.5">
          <Field label="Current password" value={current} onChange={setCurrent} />
          <Field label="New password" value={next} onChange={setNext} />
          <Field label="Confirm new password" value={confirm} onChange={setConfirm} />
        </div>

        {next.length > 0 && next.length < 8 && (
          <p className="mt-3 text-xs text-amber-400">Use at least 8 characters.</p>
        )}
        {confirm.length > 0 && next !== confirm && (
          <p className="mt-3 text-xs text-red-400">Passwords don’t match.</p>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {done && <p className="mt-3 text-sm text-green-400">Password updated.</p>}

        <button
          onClick={submit}
          disabled={!valid || busy}
          className="mt-6 flex w-full items-center justify-center rounded-full py-4 text-base font-bold text-white disabled:cursor-not-allowed"
          style={{ backgroundColor: valid && !busy ? "#6B5B95" : "#2C2738" }}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Update password"}
        </button>
      </div>
    </div>
  );
}
