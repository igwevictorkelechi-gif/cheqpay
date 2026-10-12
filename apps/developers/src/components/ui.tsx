"use client";

import { useState } from "react";
import { Check, Copy, Eye } from "lucide-react";

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="title">{title}</h1>
        {subtitle && <p className="subhead mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A secret shown exactly once, with a copy button. */
export function SecretOnce({ label, secret, onDone }: { label: string; secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card mb-6 ring-2 ring-warn/40">
      <div className="flex items-center gap-2 text-warn"><Eye className="h-5 w-5" /><span className="headline !text-warn">{label}</span></div>
      <p className="subhead mt-1">Copy it now and store it in your server&apos;s secret manager. It won&apos;t be shown again.</p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-xl bg-circle px-3 py-2.5 font-mono text-[13px]">{secret}</code>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(secret).catch(() => undefined);
            setCopied(true);
          }}
          className="btn-tinted !h-11 !px-4"
          aria-label="Copy"
        >
          {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
        </button>
      </div>
      <button onClick={onDone} className="btn mt-4 !h-11">I&apos;ve stored it</button>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-[15px] text-muted">{children}</div>;
}

const TONES: Record<string, string> = {
  good: "bg-good/15 text-good",
  warn: "bg-warn/15 text-warn",
  bad: "bg-bad/15 text-bad",
  muted: "bg-circle text-muted",
};

export function Status({ value }: { value: string }) {
  const tone =
    /^(active|successful|verified|enabled|succeeded|approved|open)$/.test(value)
      ? "good"
      : /^(pending|pending_review|sandbox|creating|past_due)$/.test(value)
        ? "warn"
        : /^(failed|rejected|revoked|disabled|frozen|suspended|expired|canceled)$/.test(value)
          ? "bad"
          : "muted";
  return <span className={`pill ${TONES[tone]}`}>{value.replace(/_/g, " ")}</span>;
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <p className="notice-bad mt-3" role="alert">{error}</p> : null;
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
