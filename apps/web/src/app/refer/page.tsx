"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, Copy, Gift, Loader2, Share2, Sparkles, Users } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/MobileUI";
import { api, ApiError, type MyReferral, type ReferralEarning } from "@/services/api";

const KIND_LABEL: Record<ReferralEarning["kind"], string> = {
  BASIC_BONUS: "Referral bonus",
  WELCOME_BONUS: "Welcome bonus",
  COMMISSION: "Commission",
  TASK: "Task reward",
};

export default function ReferPage() {
  const router = useRouter();
  const [data, setData] = useState<MyReferral | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [code, setCode] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    api
      .getMyReferral()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your referrals."));

  useEffect(() => {
    void load();
  }, []);

  function copy(what: "code" | "link") {
    if (!data) return;
    void navigator.clipboard?.writeText(what === "code" ? data.code : data.link);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  async function share() {
    if (!data) return;
    const text = `Join me on CheqPay — send money, pay bills and trade crypto from one balance. Use my code ${data.code}: ${data.link}`;
    if (navigator.share) {
      await navigator.share({ title: "Join CheqPay", text, url: data.link }).catch(() => undefined);
    } else copy("link");
  }

  async function apply() {
    setApplying(true);
    setApplyMsg(null);
    try {
      const r = await api.applyReferral(code);
      setApplyMsg({ ok: true, text: `Done — you were invited by ${r.referrerName}.` });
      setCode("");
      await load();
    } catch (e) {
      setApplyMsg({ ok: false, text: e instanceof ApiError ? e.message : "Couldn't add that code." });
    } finally {
      setApplying(false);
    }
  }

  const influencer = data?.kind === "INFLUENCER";

  return (
    <AppShell>
      <div className="px-5 pt-4">
        <button onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>
      <h1 className="mt-3 px-5 text-2xl font-extrabold text-ink">Refer &amp; earn</h1>

      {!data ? (
        <div className="px-5 pt-6">
          {error ? <Card><p className="py-6 text-center text-sm text-muted">{error}</p></Card> : <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>}
        </div>
      ) : (
        <div className="space-y-4 px-5 pb-10 pt-2">
          <p className="text-sm text-muted">
            {influencer
              ? "You're in the influencer program — you earn a share of the fees on everything your referrals do."
              : `Invite friends to CheqPay. When a friend verifies their identity and makes a first transaction of ${data.qualifyMinFormatted} or more, you get ${data.basicBonusFormatted}.`}
          </p>

          <div className="rounded-3xl bg-gradient-to-br from-brand to-[#8f7fc0] p-5 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Your code</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="font-mono text-3xl font-extrabold tracking-wider">{data.code}</p>
              <button onClick={() => copy("code")} className="flex h-11 items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm font-semibold">
                {copied === "code" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied === "code" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-3 truncate rounded-2xl bg-black/15 px-3 py-2 text-xs text-white/80">{data.link}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => copy("link")} className="flex items-center justify-center gap-1.5 rounded-full bg-white/15 py-3 text-sm font-bold">
                {copied === "link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy link
              </button>
              <button onClick={share} className="flex items-center justify-center gap-1.5 rounded-full bg-white py-3 text-sm font-bold text-brand">
                <Share2 className="h-4 w-4" /> Share
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Joined", value: String(data.counts.signedUp) },
              { label: "Qualified", value: String(data.counts.qualified) },
              { label: "Earned", value: data.totals.lifetimeFormatted },
            ].map((s) => (
              <Card key={s.label} className="!p-4 text-center">
                <p className="text-lg font-extrabold text-ink">{s.value}</p>
                <p className="text-xs text-muted">{s.label}</p>
              </Card>
            ))}
          </div>
          {data.totals.heldFormatted !== "₦0.00" && (
            <p className="text-xs text-muted">
              {data.totals.heldFormatted} is on hold and lands in your balance {data.holdHours} hours after it&apos;s earned.
            </p>
          )}

          {influencer ? (
            <a href={data.portalUrl} className="flex items-center justify-between rounded-3xl bg-card p-5">
              <div>
                <p className="font-bold text-ink">Open your influencer dashboard</p>
                <p className="mt-0.5 text-xs text-muted">Clicks, sign-ups, commission and tasks</p>
              </div>
              <ArrowUpRight className="h-5 w-5 text-brand-light" />
            </a>
          ) : (
            <a href={data.portalUrl} className="flex items-center gap-3 rounded-3xl bg-card p-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400"><Sparkles className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-ink">Are you a creator?</p>
                <p className="mt-0.5 text-xs text-muted">
                  {data.application?.status === "PENDING"
                    ? "Your influencer application is being reviewed."
                    : "Join the influencer program and earn on every transaction your audience makes."}
                </p>
              </div>
              <ArrowUpRight className="h-5 w-5 shrink-0 text-brand-light" />
            </a>
          )}

          {data.canApply && (
            <Card>
              <p className="font-bold text-ink">Were you invited?</p>
              <p className="mt-0.5 text-xs text-muted">Add your friend&apos;s code within your first 7 days.</p>
              <div className="mt-3 flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20))}
                  placeholder="Enter code"
                  className="min-w-0 flex-1 rounded-2xl border border-border bg-card px-4 py-3 font-mono text-ink outline-none focus:border-brand"
                />
                <button onClick={apply} disabled={applying || code.length < 4} className="rounded-2xl bg-brand px-5 font-bold text-white disabled:opacity-40">
                  {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </button>
              </div>
              {applyMsg && <p className={`mt-2 text-xs ${applyMsg.ok ? "text-green-400" : "text-red-400"}`}>{applyMsg.text}</p>}
            </Card>
          )}
          {data.referredBy && <p className="text-center text-xs text-muted">You joined with code {data.referredBy}.</p>}

          <Card>
            <p className="mb-3 font-bold text-ink">Earnings</p>
            {data.earnings.length === 0 ? (
              <div className="py-6 text-center">
                <Users className="mx-auto h-9 w-9 text-muted" />
                <p className="mt-2 text-sm text-muted">Nothing yet — share your code to get started.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.earnings.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-500/15 text-green-400"><Gift className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{KIND_LABEL[e.kind]}{e.kind === "TASK" && e.note ? `: ${e.note}` : ""}</p>
                      <p className="text-xs text-muted">
                        {e.status === "PAID" ? "Paid" : e.status === "VOID" ? `Cancelled${e.voidReason ? ` — ${e.voidReason}` : ""}` : `On hold until ${new Date(e.releaseAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}`}
                      </p>
                    </div>
                    <span className={`text-sm font-bold ${e.status === "VOID" ? "text-muted line-through" : "text-ink"}`}>+{e.amountFormatted}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </AppShell>
  );
}
