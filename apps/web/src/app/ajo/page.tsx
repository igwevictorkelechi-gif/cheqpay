"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, ChevronLeft, Copy, Loader2, PiggyBank, Square, Users, Wallet } from "lucide-react";
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

const ngn = (v: string | number) =>
  "₦" + Number(v).toLocaleString("en-NG", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const every: Record<AjoFrequency, string> = { daily: "day", weekly: "week", monthly: "month" };
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" }) : "";
const MAX: Record<AjoFrequency, number> = { daily: 366, weekly: 104, monthly: 60 };
const FREQS: { key: AjoFrequency; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];
const GROUP_TERMS = [
  "Your contribution is taken from your CheqPay wallet automatically at 9am on each due date.",
  "Each round, one member collects everything paid in. The order is fixed when the group starts.",
  "If your wallet is short, you owe that round’s collector. Money that comes into your wallet goes to them first.",
  "While you owe, withdrawals, transfers and purchases are paused, and you can’t join other groups.",
  "Only join people you trust. CheqPay doesn’t cover a member who doesn’t pay.",
];
const STATUS: Record<AjoGroup["status"], { label: string; cls: string }> = {
  forming: { label: "Gathering members", cls: "text-amber-400" },
  active: { label: "Running", cls: "text-emerald-400" },
  completed: { label: "Completed", cls: "text-muted" },
  cancelled: { label: "Cancelled", cls: "text-muted" },
};

type View = { kind: "home" } | { kind: "plan" } | { kind: "group-new" } | { kind: "group"; id: string };

const input = "w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink outline-none focus:border-brand";
const chip = (on: boolean) => `rounded-full px-4 py-2 text-sm font-bold ${on ? "bg-brand text-white" : "bg-card text-muted"}`;
const money = (t: string) => {
  const [w, ...rest] = t.replace(/[^\d.]/g, "").split(".");
  return rest.length ? `${w}.${rest.join("").slice(0, 2)}` : w;
};
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/**
 * Ajo savings on the web: personal plans and group circles, the same as the
 * app. One page with four views, because the site is a static export.
 */
export default function AjoPage() {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "home" });
  const back = () => (view.kind === "home" ? router.back() : setView({ kind: "home" }));
  const title = { home: "Ajo savings", plan: "New Ajo plan", "group-new": "Group Ajo", group: "Ajo group" }[view.kind];

  return (
    <div className="flex min-h-screen justify-center bg-backdrop lg:bg-surface lg:pl-64">
      <DesktopSidebar />
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-3 lg:max-w-3xl">
        <button
          onClick={back}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Go back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="mt-4 text-3xl font-extrabold text-ink">{title}</h1>
        {view.kind === "home" && <Home go={setView} />}
        {view.kind === "plan" && <NewPlan done={() => setView({ kind: "home" })} />}
        {view.kind === "group-new" && <NewGroup open={(id) => setView({ kind: "group", id })} />}
        {view.kind === "group" && <Group id={view.id} closed={() => setView({ kind: "home" })} />}
      </div>
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
    const ok = window.confirm(
      `End “${p.name}” early? ${ngn(p.saved)} goes back to your wallet${fee > 0 ? `, minus a ${fee}% break fee` : ""}. Plans that run to the end are free.`,
    );
    if (!ok) return;
    try {
      const r = await authorize((pin) => api.breakAjoPlan(p.id, pin), {
        title: "End Ajo plan",
        detail: `Enter your transaction PIN to end “${p.name}”.`,
      });
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

  return (
    <>
      {data.inArrears && (
        <div className="mt-4 rounded-2xl bg-red-500/10 p-4">
          <p className="font-bold text-red-400">You owe {ngn(data.arrears)} to your Ajo group</p>
          <p className="mt-1 text-xs text-muted">
            Money you add goes to your group first. Withdrawals, transfers and purchases open again as soon as you’re
            caught up.
          </p>
          <a href="/deposit" className="mt-2 inline-block text-sm font-bold text-brand-light">
            Add money
          </a>
        </div>
      )}

      <div className="mt-5 rounded-3xl bg-brand p-5 text-white">
        <p className="text-sm text-white/75">Saved in your plans</p>
        <p className="mt-0.5 text-3xl font-extrabold">{ngn(savedNow)}</p>
        <p className="mt-1.5 text-xs text-white/75">Taken automatically at {data.rules.dueTime} on each due date.</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button onClick={() => go({ kind: "plan" })} className="flex flex-col items-center rounded-2xl bg-card py-4">
          <Wallet className="h-6 w-6 text-brand-light" />
          <span className="mt-1 font-semibold text-ink">New plan</span>
          <span className="text-xs text-muted">Just me</span>
        </button>
        <button onClick={() => go({ kind: "group-new" })} className="flex flex-col items-center rounded-2xl bg-card py-4">
          <Users className="h-6 w-6 text-brand-light" />
          <span className="mt-1 font-semibold text-ink">Group Ajo</span>
          <span className="text-xs text-muted">Start or join</span>
        </button>
      </div>

      <p className="mt-7 mb-2 text-sm font-semibold text-muted">My plans</p>
      {active.length === 0 ? (
        <p className="rounded-2xl bg-card p-4 text-sm text-muted">
          Pick an amount and how often. We save it for you, and it all comes back when the plan ends.
        </p>
      ) : (
        active.map((p) => {
          const pct = Math.min(100, Math.round((Number(p.saved) / Math.max(1, Number(p.target))) * 100));
          return (
            <div key={p.id} className="mb-3 rounded-2xl bg-card p-4">
              <div className="flex items-center justify-between">
                <p className="font-bold text-ink">{p.name}</p>
                <p className="font-bold text-ink">{ngn(p.saved)}</p>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {ngn(p.amount)} every {every[p.frequency]} · {p.paidCount + p.missedCount} of {p.totalCount}
                {p.missedCount > 0 ? ` · ${p.missedCount} missed` : ""}
              </p>
              <div className="mt-3 h-2 rounded-full bg-border">
                <div className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted">
                <span>
                  {p.nextDueAt ? `Next: ${shortDate(p.nextDueAt)} · ` : ""}Goal {ngn(p.target)}
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
        <p className="rounded-2xl bg-card p-4 text-sm text-muted">
          Save with people you trust. Everyone pays in each round and one person collects the whole pot, until everyone
          has had a turn.
        </p>
      ) : (
        data.groups.map((g) => (
          <button
            key={g.id}
            onClick={() => go({ kind: "group", id: g.id })}
            className="mb-3 w-full rounded-2xl bg-card p-4 text-left"
          >
            <div className="flex items-center justify-between">
              <p className="font-bold text-ink">{g.name}</p>
              <span className={`text-xs font-bold ${STATUS[g.status].cls}`}>{STATUS[g.status].label}</span>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {ngn(g.amount)} every {every[g.frequency]} · pot {ngn(g.pot)}
              {g.status === "forming" ? ` · ${g.members ?? 1}/${g.size} joined` : ""}
              {g.status === "active" ? ` · round ${g.currentRound} of ${g.size}` : ""}
            </p>
          </button>
        ))
      )}

      {ended.length > 0 && (
        <>
          <p className="mt-5 mb-2 text-sm font-semibold text-muted">Finished plans</p>
          <div className="divide-y divide-border rounded-2xl bg-card">
            {ended.map((p) => (
              <div key={p.id} className="flex justify-between px-4 py-3 text-sm">
                <span className="text-ink">{p.name}</span>
                <span className="text-xs text-muted">
                  {p.status === "matured" ? "Completed" : "Ended early"} · {shortDate(p.closedAt)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
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
  const n = Number(count) || 0;
  const amt = Number(amount) || 0;
  const valid = name.trim().length >= 2 && amt >= 100 && n >= 2 && n <= MAX[freq];

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await authorize((pin) => api.createAjoPlan({ name: name.trim(), amount, frequency: freq, count: n }, pin), {
        title: "Start Ajo plan",
        detail: `Enter your transaction PIN. ${ngn(amt)} is taken now, then every ${every[freq]}.`,
      });
      done();
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setError(errText(e, "Couldn’t start the plan. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className="mt-6 mb-2 block text-sm font-semibold text-muted">What are you saving for?</label>
      <input className={input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Rent, school fees, a new phone…" />

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

      <label className="mt-6 mb-2 block text-sm font-semibold text-muted">Amount each {every[freq]} (₦)</label>
      <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(money(e.target.value))} placeholder="5000" />

      <label className="mt-6 mb-2 block text-sm font-semibold text-muted">How many times (2 to {MAX[freq]})</label>
      <input className={input} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 3))} />

      {valid && (
        <div className="mt-6 rounded-2xl bg-card p-4">
          <p className="font-semibold text-ink">You’ll save {ngn(amt * n)} in total</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
            <li>{ngn(amt)} is taken from your wallet now, then at 9am every {every[freq]}.</li>
            <li>When the last one is taken, everything comes back to your wallet. No fee.</li>
            <li>If your wallet is short on a due date, that one is skipped and the plan carries on.</li>
            <li>You can end it early: you get your savings back minus a small break fee.</li>
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <button
        onClick={submit}
        disabled={!valid || busy}
        className="mt-6 flex items-center justify-center gap-2 rounded-full bg-brand py-4 font-bold text-white disabled:opacity-50"
      >
        {busy && <Loader2 className="h-5 w-5 animate-spin" />}
        {valid ? `Save ${ngn(amt)} now` : "Start plan"}
      </button>
    </>
  );
}

// ----------------------------------------------------- create / join --

function NewGroup({ open }: { open: (id: string) => void }) {
  const { authorize } = useTransactionPin();
  const [mode, setMode] = useState<"join" | "create">("join");
  const [code, setCode] = useState("");
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
              (pin) =>
                api.createAjoGroup(
                  { name: name.trim(), amount, frequency: freq, size: members, payoutOrder: order, acceptTerms: true },
                  pin,
                ),
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
          <button key={m} onClick={() => setMode(m)} className={`flex-1 ${chip(mode === m)} ${mode === m ? "" : "bg-transparent"}`}>
            {m === "join" ? "Join a group" : "Start a group"}
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
          <p className="mt-2 text-xs text-muted">Ask the organiser for the 6-character code.</p>
        </>
      ) : (
        <>
          <label className="mt-6 mb-2 block text-sm font-semibold text-muted">Group name</label>
          <input className={input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Office Ajo, Family savings…" />
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
          <label className="mt-6 mb-2 block text-sm font-semibold text-muted">Members (2 to 30)</label>
          <input className={input} inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          <p className="mt-6 mb-2 text-sm font-semibold text-muted">Who collects first</p>
          <div className="flex gap-2">
            <button className={chip(order === "random")} onClick={() => setOrder("random")}>Random draw</button>
            <button className={chip(order === "join")} onClick={() => setOrder("join")}>Order joined</button>
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
      <button
        onClick={submit}
        disabled={!valid || busy}
        className="mt-6 flex items-center justify-center gap-2 rounded-full bg-brand py-4 font-bold text-white disabled:opacity-50"
      >
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
      start: "Start the group now? The collecting order is fixed and nobody else can join.",
      leave: "Leave this group? You can join again with the code while it’s still gathering members.",
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

  if (!data) return error ? <p className="mt-8 text-sm text-muted">{error}</p> : <Spinner />;
  const g = data.group;
  const forming = g.status === "forming";
  const ordered = [...data.members].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));

  return (
    <>
      <p className="mt-1 text-lg font-bold text-ink">{g.name}</p>
      <div className="mt-4 rounded-3xl bg-brand p-5 text-white">
        <p className="text-sm text-white/75">Pot each round</p>
        <p className="mt-0.5 text-3xl font-extrabold">{ngn(g.pot)}</p>
        <p className="mt-1.5 text-xs text-white/80">
          {ngn(g.amount)} each, every {every[g.frequency]} · {g.size} members
        </p>
        {g.status === "active" && (
          <p className="mt-2.5 text-sm font-bold">
            Round {g.currentRound} of {g.size} · next contribution {shortDate(g.nextDueAt)}, 9am
          </p>
        )}
        {g.status === "completed" && <p className="mt-2.5 text-sm font-bold">Completed. Everyone has collected.</p>}
      </div>

      {forming && g.inviteCode && (
        <div className="mt-4 rounded-2xl bg-card p-4">
          <p className="text-xs text-muted">
            Invite code · {data.members.length} of {g.size} joined
          </p>
          <div className="mt-1 flex items-center justify-between">
            <p className="text-2xl font-extrabold tracking-[0.3em] text-ink">{g.inviteCode}</p>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(g.inviteCode as string).then(() => setCopied(true), () => undefined);
              }}
              className="flex items-center gap-1 rounded-full bg-circle px-3 py-2 text-xs font-bold text-ink"
            >
              <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">Only share it with people you trust to pay every round.</p>
        </div>
      )}

      <p className="mt-6 mb-2 text-sm font-semibold text-muted">{forming ? "Members" : "Collecting order"}</p>
      <div className="divide-y divide-border rounded-2xl bg-card">
        {ordered.map((m, i) => {
          const now = g.status === "active" && m.position === g.currentRound;
          const collected = g.status === "completed" || (!forming && m.position !== null && m.position < g.currentRound);
          return (
            <div key={`${m.username}-${i}`} className="flex items-center px-4 py-3">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                  now ? "bg-brand text-white" : "bg-circle text-muted"
                }`}
              >
                {m.position ?? "·"}
              </span>
              <div className="ml-3 min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">
                  @{m.username}
                  {m.isMe ? " (you)" : ""}
                </p>
                <p className="text-xs text-muted">
                  {m.isOrganiser ? "Organiser · " : ""}
                  {now ? "Collecting this round" : collected ? "Collected" : forming ? "Joined" : "Waiting"}
                </p>
              </div>
              {m.behind && <span className="text-xs font-bold text-red-400">Owes {ngn(m.owed)}</span>}
            </div>
          );
        })}
      </div>

      {data.payouts.length > 0 && (
        <>
          <p className="mt-6 mb-2 text-sm font-semibold text-muted">Payouts</p>
          <div className="divide-y divide-border rounded-2xl bg-card">
            {data.payouts.map((p) => (
              <div key={p.round} className="flex justify-between px-4 py-3 text-sm">
                <span className="text-ink">
                  Round {p.round} · @{p.collector}
                  {p.isMe ? " (you)" : ""}
                </span>
                <span className="font-semibold text-ink">{ngn(p.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {forming && g.isOrganiser && (
        <>
          <button
            onClick={() => act("start")}
            disabled={busy || data.members.length < 2}
            className="mt-6 flex items-center justify-center gap-2 rounded-full bg-brand py-4 font-bold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="h-5 w-5 animate-spin" />}
            {data.members.length < 2 ? "Waiting for members" : `Start with ${data.members.length} members`}
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
      {!forming && (
        <p className="mt-6 flex items-center gap-2 text-xs text-muted">
          <PiggyBank className="h-4 w-4" /> Contributions are taken at 9am on each due date. The collector is paid at once.
        </p>
      )}
    </>
  );
}
