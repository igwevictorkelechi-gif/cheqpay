"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useDash } from "@/components/DashShell";
import { Empty, ErrorNote, PageTitle, Status, errText } from "@/components/ui";
import { dash, type Row } from "@/lib/api";
import { money, when } from "@/lib/format";

type Tab = "transactions" | "customers" | "virtual-accounts" | "wallets" | "events" | "requests";

const TABS: { id: Tab; label: string }[] = [
  { id: "transactions", label: "Transactions" },
  { id: "customers", label: "Customers" },
  { id: "virtual-accounts", label: "Virtual accounts" },
  { id: "wallets", label: "Wallets" },
  { id: "events", label: "Events" },
  { id: "requests", label: "Request log" },
];

const COLUMNS: Record<Exclude<Tab, "requests">, { head: string; cell: (r: Row) => React.ReactNode }[]> = {
  transactions: [
    { head: "Kind", cell: (r) => r.kind.replace(/_/g, " ") },
    { head: "Amount", cell: (r) => money(r.amount, r.currency) },
    { head: "Fee", cell: (r) => (r.fee ? money(r.fee, r.currency) : "—") },
    { head: "Status", cell: (r) => <Status value={r.status} /> },
    { head: "Reference", cell: (r) => r.reference ?? "—" },
    { head: "Id", cell: (r) => <code className="font-mono text-[12px]">{r.id}</code> },
    { head: "When", cell: (r) => when(r.created_at) },
  ],
  customers: [
    { head: "Name", cell: (r) => `${r.first_name ?? ""} ${r.last_name ?? ""}` },
    { head: "Email", cell: (r) => r.email },
    { head: "Verification", cell: (r) => <Status value={r.kyc?.status ?? "pending"} /> },
    { head: "Id", cell: (r) => <code className="font-mono text-[12px]">{r.id}</code> },
    { head: "Created", cell: (r) => when(r.created_at) },
  ],
  "virtual-accounts": [
    { head: "Account", cell: (r) => r.account_number ?? "—" },
    { head: "Bank", cell: (r) => r.bank_name ?? "—" },
    { head: "Name", cell: (r) => r.account_name ?? "—" },
    { head: "Status", cell: (r) => <Status value={r.status} /> },
    { head: "Id", cell: (r) => <code className="font-mono text-[12px]">{r.id}</code> },
  ],
  wallets: [
    { head: "Type", cell: (r) => r.type },
    { head: "Currency", cell: (r) => r.currency },
    { head: "Balance", cell: (r) => money(r.available_balance, r.currency) },
    { head: "Status", cell: (r) => <Status value={r.status} /> },
    { head: "Customer", cell: (r) => (r.customer_id ? <code className="font-mono text-[12px]">{r.customer_id}</code> : "—") },
    { head: "Id", cell: (r) => <code className="font-mono text-[12px]">{r.id}</code> },
  ],
  events: [
    { head: "Type", cell: (r) => <code className="font-mono text-[13px]">{r.type}</code> },
    { head: "Id", cell: (r) => <code className="font-mono text-[12px]">{r.id}</code> },
    { head: "When", cell: (r) => when(r.created_at) },
  ],
};

export default function ActivityPage() {
  const { mode } = useDash();
  const [tab, setTab] = useState<Tab>("transactions");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after?: string) => {
      setError(null);
      try {
        if (tab === "requests") {
          setRows((await dash.requestLogs(mode, errorsOnly)).logs);
          setHasMore(false);
          return;
        }
        const page = await dash.list(tab, mode, after);
        setRows((prev) => (after && prev ? [...prev, ...page.data] : page.data));
        setHasMore(page.has_more);
      } catch (err) {
        setError(errText(err));
      }
    },
    [tab, mode, errorsOnly],
  );

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  return (
    <>
      <PageTitle title="Activity" subtitle={`Everything in ${mode} mode, newest first.`} />
      <div className="mb-5 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`chip !min-h-[36px] text-[14px] ${tab === t.id ? "chip-on" : ""}`}>{t.label}</button>
        ))}
      </div>
      {tab === "requests" && (
        <label className="mb-3 flex items-center gap-2 text-[15px]"><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Errors only</label>
      )}
      <ErrorNote error={error} />
      {!rows ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      ) : rows.length === 0 ? (
        <Empty>Nothing here yet.</Empty>
      ) : tab === "requests" ? (
        <div className="overflow-x-auto rounded-2xl bg-card shadow-card ring-1 ring-border/40">
          <table className="table">
            <thead><tr><th>Request</th><th>Status</th><th>Error</th><th>Why refused</th><th>IP</th><th>When</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap font-mono text-[12px]">{r.method} {r.path}</td>
                  <td className={r.status >= 400 ? "text-bad" : "text-good"}>{r.status}</td>
                  <td className="font-mono text-[12px]">{r.error_code ?? "—"}</td>
                  <td className="text-[13px]">{r.auth_failure ?? "—"}</td>
                  <td className="font-mono text-[12px]">{r.ip ?? "—"}</td>
                  <td className="whitespace-nowrap text-[13px]">{when(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl bg-card shadow-card ring-1 ring-border/40">
            <table className="table">
              <thead><tr>{COLUMNS[tab].map((c) => <th key={c.head}>{c.head}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>{COLUMNS[tab].map((c) => <td key={c.head} className="text-[14px]">{c.cell(r)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && <button onClick={() => load(rows[rows.length - 1]?.id)} className="btn-tinted mt-4 !h-11">Load more</button>}
        </>
      )}
    </>
  );
}
