"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RotateCw, Trash2 } from "lucide-react";
import { DEFAULT_SCOPES, SCOPES } from "@cheqpay/devapi";
import { useDash } from "@/components/DashShell";
import { useStepUp } from "@/components/StepUp";
import { Empty, ErrorNote, PageTitle, SecretOnce, Status, errText } from "@/components/ui";
import { dash, type Key } from "@/lib/api";
import { when } from "@/lib/format";

export default function KeysPage() {
  const { mode, account, reload } = useDash();
  const { run } = useStepUp();
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setKeys((await dash.keys()).keys);
    } catch (err) {
      setError(errText(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = (keys ?? []).filter((k) => k.mode === mode);

  return (
    <>
      <PageTitle
        title="API keys"
        subtitle={mode === "test" ? "Test keys work on simulated money only." : "Live keys move real money. Keep them on your servers."}
        action={!creating && <button onClick={() => setCreating(true)} className="btn !h-11"><Plus className="h-5 w-5" /> New {mode} key</button>}
      />
      {secret && <SecretOnce label={`Your new key: ${secret.label}`} secret={secret.value} onDone={() => setSecret(null)} />}
      {creating && (
        <NewKey
          mode={mode}
          requireIps={account.require_ip_allowlist}
          onCancel={() => setCreating(false)}
          onCreate={async (b) => {
            const r = await run(() => dash.createKey(b));
            if (!r) return;
            setCreating(false);
            setSecret({ label: r.key.label, value: r.secret });
            await load();
            await reload();
          }}
        />
      )}
      <ErrorNote error={error} />
      {!keys ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      ) : shown.length === 0 ? (
        <Empty>No {mode} keys yet.</Empty>
      ) : (
        <div className="space-y-3">
          {shown.map((k) => (
            <div key={k.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="headline">{k.label}</span><Status value={k.state} /></div>
                  <code className="footnote font-mono">{k.preview}</code>
                  <p className="footnote mt-1">
                    Created {when(k.created_at)} · Last used {k.last_used_at ? `${when(k.last_used_at)} from ${k.last_used_ip ?? "?"}` : "never"}
                    {k.expires_at && k.state === "active" ? ` · Stops working ${when(k.expires_at)}` : ""}
                  </p>
                  <p className="footnote mt-1">Scopes: {k.scopes.join(", ")}</p>
                  {k.allowed_ips.length > 0 && <p className="footnote">Allowed IPs: {k.allowed_ips.join(", ")}</p>}
                </div>
                {k.state === "active" && (
                  <div className="flex gap-2">
                    <button
                      className="btn-tinted !h-10 !px-4 text-[15px]"
                      onClick={async () => {
                        const hours = window.prompt("Roll this key. Keep the old one working for how many hours (0-24)?", "1");
                        if (hours === null) return;
                        try {
                          const r = await run(() => dash.rollKey(k.id, Math.max(0, Math.min(24, Number(hours) || 0))));
                          if (r) setSecret({ label: r.key.label, value: r.secret });
                          await load();
                        } catch (err) {
                          setError(errText(err));
                        }
                      }}
                    >
                      <RotateCw className="h-4 w-4" /> Roll
                    </button>
                    <button
                      className="btn-ghost !h-10 !px-4 text-[15px] !text-bad"
                      onClick={async () => {
                        if (!window.confirm(`Revoke "${k.label}"? It stops working within seconds.`)) return;
                        try {
                          await run(() => dash.revokeKey(k.id));
                          await load();
                        } catch (err) {
                          setError(errText(err));
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" /> Revoke
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function NewKey({
  mode,
  requireIps,
  onCancel,
  onCreate,
}: {
  mode: "test" | "live";
  requireIps: boolean;
  onCancel: () => void;
  onCreate: (b: { mode: "test" | "live"; label: string; scopes: string[]; allowed_ips: string[] }) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<string[]>([...DEFAULT_SCOPES]);
  const [ips, setIps] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setScopes((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <form
      className="card mb-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onCreate({ mode, label: label.trim(), scopes, allowed_ips: ips.split(/[\s,]+/).filter(Boolean) });
        } catch (err) {
          setError(errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="headline">New {mode} key</h2>
      <label className="label mt-4" htmlFor="kl">Name</label>
      <input id="kl" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production server" maxLength={60} />
      <div className="label mt-5">Scopes</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {SCOPES.map((s) => (
          <label key={s.id} className="flex cursor-pointer items-start gap-3 rounded-xl bg-circle px-3 py-2.5">
            <input type="checkbox" className="mt-1" checked={scopes.includes(s.id)} onChange={() => toggle(s.id)} />
            <span>
              <span className="font-mono text-[13px]">{s.id}</span>
              <span className="block text-[13px] text-muted">{s.description}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="label mt-5" htmlFor="ips">Allowed IP addresses {mode === "live" && (requireIps || scopes.includes("cards:details")) ? "(required)" : "(optional)"}</label>
      <input id="ips" className="input font-mono text-[15px]" value={ips} onChange={(e) => setIps(e.target.value)} placeholder="203.0.113.10, 203.0.113.0/28" />
      <ErrorNote error={error} />
      <div className="mt-5 flex gap-2">
        <button disabled={busy || !label.trim() || scopes.length === 0} className="btn !h-11">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create key"}</button>
        <button type="button" onClick={onCancel} className="btn-ghost !h-11">Cancel</button>
      </div>
    </form>
  );
}
