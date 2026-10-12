"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RotateCw, Send, Trash2 } from "lucide-react";
import { SUBSCRIBABLE_EVENT_TYPES } from "@cheqpay/devapi";
import { useDash } from "@/components/DashShell";
import { useStepUp } from "@/components/StepUp";
import { Empty, ErrorNote, PageTitle, SecretOnce, Status, errText } from "@/components/ui";
import { dash, type Delivery, type Endpoint } from "@/lib/api";
import { when } from "@/lib/format";

export default function WebhooksPage() {
  const { mode } = useDash();
  const { run } = useStepUp();
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEndpoints((await dash.endpoints()).endpoints);
    } catch (err) {
      setError(errText(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await run(fn);
      await load();
    } catch (err) {
      setError(errText(err));
    }
  };

  const shown = (endpoints ?? []).filter((e) => e.mode === mode);
  return (
    <>
      <PageTitle
        title="Webhooks"
        subtitle={<>Where CheqPay sends {mode} events. See <Link className="link" href="/docs/webhooks/">verifying signatures</Link>.</>}
        action={!creating && <button onClick={() => setCreating(true)} className="btn !h-11"><Plus className="h-5 w-5" /> Add endpoint</button>}
      />
      {secret && <SecretOnce label="Your endpoint's signing secret" secret={secret} onDone={() => setSecret(null)} />}
      {creating && (
        <NewEndpoint
          onCancel={() => setCreating(false)}
          onCreate={async (b) => {
            const r = await run(() => dash.createEndpoint({ mode, ...b }));
            if (!r) return;
            setCreating(false);
            setSecret(r.secret);
            await load();
          }}
        />
      )}
      <ErrorNote error={error} />
      {!endpoints ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      ) : shown.length === 0 ? (
        <Empty>No {mode} endpoints. Events are still kept for 30 days at GET /v1/events.</Empty>
      ) : (
        <div className="space-y-3">
          {shown.map((e) => (
            <div key={e.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><code className="break-all font-mono text-[14px] font-semibold">{e.url}</code><Status value={e.status} /></div>
                  {e.description && <p className="footnote mt-0.5">{e.description}</p>}
                  <p className="footnote mt-1">Events: {e.events.join(", ")}</p>
                  {e.disabled_reason && <p className="footnote text-bad">{e.disabled_reason}</p>}
                  {e.failing_since && <p className="footnote text-warn">Failing since {when(e.failing_since)}</p>}
                  {e.previous_secret_valid_until && <p className="footnote">The previous secret also signs until {when(e.previous_secret_valid_until)}.</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-tinted !h-10 !px-4 text-[15px]" onClick={() => act(() => dash.testEndpoint(e.id))}><Send className="h-4 w-4" /> Test</button>
                  <button className="btn-ghost !h-10 !px-4 text-[15px]" onClick={() => setOpen(open === e.id ? null : e.id)}>Deliveries</button>
                  <button className="btn-ghost !h-10 !px-4 text-[15px]" onClick={() => act(() => dash.updateEndpoint(e.id, { enabled: e.status !== "enabled" }))}>
                    {e.status === "enabled" ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="btn-ghost !h-10 !px-4 text-[15px]"
                    onClick={async () => {
                      if (!window.confirm("Roll the signing secret? The old one keeps signing for 24 hours.")) return;
                      setError(null);
                      try {
                        const r = await run(() => dash.rollEndpoint(e.id));
                        if (r) setSecret(r.secret);
                        await load();
                      } catch (err) {
                        setError(errText(err));
                      }
                    }}
                  >
                    <RotateCw className="h-4 w-4" /> Roll secret
                  </button>
                  <button className="btn-ghost !h-10 !px-4 text-[15px] !text-bad" onClick={() => window.confirm("Delete this endpoint?") && act(() => dash.deleteEndpoint(e.id))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {open === e.id && <Deliveries endpointId={e.id} />}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function NewEndpoint({ onCancel, onCreate }: { onCancel: () => void; onCreate: (b: { url: string; events: string[]; description?: string }) => Promise<void> }) {
  const [url, setUrl] = useState("https://");
  const [all, setAll] = useState(true);
  const [events, setEvents] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card mb-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onCreate({ url: url.trim(), events: all ? ["*"] : events, ...(description.trim() ? { description: description.trim() } : {}) });
        } catch (err) {
          setError(errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="headline">New endpoint</h2>
      <label className="label mt-4" htmlFor="wu">URL</label>
      <input id="wu" className="input font-mono text-[15px]" value={url} onChange={(e) => setUrl(e.target.value)} />
      <p className="footnote mt-1 px-1">A public https address on port 443.</p>
      <label className="label mt-4" htmlFor="wd">Description (optional)</label>
      <input id="wd" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={100} />
      <div className="label mt-4">Events</div>
      <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Every event</label>
      {!all && (
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {SUBSCRIBABLE_EVENT_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-2 font-mono text-[13px]">
              <input type="checkbox" checked={events.includes(t)} onChange={() => setEvents((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))} /> {t}
            </label>
          ))}
        </div>
      )}
      <ErrorNote error={error} />
      <div className="mt-5 flex gap-2">
        <button disabled={busy || !/^https:\/\/.+/.test(url) || (!all && events.length === 0)} className="btn !h-11">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Add endpoint"}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost !h-11">Cancel</button>
      </div>
    </form>
  );
}

function Deliveries({ endpointId }: { endpointId: string }) {
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setRows((await dash.deliveries(endpointId)).deliveries);
    } catch (err) {
      setError(errText(err));
    }
  }, [endpointId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <ErrorNote error={error} />;
  if (!rows) return <Loader2 className="mt-4 h-5 w-5 animate-spin text-muted" />;
  if (!rows.length) return <p className="footnote mt-4">No deliveries yet.</p>;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="table">
        <thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Last answer</th><th>When</th><th /></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td className="font-mono text-[13px]">{d.event_type}</td>
              <td><Status value={d.status} /></td>
              <td>{d.attempts}</td>
              <td className="text-[13px]">{d.last_status_code ?? d.last_error ?? "—"}</td>
              <td className="whitespace-nowrap text-[13px]">{when(d.delivered_at ?? d.created_at)}</td>
              <td>
                {d.status !== "pending" && (
                  <button
                    className="link text-[13px]"
                    onClick={async () => {
                      try {
                        await dash.resend(d.id);
                        await load();
                      } catch (err) {
                        setError(errText(err));
                      }
                    }}
                  >
                    Resend
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
