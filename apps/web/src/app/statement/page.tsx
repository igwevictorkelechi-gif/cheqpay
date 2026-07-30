"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, FileText, Loader2, Mail, Sheet } from "lucide-react";
import { api, ApiError } from "@/services/api";

type Format = "pdf" | "csv";

/** YYYY-MM-DD for an offset from today, in the user's own calendar. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
const TODAY = new Date().toISOString().slice(0, 10);

const PRESETS: { label: string; days: number }[] = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 3 months", days: 90 },
  { label: "Last 6 months", days: 182 },
  { label: "Last year", days: 365 },
];

/**
 * Request an account statement for a date range and have it emailed. The file
 * is only ever sent to the address on the account — it is never returned here.
 */
export default function StatementPage() {
  const router = useRouter();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(TODAY);
  const [format, setFormat] = useState<Format>("pdf");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; count: number } | null>(null);

  useEffect(() => {
    api
      .getStatementAvailability()
      .then((r) => setAvailable(r.available))
      .catch(() => setAvailable(false));
  }, []);

  const rangeError = useMemo(() => {
    if (!from || !to) return "Choose both dates.";
    if (from > to) return "The start date must come before the end date.";
    if (to > TODAY) return "The end date can’t be in the future.";
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (days > 366) return "Statements cover at most 366 days.";
    return null;
  }, [from, to]);

  async function submit() {
    setError(null);
    setSending(true);
    try {
      const res = await api.requestStatement({ from, to, format });
      setSent({ email: res.email, count: res.count });
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Couldn’t send your statement. Please try again."
      );
    } finally {
      setSending(false);
    }
  }

  const pickPreset = (days: number) => {
    setFrom(isoDaysAgo(days));
    setTo(TODAY);
    setSent(null);
  };

  const inputCls =
    "w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink outline-none focus:border-brand";

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-6 pt-3">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Go back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <h1 className="mt-4 text-3xl font-extrabold text-ink">Account statement</h1>
        <p className="mt-1 text-sm text-muted">
          Pick a period and a format — we’ll email it to you.
        </p>

        {available === false ? (
          <div className="mt-10 flex flex-col items-center text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-circle">
              <Mail className="h-7 w-7 text-brand-light" />
            </span>
            <p className="mt-4 text-lg font-bold text-ink">Coming soon</p>
            <p className="mt-1 max-w-[300px] text-sm text-muted">
              Emailed statements aren’t switched on yet. You can still download your history
              from Wallet statement.
            </p>
            <button
              onClick={() => router.replace("/wallet-statement")}
              className="mt-5 rounded-full bg-card px-5 py-3 text-sm font-bold text-ink"
            >
              Go to Wallet statement
            </button>
          </div>
        ) : sent ? (
          <div className="mt-10 flex flex-col items-center text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15">
              <Mail className="h-7 w-7 text-green-400" />
            </span>
            <p className="mt-4 text-lg font-bold text-ink">Statement on its way</p>
            <p className="mt-1 max-w-[300px] text-sm text-muted">
              We’ve emailed {sent.count} transaction{sent.count === 1 ? "" : "s"} to{" "}
              <span className="font-semibold text-ink">{sent.email}</span>. It can take a
              minute to arrive — check spam if you don’t see it.
            </p>
            <button
              onClick={() => setSent(null)}
              className="mt-5 rounded-full bg-card px-5 py-3 text-sm font-bold text-ink"
            >
              Request another
            </button>
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              {PRESETS.map((p) => {
                const activePreset = from === isoDaysAgo(p.days) && to === TODAY;
                return (
                  <button
                    key={p.label}
                    onClick={() => pickPreset(p.days)}
                    className={`rounded-full px-3.5 py-2 text-xs font-bold transition-colors ${
                      activePreset
                        ? "bg-brand text-white"
                        : "bg-card text-muted hover:text-ink"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="from" className="mb-1.5 block text-sm font-semibold text-muted">
                  From
                </label>
                <input
                  id="from"
                  type="date"
                  value={from}
                  max={TODAY}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setSent(null);
                  }}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="to" className="mb-1.5 block text-sm font-semibold text-muted">
                  To
                </label>
                <input
                  id="to"
                  type="date"
                  value={to}
                  max={TODAY}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setSent(null);
                  }}
                  className={inputCls}
                />
              </div>
            </div>

            <p className="mt-5 mb-2 text-sm font-semibold text-muted">Format</p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { id: "pdf", label: "PDF", hint: "Best for printing", icon: FileText },
                  { id: "csv", label: "CSV", hint: "Open in a spreadsheet", icon: Sheet },
                ] as const
              ).map((f) => {
                const Icon = f.icon;
                const chosen = format === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => {
                      setFormat(f.id);
                      setSent(null);
                    }}
                    aria-pressed={chosen}
                    className={`flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-colors ${
                      chosen
                        ? "border-brand bg-brand/10"
                        : "border-border bg-card hover:border-brand-light/40"
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${chosen ? "text-brand-light" : "text-muted"}`} />
                    <span className="font-bold text-ink">{f.label}</span>
                    <span className="text-xs text-muted">{f.hint}</span>
                  </button>
                );
              })}
            </div>

            {(error || rangeError) && (
              <p className="mt-4 text-sm text-red-400">{error ?? rangeError}</p>
            )}

            <div className="mt-auto pt-6">
              <button
                onClick={submit}
                disabled={!!rangeError || sending || available === null}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand to-brand-light py-4 text-base font-bold text-white active:scale-[0.98] disabled:opacity-50"
              >
                {sending && <Loader2 className="h-5 w-5 animate-spin" />}
                {sending ? "Sending…" : "Email me the statement"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
