"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Clock, Loader2, Plus, Trash2, XCircle } from "lucide-react";
import Logo from "@/components/Logo";
import { api, ApiError, type Application, type Social } from "@/lib/api";
import { useSession } from "@/lib/useSession";

const PLATFORMS = ["Instagram", "TikTok", "X (Twitter)", "YouTube", "Facebook", "Snapchat", "Other"];

export default function ApplyPage() {
  const session = useSession();
  const router = useRouter();
  const [app, setApp] = useState<Application | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ fullName: "", phone: "", niche: "", location: "", why: "", preferredCode: "" });
  const [socials, setSocials] = useState<Social[]>([{ platform: "Instagram", handle: "", followers: 0 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session === undefined) return;
    if (session === null) {
      router.replace("/login?next=/apply");
      return;
    }
    api
      .application()
      .then((r) => {
        if (r.isInfluencer) return router.replace("/dashboard");
        setApp(r.application);
        const name = (session.user.user_metadata?.full_name as string | undefined) ?? "";
        if (r.application) {
          const a = r.application;
          setForm({ fullName: a.fullName, phone: a.phone, niche: a.niche, location: a.location, why: a.why, preferredCode: a.preferredCode ?? "" });
          setSocials(a.socials.length ? a.socials : socials);
        } else setForm((f) => ({ ...f, fullName: name }));
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "Couldn't load your application.");
        setApp(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.apply({ ...form, preferredCode: form.preferredCode || undefined, socials: socials.filter((s) => s.handle.trim()) });
      setApp(r.application);
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send your application.");
    } finally {
      setBusy(false);
    }
  }

  const status = app && !editing ? app.status : null;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16">
      <header className="flex items-center justify-between py-5"><Logo /></header>
      {app === undefined ? (
        <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : status === "PENDING" ? (
        <div className="card mt-6 text-center">
          <Clock className="mx-auto h-12 w-12 text-gold" />
          <h1 className="mt-4 text-2xl font-extrabold">Application received</h1>
          <p className="mt-2 text-muted">We&apos;re reviewing it and will notify you in the CheqPay app and by email.</p>
        </div>
      ) : status === "APPROVED" ? (
        <div className="card mt-6 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
          <h1 className="mt-4 text-2xl font-extrabold">You&apos;re in!</h1>
          <Link href="/dashboard" className="btn mt-6">Open your dashboard</Link>
        </div>
      ) : status === "REJECTED" ? (
        <div className="card mt-6 text-center">
          <XCircle className="mx-auto h-12 w-12 text-red-400" />
          <h1 className="mt-4 text-2xl font-extrabold">Not this time</h1>
          {app?.reason && <p className="mt-2 text-muted">{app.reason}</p>}
          <button onClick={() => setEditing(true)} className="btn mt-6">Update and re-apply</button>
        </div>
      ) : (
        <form onSubmit={submit} className="card mt-2 space-y-4">
          <div>
            <h1 className="text-2xl font-extrabold">Apply to the influencer program</h1>
            <p className="mt-1 text-sm text-muted">Tell us about you and your audience. We review every application.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label">Full name</label><input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></div>
            <div><label className="label">Phone</label><input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></div>
          </div>
          <div>
            <label className="label">Your social accounts</label>
            <div className="space-y-2">
              {socials.map((s, i) => (
                <div key={i} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[1fr_1.4fr_1fr_auto]">
                  <select className="input !px-3" value={s.platform} onChange={(e) => setSocials(socials.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x)))}>
                    {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
                  </select>
                  <input className="input" placeholder="@handle or link" value={s.handle} onChange={(e) => setSocials(socials.map((x, j) => (j === i ? { ...x, handle: e.target.value } : x)))} />
                  <div className="col-span-2 flex gap-2 sm:contents">
                    <input className="input min-w-0 flex-1" inputMode="numeric" placeholder="Followers" value={s.followers || ""} onChange={(e) => setSocials(socials.map((x, j) => (j === i ? { ...x, followers: Number(e.target.value.replace(/\D/g, "")) || 0 } : x)))} />
                    <button type="button" onClick={() => setSocials(socials.filter((_, j) => j !== i))} disabled={socials.length === 1} className="flex w-11 shrink-0 items-center justify-center rounded-2xl border border-border text-muted disabled:opacity-30" aria-label="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {socials.length < 8 && (
              <button type="button" onClick={() => setSocials([...socials, { platform: "TikTok", handle: "", followers: 0 }])} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-light">
                <Plus className="h-4 w-4" /> Add another
              </button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label">Niche</label><input className="input" placeholder="Tech, finance, lifestyle…" value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })} /></div>
            <div><label className="label">City / country</label><input className="input" placeholder="Lagos, Nigeria" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
          </div>
          <div>
            <label className="label">Why CheqPay? How would you promote it?</label>
            <textarea className="input" rows={3} value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} />
          </div>
          <div>
            <label className="label">Code you&apos;d like (optional)</label>
            <input className="input font-mono uppercase" placeholder="e.g. TOLU10" value={form.preferredCode} onChange={(e) => setForm({ ...form, preferredCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16) })} />
          </div>
          {error && <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={busy} className="btn w-full !py-4">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send application"}</button>
        </form>
      )}
    </div>
  );
}
