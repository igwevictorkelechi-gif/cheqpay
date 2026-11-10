"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, CheckSquare, ChevronLeft, Link2, Loader2, Share2, Square } from "lucide-react";
import {
  api,
  ApiError,
  type AjoFrequency,
  type AjoGroup,
  type AjoGroupDetail,
  type AjoOverview,
  type AjoPlan,
} from "@/services/api";
import { useTransactionPin, PIN_CANCELLED } from "@/components/TransactionPinProvider";
import DesktopSidebar from "@/components/DesktopSidebar";

// ------------------------------------------------------------- helpers --

const ngn = (v: string | number) =>
  "₦" + Number(v).toLocaleString("en-NG", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const every: Record<AjoFrequency, string> = { daily: "day", weekly: "week", monthly: "month" };
const everyPlural: Record<AjoFrequency, string> = { daily: "days", weekly: "weeks", monthly: "months" };
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" }) : "";
const MAX: Record<AjoFrequency, number> = { daily: 366, weekly: 104, monthly: 60 };
const FREQS: { key: AjoFrequency; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];
const SUGGESTED: Record<AjoFrequency, number[]> = { daily: [30, 60, 90], weekly: [4, 12, 26, 52], monthly: [3, 6, 12] };
const GOALS = [
  { emoji: "🏠", label: "Rent" },
  { emoji: "📱", label: "New phone" },
  { emoji: "✈️", label: "Japa fund" },
  { emoji: "🎓", label: "School fees" },
  { emoji: "🎉", label: "Detty December" },
  { emoji: "💻", label: "Laptop" },
  { emoji: "🛡️", label: "Emergency" },
  { emoji: "💍", label: "Wedding" },
  { emoji: "🚗", label: "Car" },
  { emoji: "👗", label: "Fits" },
];
const PRESETS: { label: string; amount: string; frequency: AjoFrequency; count: number }[] = [
  { label: "₦500 a day · 30 days", amount: "500", frequency: "daily", count: 30 },
  { label: "₦1,000 a day · 90 days", amount: "1000", frequency: "daily", count: 90 },
  { label: "₦5,000 a week · 12 weeks", amount: "5000", frequency: "weekly", count: 12 },
  { label: "₦20,000 a month · 6 months", amount: "20000", frequency: "monthly", count: 6 },
];
const GROUP_TERMS = [
  "Your contribution is taken from your CheqPay wallet automatically at 9am on each due date.",
  "Each round, one member collects everything paid in. The order is fixed when the group starts.",
  "If your wallet is short, you owe that round’s collector. Money that comes into your wallet goes to them first.",
  "While you owe, withdrawals, transfers and purchases are paused, and you can’t join other groups.",
  "Only join people you trust. CheqPay doesn’t cover a member who doesn’t pay.",
];
const STATUS: Record<AjoGroup["status"], { label: string; cls: string }> = {
  forming: { label: "Gathering people", cls: "text-amber-400" },
  active: { label: "Running", cls: "text-emerald-400" },
  completed: { label: "Done", cls: "text-muted" },
  cancelled: { label: "Cancelled", cls: "text-muted" },
};
const AVATAR_COLORS = ["#6B5B95", "#E8628C", "#2BB673", "#F59E0B", "#3B82F6", "#14B8A6", "#A855F7", "#EF4444"];
const inviteUrl = (code: string) => `https://mycheqpay.com/ajo?code=${encodeURIComponent(code)}`;

function splitGoal(name: string): { emoji: string; label: string } {
  const chars = Array.from(name.trim());
  const cp = chars[0]?.codePointAt(0) ?? 0;
  if (cp > 0x2000) {
    let n = 1;
    while (n < chars.length && [0xfe0f, 0x200d].includes(chars[n].codePointAt(0) ?? 0)) n += chars[n].codePointAt(0) === 0x200d ? 2 : 1;
    return { emoji: chars.slice(0, n).join(""), label: chars.slice(n).join("").trim() || name.trim() };
  }
  return { emoji: "🐷", label: name.trim() };
}
function dueLabel(iso: string | null): string {
  if (!iso) return "";
  const due = new Date(iso);
  const now = new Date();
  const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((dayOf(due) - dayOf(now)) / 86_400_000);
  if (days <= 0) return "Today, 9am";
  if (days === 1) return "Tomorrow, 9am";
  if (days < 7) return `In ${days} days`;
  return shortDate(iso);
}
const planPct = (p: Pick<AjoPlan, "saved" | "target">) =>
  Math.min(100, Math.round((Number(p.saved) / Math.max(1, Number(p.target))) * 100));
function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
const money = (t: string) => {
  const [w, ...rest] = t.replace(/[^\d.]/g, "").split(".");
  return rest.length ? `${w}.${rest.join("").slice(0, 2)}` : w;
};
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const input = "w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink outline-none focus:border-brand";
const chip = (on: boolean) => `rounded-full px-4 py-2 text-sm font-bold transition-colors ${on ? "bg-brand text-white" : "bg-card text-muted hover:text-ink"}`;
const primary = "mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-brand py-4 font-bold text-white disabled:opacity-50";

function Avatar({ name, size = 36, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-extrabold text-white ring-2 ring-card ${className}`}
      style={{ width: size, height: size, backgroundColor: avatarColor(name), fontSize: size * 0.42 }}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function StreakTrack({ paid, missed, total }: { paid: number; missed: number; total: number }) {
  if (total > 40) {
    const pct = Math.min(100, Math.round(((paid + missed) / Math.max(1, total)) * 100));
    return (
      <div className="h-2 rounded-full bg-border">
        <div className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-full ${i < paid ? "bg-brand" : i < paid + missed ? "bg-red-400/50" : "bg-border"}`}
        />
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <div className="mt-16 flex justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-muted" />
    </div>
  );
}

