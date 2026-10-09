"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, ExternalLink, ListChecks, Loader2 } from "lucide-react";
import Shell from "@/components/Shell";
import { api, ApiError, type Task } from "@/lib/api";

function TaskCard({ t, onDone }: { t: Task; onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pct = t.kind === "AUTO" && t.target ? Math.min(100, (Number(t.progress ?? 0) / Number(t.target)) * 100) : 0;
  const sub = t.submission;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.submitProof(t.id, url.trim(), note.trim());
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't submit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      {t.brand && (
        <div className="-mx-1 -mt-1 mb-4 overflow-hidden rounded-2xl bg-circle">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={t.brand.image} alt={t.brand.headline} className="aspect-[1.91/1] w-full object-cover" />
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
            <span className="font-semibold">Paid post for {t.brand.businessName}</span>
            <span className={t.brand.postsLeft > 0 ? "font-semibold text-brand-light" : "text-muted"}>{t.brand.postsLeft > 0 ? `${t.brand.postsLeft} paid post${t.brand.postsLeft === 1 ? "" : "s"} left` : "All posts taken"}</span>
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="headline text-[19px]">{t.title}</p>
          {t.description && <p className="mt-1 whitespace-pre-wrap break-words subhead">{t.description}</p>}
          {t.brand?.linkUrl && (
            <a href={t.brand.linkUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-light">
              Brand link <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-brand/12 px-3 py-1 text-[15px] font-semibold tabular-nums text-brand-light">{t.rewardFormatted}</span>
      </div>
      {t.endsAt && <p className="mt-2 text-xs text-muted">{t.expired ? "Ended" : "Ends"} {new Date(t.endsAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</p>}

      {t.rewarded ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-good/12 px-4 py-2 text-[15px] font-semibold text-good">
          <CheckCircle2 className="h-4 w-4" /> {t.rewarded === "PAID" ? "Completed — paid" : t.rewarded === "VOID" ? "Cancelled" : "Completed — paying soon"}
        </p>
      ) : t.kind === "AUTO" ? (
        <div className="mt-4">
          <div className="flex justify-between text-sm"><span className="text-muted">{t.metricLabel}</span><span className="font-semibold">{t.progressFormatted} / {t.targetFormatted}</span></div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-circle"><div className="h-full rounded-full bg-gradient-to-r from-brand-light to-gold" style={{ width: `${pct}%` }} /></div>
          <p className="mt-2 text-xs text-muted">Counted automatically — paid as soon as you hit the target.</p>
        </div>
      ) : sub?.status === "PENDING" ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-warn/12 px-4 py-2 text-[15px] font-semibold text-warn"><Clock className="h-4 w-4" /> Submitted — we&apos;re checking it</p>
      ) : t.expired ? null : t.brand && t.brand.postsLeft <= 0 ? (
        <p className="mt-4 text-sm text-muted">Every paid post for this campaign has been taken. Watch for the next one.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {sub?.status === "REJECTED" && <p className="notice-bad">Not approved{sub.reason ? `: ${sub.reason}` : ""}. You can submit again.</p>}
          <input className="input" placeholder="Link to your post, reel or video" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="input" placeholder="Anything we should know (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <p className="notice-bad">{error}</p>}
          <button onClick={submit} disabled={busy || !/^https?:\/\/\S+\.\S+/.test(url.trim())} className="btn w-full">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit proof"}</button>
        </div>
      )}
    </div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.tasks().then((r) => setTasks(r.tasks)).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load tasks."));
  useEffect(() => {
    void load();
  }, []);

  return (
    <Shell>
      <h1 className="title-lg mb-5">Tasks</h1>
      {!tasks ? (
        error ? <p className="card text-center text-muted">{error}</p> : <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : tasks.length === 0 ? (
        <div className="card py-12 text-center subhead"><ListChecks className="mx-auto mb-2 h-8 w-8" />No tasks right now — we&apos;ll notify you when there are.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">{tasks.map((t) => <TaskCard key={t.id} t={t} onDone={load} />)}</div>
      )}
    </Shell>
  );
}
