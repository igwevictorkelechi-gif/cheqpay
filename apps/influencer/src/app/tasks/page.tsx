"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, ListChecks, Loader2 } from "lucide-react";
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold">{t.title}</p>
          {t.description && <p className="mt-1 text-sm text-muted">{t.description}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-gold/15 px-3 py-1 text-sm font-bold text-gold">{t.rewardFormatted}</span>
      </div>
      {t.endsAt && <p className="mt-2 text-xs text-muted">{t.expired ? "Ended" : "Ends"} {new Date(t.endsAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</p>}

      {t.rewarded ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-green-500/15 px-4 py-2 text-sm font-semibold text-green-400">
          <CheckCircle2 className="h-4 w-4" /> {t.rewarded === "PAID" ? "Completed — paid" : t.rewarded === "VOID" ? "Cancelled" : "Completed — paying soon"}
        </p>
      ) : t.kind === "AUTO" ? (
        <div className="mt-4">
          <div className="flex justify-between text-sm"><span className="text-muted">{t.metricLabel}</span><span className="font-semibold">{t.progressFormatted} / {t.targetFormatted}</span></div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-circle"><div className="h-full rounded-full bg-gradient-to-r from-brand-light to-gold" style={{ width: `${pct}%` }} /></div>
          <p className="mt-2 text-xs text-muted">Counted automatically — paid as soon as you hit the target.</p>
        </div>
      ) : sub?.status === "PENDING" ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-300"><Clock className="h-4 w-4" /> Submitted — we&apos;re checking it</p>
      ) : t.expired ? null : (
        <div className="mt-4 space-y-2">
          {sub?.status === "REJECTED" && <p className="rounded-2xl bg-red-500/10 px-4 py-2 text-sm text-red-400">Not approved{sub.reason ? `: ${sub.reason}` : ""}. You can submit again.</p>}
          <input className="input" placeholder="Link to your post, reel or video" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="input" placeholder="Anything we should know (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={submit} disabled={busy || !/^https?:\/\/\S+\.\S+/.test(url.trim())} className="btn">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit proof"}</button>
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
      <h1 className="mb-4 text-2xl font-extrabold">Tasks</h1>
      {!tasks ? (
        error ? <p className="card text-center text-muted">{error}</p> : <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : tasks.length === 0 ? (
        <div className="card py-12 text-center text-muted"><ListChecks className="mx-auto mb-2 h-8 w-8" />No tasks right now — we&apos;ll notify you when there are.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">{tasks.map((t) => <TaskCard key={t.id} t={t} onDone={load} />)}</div>
      )}
    </Shell>
  );
}
