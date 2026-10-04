"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import Logo from "@/components/Logo";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (error) {
      setError(error.message === "Invalid login credentials" ? "That email and password don't match a CheqPay account." : error.message);
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4">
      <header className="py-5"><Logo /></header>
      <div className="card my-auto">
        <h1 className="text-2xl font-extrabold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Use your CheqPay account.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={busy || !email || !password} className="btn w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
          </button>
        </form>
        <div className="mt-5 flex justify-between text-sm">
          <a href="https://mycheqpay.com/login/" className="text-muted hover:text-ink">Forgot password?</a>
          <a href="https://mycheqpay.com/signup/" className="font-semibold text-brand-light">Create an account</a>
        </div>
      </div>
    </div>
  );
}