type View = { kind: "home" } | { kind: "plan" } | { kind: "group-new"; code?: string } | { kind: "group"; id: string };

// ---------------------------------------------------------------- page --

/**
 * Ajo on the web: solo plans and group circles, the same as the app. One page
 * with four views, because the site is a static export. An invite link
 * (/ajo?code=…) opens straight onto the join form.
 */
export default function AjoPage() {
  return (
    <Suspense fallback={null}>
      <AjoInner />
    </Suspense>
  );
}

function AjoInner() {
  const router = useRouter();
  const params = useSearchParams();
  const invite = params.get("code");
  const [view, setView] = useState<View>(invite ? { kind: "group-new", code: invite } : { kind: "home" });
  const back = () => (view.kind === "home" ? router.back() : setView({ kind: "home" }));
  const title = { home: "Ajo", plan: "New plan", "group-new": "Group Ajo", group: "Ajo group" }[view.kind];

  return (
    <div className="flex min-h-screen justify-center bg-backdrop lg:bg-surface lg:pl-64">
      <DesktopSidebar />
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-3 lg:max-w-3xl">
        <button onClick={back} className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink" aria-label="Go back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="mt-4 text-3xl font-extrabold text-ink">{title}</h1>
        {view.kind === "home" && <Home go={setView} />}
        {view.kind === "plan" && <NewPlan done={() => setView({ kind: "home" })} />}
        {view.kind === "group-new" && <NewGroup initialCode={view.code ?? ""} open={(id) => setView({ kind: "group", id })} />}
        {view.kind === "group" && <Group id={view.id} closed={() => setView({ kind: "home" })} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- home --

function Home({ go }: { go: (v: View) => void }) {
  const { authorize } = useTransactionPin();
  const [data, setData] = useState<AjoOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getAjo());
      setError(null);
    } catch (e) {
      setError(errText(e, "Couldn’t load Ajo. Please refresh."));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function breakPlan(p: AjoPlan) {
    const fee = data?.rules.breakFeePercent ?? 0;
    const { label } = splitGoal(p.name);
    const ok = window.confirm(
      `End “${label}” early? ${ngn(p.saved)} comes back to your wallet${fee > 0 ? `, minus a ${fee}% break fee` : ""}. Plans that run to the end are free, and you’re ${planPct(p)}% there.`,
    );
    if (!ok) return;
    try {
      const r = await authorize((pin) => api.breakAjoPlan(p.id, pin), { title: "End Ajo plan", detail: `Enter your transaction PIN to end “${label}”.` });
      window.alert(`${ngn(r.returned)} is back in your wallet.`);
      load();
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      window.alert(errText(e, "Couldn’t end the plan. Please try again."));
    }
  }

  if (!data) return error ? <p className="mt-8 text-sm text-muted">{error}</p> : <Spinner />;

  const active = data.plans.filter((p) => p.status === "active");
  const ended = data.plans.filter((p) => p.status !== "active").slice(0, 5);
  const savedNow = active.reduce((s, p) => s + Number(p.saved), 0);
  const goalTotal = active.reduce((s, p) => s + Number(p.target), 0);
  const live = data.groups.filter((g) => g.status === "active" || g.status === "forming");
  const nextDue = [...active.map((p) => p.nextDueAt), ...live.map((g) => g.nextDueAt)].filter((d): d is string => Boolean(d)).sort()[0];

  return (
    <>
      {data.inArrears && (
        <div className="mt-4 rounded-2xl bg-red-500/10 p-4">
          <p className="font-bold text-red-400">You owe your group {ngn(data.arrears)}</p>
          <p className="mt-1 text-xs text-muted">
            Money you add goes to them first. Withdrawals, transfers and purchases open again the moment you’re caught up.
          </p>
          <a href="/deposit" className="mt-3 inline-block rounded-full bg-red-400 px-4 py-2 text-xs font-bold text-white">
            Add money
          </a>
        </div>
      )}

      <div className="mt-5 rounded-3xl bg-brand p-5 text-white">
        <p className="text-sm text-white/75">{active.length ? "Locked away so far" : "Saving, but make it automatic"}</p>
        <p className="mt-0.5 text-4xl font-extrabold">{ngn(savedNow)}</p>
        {goalTotal > 0 && (
          <p className="mt-1 text-xs text-white/85">
            {Math.round((savedNow / goalTotal) * 100)}% of {ngn(goalTotal)} across {active.length} {active.length === 1 ? "plan" : "plans"}
          </p>
        )}
        <p className="mt-2 text-xs text-white/75">
          {nextDue ? `Next auto-save: ${dueLabel(nextDue)}. You don’t have to remember a thing.` : "Pick an amount and a rhythm. We take it from your wallet on the day, every time."}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button onClick={() => go({ kind: "plan" })} className="flex flex-col items-center rounded-2xl bg-card py-4 hover:bg-circle">
          <span className="text-2xl">🐷</span>
          <span className="mt-1 font-semibold text-ink">Solo plan</span>
          <span className="text-xs text-muted">Save towards a goal</span>
        </button>
        <button onClick={() => go({ kind: "group-new" })} className="flex flex-col items-center rounded-2xl bg-card py-4 hover:bg-circle">
          <span className="text-2xl">🤝</span>
          <span className="mt-1 font-semibold text-ink">Group Ajo</span>
          <span className="text-xs text-muted">Save with your people</span>
        </button>
      </div>

      <p className="mt-7 mb-2 text-sm font-semibold text-muted">My plans</p>
      {active.length === 0 ? (
        <button onClick={() => go({ kind: "plan" })} className="flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left hover:bg-circle">
          <span className="text-3xl">🎯</span>
          <span>
            <span className="block font-semibold text-ink">Name a goal, pick a rhythm</span>
            <span className="block text-xs text-muted">₦500 a day is ₦15,000 by the end of the month. It all comes back, free, when the plan ends.</span>
          </span>
        </button>
      ) : (
        active.map((p) => {
          const { emoji, label } = splitGoal(p.name);
          const left = Number(p.target) - Number(p.saved);
          return (
            <div key={p.id} className="mb-3 rounded-2xl bg-card p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-circle text-2xl">{emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink">{label}</p>
                  <p className="text-xs text-muted">
                    {ngn(p.amount)} every {every[p.frequency]} · {dueLabel(p.nextDueAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-ink">{ngn(p.saved)}</p>
                  <p className="text-xs font-bold text-brand-light">{planPct(p)}% there</p>
                </div>
              </div>
              <div className="mt-3">
                <StreakTrack paid={p.paidCount} missed={p.missedCount} total={p.totalCount} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted">
                <span>
                  {p.paidCount} saved{p.missedCount > 0 ? ` · ${p.missedCount} missed` : ""} · {left > 0 ? `${ngn(left)} to go` : "goal reached"}
                </span>
                <button onClick={() => breakPlan(p)} className="font-semibold hover:text-ink">
                  End early
                </button>
              </div>
            </div>
          );
        })
      )}

      <p className="mt-5 mb-2 text-sm font-semibold text-muted">My groups</p>
      {data.groups.length === 0 ? (
        <button onClick={() => go({ kind: "group-new" })} className="flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left hover:bg-circle">
          <span className="text-3xl">🫂</span>
          <span>
            <span className="block font-semibold text-ink">Start one with your people</span>
            <span className="block text-xs text-muted">Everyone pays in each round. One person collects the whole pot, until everyone has had a turn.</span>
          </span>
        </button>
      ) : (
        data.groups.map((g) => {
          const myTurn = g.status === "active" && g.myPosition === g.currentRound;
          return (
            <button
              key={g.id}
              onClick={() => go({ kind: "group", id: g.id })}
              className={`mb-3 w-full rounded-2xl bg-card p-4 text-left hover:bg-circle ${myTurn ? "ring-1 ring-brand-light" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-bold text-ink">{g.name}</p>
                <span className={`shrink-0 text-xs font-bold ${STATUS[g.status].cls}`}>{STATUS[g.status].label}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {ngn(g.amount)} every {every[g.frequency]} · pot {ngn(g.pot)}
                {g.status === "forming" ? ` · ${g.members ?? 1}/${g.size} in` : ""}
                {g.status === "active" ? ` · round ${g.currentRound} of ${g.size}` : ""}
              </p>
              {g.status === "active" && (
                <p className="mt-2.5 flex items-center gap-2 text-xs">
                  <span className={`rounded-full px-2.5 py-1 font-bold ${myTurn ? "bg-brand text-white" : "bg-circle text-ink"}`}>
                    {myTurn
                      ? `Your turn · ${dueLabel(g.nextDueAt)}`
                      : g.myPosition && g.myPosition > g.currentRound
                        ? `You collect in round ${g.myPosition}`
                        : "You’ve collected"}
                  </span>
                  {!myTurn && <span className="text-muted">Next: {dueLabel(g.nextDueAt)}</span>}
                </p>
              )}
              {g.status === "forming" && g.isOrganiser && <p className="mt-2 text-xs font-semibold text-brand-light">Share the code · {g.inviteCode}</p>}
            </button>
          );
        })
      )}

      {ended.length > 0 && (
        <>
          <p className="mt-5 mb-2 text-sm font-semibold text-muted">Finished</p>
          <div className="divide-y divide-border rounded-2xl bg-card">
            {ended.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-4 py-3 text-sm">
                <span>{splitGoal(p.name).emoji}</span>
                <span className="flex-1 truncate text-ink">{splitGoal(p.name).label}</span>
                <span className="text-xs text-muted">
                  {p.status === "matured" ? "Completed 🎉" : "Ended early"} · {shortDate(p.closedAt)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="mt-8 text-center text-xs text-muted">
        No interest, no fine print. Finished plans come back in full. Ending early keeps a {data.rules.breakFeePercent}% fee.
      </p>
    </>
  );
}

// ------------------------------------------------------------ new plan --

function NewPlan({ done }: { done: () => void }) {
  const { authorize } = useTransactionPin();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [freq, setFreq] = useState<AjoFrequency>("weekly");
  const [count, setCount] = useState("12");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<AjoPlan | null>(null);
  const n = Number(count) || 0;
  const amt = Number(amount) || 0;
  const valid = name.trim().length >= 2 && amt >= 100 && n >= 2 && n <= MAX[freq];
  const goal = GOALS.find((g) => `${g.emoji} ${g.label}` === name.trim());

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { plan } = await authorize((pin) => api.createAjoPlan({ name: name.trim(), amount, frequency: freq, count: n }, pin), {
        title: "Lock it in",
        detail: `Enter your transaction PIN. ${ngn(amt)} is saved now, then every ${every[freq]}.`,
      });
      setMade(plan);
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setError(errText(e, "Couldn’t start the plan. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  if (made) {
    const { emoji, label } = splitGoal(made.name);
    return (
      <div className="mt-16 flex flex-col items-center text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15">
          <Check className="h-10 w-10 text-emerald-400" />
        </span>
        <span className="mt-4 text-4xl">{emoji}</span>
        <p className="mt-3 text-2xl font-extrabold text-ink">{ngn(made.amount)} locked in</p>
        <p className="mt-2 max-w-[320px] text-sm text-muted">
          “{label}” is on. The next {ngn(made.amount)} goes in {dueLabel(made.nextDueAt).toLowerCase()}, and {ngn(made.target)} comes back to you when it’s done.
        </p>
        <button onClick={done} className={primary}>
          See my plans
        </button>
      </div>
    );
  }

  return (
    <>
      <p className="mt-6 mb-2 text-sm font-semibold text-muted">What’s it for?</p>
      <div className="flex flex-wrap gap-2">
        {GOALS.map((g) => {
          const on = goal?.label === g.label;
          return (
            <button key={g.label} className={`${chip(on)} flex items-center gap-1.5`} onClick={() => setName(on ? "" : `${g.emoji} ${g.label}`)}>
              <span>{g.emoji}</span>
              {g.label}
            </button>
          );
        })}
      </div>
      <input className={`${input} mt-3`} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="…or type your own goal" />

      <p className="mt-6 mb-2 text-sm font-semibold text-muted">Quick start</p>
      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map((p) => {
          const on = amount === p.amount && freq === p.frequency && n === p.count;
          return (
            <button
              key={p.label}
              onClick={() => {
                setAmount(p.amount);
                setFreq(p.frequency);
                setCount(String(p.count));
              }}
              className={`rounded-2xl px-4 py-3 text-left ${on ? "bg-brand text-white" : "bg-card text-ink hover:bg-circle"}`}
            >
              <span className="block text-sm font-bold">{p.label}</span>
              <span className={`block text-xs ${on ? "text-white/80" : "text-muted"}`}>= {ngn(Number(p.amount) * p.count)}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-6 mb-2 text-sm font-semibold text-muted">How often</p>
      <div className="flex gap-2">
        {FREQS.map((f) => (
          <button
            key={f.key}
            className={chip(f.key === freq)}
            onClick={() => {
              setFreq(f.key);
              if (n > MAX[f.key]) setCount(String(MAX[f.key]));
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <label className="mt-6 mb-2 block text-sm font-semibold text-muted">Each {every[freq]} (₦)</label>
      <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(money(e.target.value))} placeholder="5000" />

      <p className="mt-6 mb-2 text-sm font-semibold text-muted">For how many {everyPlural[freq]}</p>
      <div className="flex flex-wrap items-center gap-2">
        {SUGGESTED[freq].map((c) => (
          <button key={c} className={chip(n === c)} onClick={() => setCount(String(c))}>
            {c}
          </button>
        ))}
        <input
          className="w-20 rounded-full bg-card px-4 py-2 text-center text-sm font-bold text-ink outline-none focus:ring-1 focus:ring-brand"
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 3))}
        />
      </div>
      {n > MAX[freq] && <p className="mt-2 text-xs text-red-400">A {freq} plan can run for at most {MAX[freq]} {everyPlural[freq]}.</p>}

      {valid && (
        <div className="mt-6 rounded-2xl bg-card p-4">
          <p className="font-bold text-ink">
            {ngn(amt * n)} by the end {goal ? `· ${goal.emoji}` : ""}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
            <li>{ngn(amt)} leaves your wallet now, then at 9am every {every[freq]}. Nothing to remember.</li>
            <li>Short on a day? That one’s skipped, no penalty, and the plan keeps going.</li>
            <li>The whole pot comes back to your wallet the day the last one goes in. Free.</li>
            <li>Need it sooner? End the plan any time. A small break fee applies.</li>
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <button onClick={submit} disabled={!valid || busy} className={primary}>
        {busy && <Loader2 className="h-5 w-5 animate-spin" />}
        {valid ? `Lock in ${ngn(amt)}` : "Lock it in"}
      </button>
    </>
  );
}

// ----------------------------------------------------- create / join --

function NewGroup({ initialCode, open }: { initialCode: string; open: (id: string) => void }) {
  const { authorize } = useTransactionPin();
  const [mode, setMode] = useState<"join" | "create">("join");
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [freq, setFreq] = useState<AjoFrequency>("monthly");
  const [size, setSize] = useState("5");
  const [order, setOrder] = useState<"random" | "join">("random");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amt = Number(amount) || 0;
  const members = Number(size) || 0;
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const valid = agreed && (mode === "join" ? clean.length === 6 : name.trim().length >= 2 && amt >= 100 && members >= 2 && members <= 30);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { group } =
        mode === "join"
          ? await authorize((pin) => api.joinAjoGroup(clean, pin), {
              title: "Join Ajo group",
              detail: "Enter your transaction PIN to join and allow the contributions to be taken from your wallet.",
            })
          : await authorize(
              (pin) => api.createAjoGroup({ name: name.trim(), amount, frequency: freq, size: members, payoutOrder: order, acceptTerms: true }, pin),
              { title: "Create Ajo group", detail: "Enter your transaction PIN to create the group and join it." },
            );
      open(group.id);
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setError(errText(e, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mt-5 flex rounded-full bg-card p-1">
        {(["join", "create"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-full py-2.5 text-sm font-bold ${mode === m ? "bg-brand text-white" : "text-muted"}`}>
            {m === "join" ? "Join my people" : "Start a group"}
          </button>
        ))}
      </div>

      {mode === "join" ? (
        <>
          <label className="mt-6 mb-2 block text-sm font-semibold text-muted">Invite code</label>
          <input
            className={`${input} text-xl font-bold tracking-[0.3em]`}
            value={code}
            maxLength={8}
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="K7M2QX"
          />
          <p className="mt-2 text-xs text-muted">Got a link from a friend? Opening it fills this in. Otherwise ask them for the 6-character code.</p>
        </>
      ) : (
        <>
          <label className="mt-6 mb-2 block text-sm font-semibold text-muted">Group name</label>
          <input className={input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Office Ajo, Squad fund, Family…" />
          <p className="mt-6 mb-2 text-sm font-semibold text-muted">How often</p>
          <div className="flex gap-2">
            {FREQS.map((f) => (
              <button key={f.key} className={chip(f.key === freq)} onClick={() => setFreq(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <label className="mt-6 mb-2 block text-sm font-semibold text-muted">Each member pays, every {every[freq]} (₦)</label>
          <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(money(e.target.value))} placeholder="10000" />
          <label className="mt-6 mb-2 block text-sm font-semibold text-muted">People (2 to 30)</label>
          <input className={input} inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          <p className="mt-6 mb-2 text-sm font-semibold text-muted">Who collects first</p>
          <div className="flex gap-2">
            <button className={chip(order === "random")} onClick={() => setOrder("random")}>
              Random draw
            </button>
            <button className={chip(order === "join")} onClick={() => setOrder("join")}>
              Order joined
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            {order === "random"
              ? "The order is drawn fairly when you start the group. Nobody, you included, can pick their spot."
              : "Whoever joins first collects first. You joined first, so you collect in round 1."}
          </p>
          {amt >= 100 && members >= 2 && (
            <div className="mt-5 rounded-2xl bg-card p-4">
              <p className="font-semibold text-ink">Each round’s pot: {ngn(amt * members)}</p>
              <p className="mt-1 text-xs text-muted">
                {members} rounds, one every {every[freq]}. Everyone collects once.
              </p>
            </div>
          )}
        </>
      )}

      <div className="mt-6 rounded-2xl bg-card p-4">
        <p className="font-semibold text-ink">How group Ajo works</p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
          {GROUP_TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <button onClick={() => setAgreed((a) => !a)} className="mt-4 flex items-center gap-2 text-sm text-ink" aria-pressed={agreed}>
          {agreed ? <CheckSquare className="h-5 w-5 text-brand" /> : <Square className="h-5 w-5 text-muted" />}I understand and agree
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <button onClick={submit} disabled={!valid || busy} className={primary}>
        {busy && <Loader2 className="h-5 w-5 animate-spin" />}
        {mode === "join" ? "Join group" : "Create group"}
      </button>
      <p className="mt-3 text-center text-xs text-muted">Group Ajo needs a verified government ID (Tier 2).</p>
    </>
  );
}

// ---------------------------------------------------------- one group --

function Group({ id, closed }: { id: string; closed: () => void }) {
  const [data, setData] = useState<AjoGroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getAjoGroup(id));
    } catch (e) {
      setError(errText(e, "Couldn’t load this group."));
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(action: "start" | "leave" | "cancel") {
    const msg = {
      start: `Start with ${data?.members.length ?? 0} people? The collecting order is fixed now and nobody else can join.`,
      leave: "Leave this group? You can join again with the code while it’s still gathering people.",
      cancel: "Cancel this group? Nobody has paid anything yet. This can’t be undone.",
    }[action];
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api.ajoGroupAction(id, action);
      if (action === "start") load();
      else closed();
    } catch (e) {
      window.alert(errText(e, "Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const g = data?.group;
    if (!g?.inviteCode) return;
    const text = `Join my Ajo “${g.name}” on CheqPay: ${ngn(g.amount)} every ${every[g.frequency]}, ${ngn(g.pot)} pot. Tap ${inviteUrl(g.inviteCode)} or enter code ${g.inviteCode} in the app.`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard?.writeText(text);
        setCopied(true);
      }
    } catch {
      /* the user closed the share sheet */
    }
  }

  if (!data) return error ? <p className="mt-8 text-sm text-muted">{error}</p> : <Spinner />;
  const g = data.group;
  const forming = g.status === "forming";
  const ordered = [...data.members].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const collector = ordered.find((m) => m.position === g.currentRound);
  const me = data.members.find((m) => m.isMe);
  const myTurn = g.status === "active" && me?.position === g.currentRound;
  const roundsLeft = Math.max(0, g.size - g.currentRound + 1);

  return (
    <>
      <p className="mt-1 text-lg font-bold text-ink">{g.name}</p>
      <div className="mt-4 rounded-3xl bg-brand p-5 text-white">
        <div className="flex items-center gap-3">
          <div className="flex">
            {ordered.slice(0, 6).map((m, i) => (
              <Avatar key={`${m.username}-${i}`} name={m.username} size={32} className={i === 0 ? "" : "-ml-2.5"} />
            ))}
            {ordered.length > 6 && (
              <span className="-ml-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/25 text-[11px] font-bold">+{ordered.length - 6}</span>
            )}
          </div>
          <span className="text-xs text-white/85">
            {data.members.length} of {g.size} people
          </span>
        </div>
        <p className="mt-4 text-sm text-white/75">Pot each round</p>
        <p className="mt-0.5 text-4xl font-extrabold">{ngn(g.pot)}</p>
        <p className="mt-1 text-xs text-white/80">
          {ngn(g.amount)} each, every {every[g.frequency]}
        </p>
        {g.status === "active" && (
          <div className="mt-4 rounded-2xl bg-white/15 px-3 py-2.5">
            <p className="text-sm font-bold">{myTurn ? "🎉 Your turn to collect" : `Up next: @${collector?.username ?? "member"}`}</p>
            <p className="mt-0.5 text-xs text-white/85">
              Round {g.currentRound} of {g.size} · {dueLabel(g.nextDueAt)} · {roundsLeft} {roundsLeft === 1 ? "round" : "rounds"} to go
            </p>
          </div>
        )}
        {g.status === "completed" && <p className="mt-3 text-sm font-bold">🎉 Done. Everyone collected {ngn(g.pot)}.</p>}
        {forming && (
          <p className="mt-3 text-xs text-white/85">
            {g.isOrganiser
              ? data.members.length < 2
                ? "Invite at least one person to start."
                : "Start whenever you’re ready, or wait for more people."
              : "Waiting for the organiser to start."}
          </p>
        )}
      </div>

      {forming && g.inviteCode && (
        <div className="mt-4 rounded-2xl bg-card p-4">
          <p className="text-xs text-muted">Invite code</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-3xl font-extrabold tracking-[0.3em] text-ink">{g.inviteCode}</p>
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard?.writeText(inviteUrl(g.inviteCode as string)).then(() => setCopied(true), () => undefined)}
                className="flex items-center gap-1 rounded-full bg-circle px-3 py-2 text-xs font-bold text-ink"
              >
                {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />} {copied ? "Copied" : "Copy link"}
              </button>
              <button onClick={share} className="flex items-center gap-1 rounded-full bg-brand px-3 py-2 text-xs font-bold text-white">
                <Share2 className="h-4 w-4" /> Share
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            Send it to people you’d trust with {ngn(g.amount)} every {every[g.frequency]}. Only them.
          </p>
        </div>
      )}

      <p className="mt-6 mb-2 text-sm font-semibold text-muted">{forming ? "Who’s in" : "Collecting order"}</p>
      <div className="divide-y divide-border rounded-2xl bg-card">
        {ordered.map((m, i) => {
          const now = g.status === "active" && m.position === g.currentRound;
          const collected = g.status === "completed" || (!forming && m.position !== null && m.position < g.currentRound);
          return (
            <div key={`${m.username}-${i}`} className={`flex items-center gap-3 px-4 py-3 ${now ? "bg-brand/15" : ""}`}>
              <Avatar name={m.username} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">
                  @{m.username}
                  {m.isMe ? " · you" : ""}
                </p>
                <p className="text-xs text-muted">
                  {m.isOrganiser ? "Organiser · " : ""}
                  {now ? "Collecting this round" : collected ? "Collected ✓" : forming ? "In" : `Round ${m.position}`}
                </p>
              </div>
              {m.behind ? (
                <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-bold text-red-400">Owes {ngn(m.owed)}</span>
              ) : (
                !forming && <span className={`text-sm font-extrabold ${now ? "text-brand-light" : "text-muted"}`}>#{m.position}</span>
              )}
            </div>
          );
        })}
      </div>

      {data.payouts.length > 0 && (
        <>
          <p className="mt-6 mb-2 text-sm font-semibold text-muted">Payouts so far</p>
          <div className="divide-y divide-border rounded-2xl bg-card">
            {data.payouts.map((p) => (
              <div key={p.round} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Avatar name={p.collector} size={28} />
                <span className="flex-1 text-ink">
                  Round {p.round} · @{p.collector}
                  {p.isMe ? " (you)" : ""}
                </span>
                <span className="text-right">
                  <span className="block font-semibold text-ink">{ngn(p.amount)}</span>
                  <span className="block text-xs text-muted">{shortDate(p.at)}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {forming && g.isOrganiser && (
        <>
          <button onClick={() => act("start")} disabled={busy || data.members.length < 2} className={primary}>
            {busy && <Loader2 className="h-5 w-5 animate-spin" />}
            {data.members.length < 2 ? "Waiting for people" : `Start with ${data.members.length} people`}
          </button>
          <button onClick={() => act("cancel")} disabled={busy} className="mt-4 text-sm font-semibold text-red-400">
            Cancel group
          </button>
        </>
      )}
      {forming && !g.isOrganiser && (
        <button onClick={() => act("leave")} disabled={busy} className="mt-6 text-sm font-semibold text-red-400">
          Leave group
        </button>
      )}
      {!forming && <p className="mt-6 text-center text-xs text-muted">Contributions are taken at 9am on the day. The collector is paid the same minute.</p>}
    </>
  );
}
