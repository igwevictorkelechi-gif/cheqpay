"use client";

/**
 * The first screen after opening a developer account: a test key, a command
 * with that key already in it, and a live "waiting for your first request"
 * line that turns green when the call lands.
 *
 * Time to a first successful call is what decides whether a developer stays,
 * so this page exists to make it a paste-and-run.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CheckCircle2, Copy, Eye, KeyRound, Loader2, AlertTriangle } from "lucide-react";
import { DEFAULT_SCOPES } from "@cheqpay/devapi";
import CodeBlock from "@/components/CodeBlock";
import { useDash } from "@/components/DashShell";
import { useStepUp } from "@/components/StepUp";
import { ErrorNote, PageTitle, errText } from "@/components/ui";
import { PUBLIC_API, dash, type Row } from "@/lib/api";
import { takeFirstKey } from "@/lib/firstKey";

const POLL_MS = 3_000;
/** Stop asking after a while; a button resumes. A forgotten tab shouldn't poll forever. */
const GIVE_UP_MS = 15 * 60_000;

/** Why a key was refused, in plain words. The API itself only ever says invalid_api_key. */
const REFUSALS: Record<string, string> = {
  revoked: "that key has been revoked",
  expired: "that key has expired",
  ip_not_allowed: "the request came from an IP address the key doesn't allow",
  account_suspended: "this account is suspended",
};

function describeFailure(r: Row): string {
  if (r.auth_failure) return REFUSALS[r.auth_failure] ?? `the key was refused (${r.auth_failure})`;
  if (r.error_code) return `the API answered ${r.status} ${r.error_code}`;
  return `the API answered ${r.status}`;
}

export default function FirstCallPage() {
  const { reload } = useDash();
  const { run } = useStepUp();
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Row | null>(null);
  const [failure, setFailure] = useState<Row | null>(null);
  const [watching, setWatching] = useState(true);
  const startedAt = useRef(Date.now());

  // The key made when the account was opened, if we came straight from there.
  useEffect(() => {
    setSecret(takeFirstKey());
  }, []);

  const check = useCallback(async () => {
    try {
      const { logs } = await dash.requestLogs("test", false);
      const ok = logs.find((r) => r.status < 400);
      if (ok) {
        setSuccess(ok);
        setWatching(false);
        await reload(); // ticks "First API call" on the overview
        return;
      }
      setFailure(logs[0] ?? null);
    } catch {
      // A missed poll is fine; the next one will try again.
    }
  }, [reload]);

  useEffect(() => {
    if (!watching) return;
    void check();
    const t = setInterval(() => {
      if (Date.now() - startedAt.current > GIVE_UP_MS) {
        setWatching(false);
        return;
      }
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [watching, check]);

  async function makeKey() {
    setMaking(true);
    setError(null);
    try {
      const r = await run(() =>
        dash.createKey({ mode: "test", label: "First call key", scopes: [...DEFAULT_SCOPES], allowed_ips: [] }),
      );
      if (r) setSecret(r.secret);
    } catch (err) {
      setError(errText(err));
    } finally {
      setMaking(false);
    }
  }

  const keyText = secret ?? "cp_test_sk_…";
  const curl = `curl ${PUBLIC_API}/account \\\n  -H "Authorization: Bearer ${keyText}"`;
  const node = `const res = await fetch("${PUBLIC_API}/account", {\n  headers: { Authorization: "Bearer ${keyText}" },\n});\nconsole.log(await res.json());`;

  return (
    <>
      <PageTitle
        title="Make your first API call"
        subtitle="Test mode only touches simulated money, so nothing here can go wrong."
      />

      <section className="max-w-3xl space-y-6">
        {/* 1. The key */}
        <div className="card">
          <h2 className="headline flex items-center gap-2"><KeyRound className="h-5 w-5" /> 1. Your test key</h2>
          {secret ? (
            <>
              <p className="subhead mt-1 flex items-center gap-1.5 text-warn">
                <Eye className="h-4 w-4" /> Copy it now. It won&apos;t be shown again.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-xl bg-circle px-3 py-2.5 font-mono text-[13px]">{secret}</code>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(secret).catch(() => undefined);
                    setCopied(true);
                  }}
                  className="btn-tinted !h-11 !px-4"
                  aria-label="Copy key"
                >
                  {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                </button>
              </div>
              <p className="footnote mt-2">Keep it on your server, never in a browser or an app. You can revoke it any time on <Link className="link" href="/dashboard/keys/">API keys</Link>.</p>
            </>
          ) : (
            <>
              <p className="subhead mt-1">
                Secret keys are only shown once, when they&apos;re made. Make one for this page, or paste a test key you already have into the command below.
              </p>
              <button onClick={makeKey} disabled={making} className="btn mt-4 !h-11">
                {making ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create a test key"}
              </button>
            </>
          )}
        </div>

        {/* 2. The command */}
        <div className="card">
          <h2 className="headline">2. Run this</h2>
          <p className="subhead mt-1">It asks the API who this key belongs to. It reads only; it moves nothing.</p>
          <CodeBlock label="Shell" code={curl} />
          <CodeBlock label="Node.js" code={node} />
        </div>

        {/* 3. Did it land? */}
        <div className="card" aria-live="polite">
          <h2 className="headline">3. We&apos;ll tick this off when it arrives</h2>
          {success ? (
            <div className="mt-3">
              <p className="flex items-center gap-2 font-semibold text-good">
                <CheckCircle2 className="h-5 w-5" /> It worked.
              </p>
              <p className="footnote mt-1 font-mono">
                {success.method} {success.path} · {success.status} · {success.duration_ms} ms
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Link href="/docs/quickstart/" className="group-row rounded-xl bg-circle/50 hover:bg-circle">
                  <span className="flex-1">Next: create a customer and pay a bill</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/dashboard/webhooks/" className="group-row rounded-xl bg-circle/50 hover:bg-circle">
                  <span className="flex-1">Set up a webhook</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : failure ? (
            <div className="mt-3">
              <p className="flex items-center gap-2 font-semibold text-warn">
                <AlertTriangle className="h-5 w-5" /> We saw a request, but {describeFailure(failure)}.
              </p>
              <p className="footnote mt-1 font-mono">{failure.method} {failure.path} · {failure.status}</p>
              <p className="footnote mt-2">Fix that and run it again — this updates by itself.</p>
            </div>
          ) : watching ? (
            <p className="mt-3 flex items-center gap-2 subhead">
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for your first request…
            </p>
          ) : (
            <div className="mt-3">
              <p className="subhead">Nothing has arrived yet. If you ran it, check the whole key was copied — a key we don&apos;t recognise can&apos;t be traced to your account.</p>
              <button
                onClick={() => {
                  startedAt.current = Date.now();
                  setWatching(true);
                }}
                className="btn-tinted mt-3 !h-10"
              >
                Keep watching
              </button>
            </div>
          )}
        </div>

        <ErrorNote error={error} />
      </section>
    </>
  );
}
