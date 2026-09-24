"use client";

// Makes the backend's step-up rules usable on every page at once.
//
// After the 22 Sep incident the backend asks for more before it will do
// anything that moves money or grants trust: a fresh authenticator code, a
// reason, the on-chain hash of a manual payout. Rather than teach every page
// each rule, this wraps the dashboard's own /api calls. When the backend answers
// "I need X", it asks the admin for X and sends the same request again with it.
// When the backend says the session was revoked ("sign out everywhere", a
// password change, an authenticator reset), it goes to the login page.
//
// Scope is deliberately narrow: same-origin /api/* requests only, never the
// login endpoint, and only bodies that are plain strings (every page sends
// JSON.stringify(...)) are rewritten, so nothing it cannot safely resend is ever
// resent.

import { useEffect, useRef, useState } from "react";
import { KeyRound, ShieldAlert, X } from "lucide-react";

type Kind = "otp" | "reason" | "txHash";

interface Field {
  kind: Kind;
  where: "header" | "body";
  key: string;
  title: string;
  hint: string;
}

const FIELDS: Record<string, Field> = {
  otp_required: {
    kind: "otp",
    where: "header",
    key: "x-admin-otp",
    title: "Confirm with your authenticator",
    hint: "Enter the 6-digit code from your authenticator app. Each code works once.",
  },
  bad_otp: {
    kind: "otp",
    where: "header",
    key: "x-admin-otp",
    title: "That code didn't work",
    hint: "Codes can only be used once and change every 30 seconds. Enter the next one.",
  },
  reason_required: {
    kind: "reason",
    where: "body",
    key: "reason",
    title: "Why are you doing this?",
    hint: "This goes on the audit record and in the security alert. At least 10 characters.",
  },
  tx_hash_required: {
    kind: "txHash",
    where: "body",
    key: "txHash",
    title: "Paste the payout transaction hash",
    hint: "Send the funds from the business wallet first, then paste the transaction hash from the block explorer.",
  },
};

interface Ask {
  field: Field;
  message?: string;
  resolve: (v: string | null) => void;
}

const MAX_ROUNDS = 4;

export default function SecurityGate() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [value, setValue] = useState("");
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const w = window as typeof window & { __cheqpaySecurityGate?: boolean };
    if (w.__cheqpaySecurityGate) return;
    w.__cheqpaySecurityGate = true;

    const original = window.fetch.bind(window);

    // One question on screen at a time; later ones wait their turn.
    const prompt = (field: Field, message?: string) => {
      const next = chain.current.then(
        () =>
          new Promise<string | null>((resolve) => {
            setValue("");
            setAsk({ field, message, resolve });
          }),
      );
      chain.current = next.catch(() => undefined);
      return next;
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input !== "string" && !(input instanceof URL)) return original(input, init);
      const url = input instanceof URL ? input.href : input;
      const path = url.startsWith(window.location.origin) ? url.slice(window.location.origin.length) : url;
      if (!path.startsWith("/api/") || path.startsWith("/api/auth")) return original(input, init);

      let attempt: RequestInit = { ...(init ?? {}) };
      let res = await original(input, attempt);

      for (let round = 0; round < MAX_ROUNDS && !res.ok; round++) {
        if (![401, 403, 422].includes(res.status)) return res;
        const body = (await res.clone().json().catch(() => null)) as { code?: string; error?: string } | null;

        if (
          res.status === 401 &&
          (body?.code === "admin_session_revoked" ||
            body?.code === "admin_identity_required" ||
            body?.error === "Unauthorized")
        ) {
          window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
          return res;
        }

        const field = body?.code ? FIELDS[body.code] : undefined;
        if (!field) return res;
        if (field.where === "body" && attempt.body !== undefined && typeof attempt.body !== "string") return res;

        const answer = await prompt(field, body?.error);
        if (answer === null) return res;

        if (field.where === "header") {
          const headers = new Headers(attempt.headers);
          headers.set(field.key, answer);
          attempt = { ...attempt, headers };
        } else {
          let payload: Record<string, unknown> = {};
          try {
            payload = attempt.body ? (JSON.parse(attempt.body as string) as Record<string, unknown>) : {};
          } catch {
            return res;
          }
          payload[field.key] = answer;
          const headers = new Headers(attempt.headers);
          if (!headers.has("content-type")) headers.set("content-type", "application/json");
          attempt = { ...attempt, headers, body: JSON.stringify(payload) };
        }
        res = await original(input, attempt);
      }
      return res;
    };
  }, []);

  if (!ask) return null;

  const { field } = ask;
  const valid =
    field.kind === "otp" ? /^\d{6}$/.test(value) : field.kind === "reason" ? value.trim().length >= 10 : value.trim().length >= 40;

  const finish = (v: string | null) => {
    ask.resolve(v);
    setAsk(null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) finish(field.kind === "otp" ? value : value.trim());
        }}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
            {field.kind === "otp" ? <KeyRound size={20} /> : <ShieldAlert size={20} />}
          </span>
          <button type="button" onClick={() => finish(null)} className="text-gray-400 hover:text-gray-600" aria-label="Cancel">
            <X size={18} />
          </button>
        </div>
        <h2 className="text-base font-semibold text-gray-900">{field.title}</h2>
        <p className="mt-1 text-sm text-gray-500">{field.hint}</p>
        {ask.message && field.kind !== "otp" ? (
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{ask.message}</p>
        ) : null}

        {field.kind === "reason" ? (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, 500))}
            rows={3}
            autoFocus
            className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        ) : (
          <input
            value={value}
            onChange={(e) =>
              setValue(field.kind === "otp" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value.trim())
            }
            inputMode={field.kind === "otp" ? "numeric" : "text"}
            autoComplete={field.kind === "otp" ? "one-time-code" : "off"}
            placeholder={field.kind === "otp" ? "123456" : "0x… / transaction hash"}
            autoFocus
            className={
              "mt-4 w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 " +
              (field.kind === "otp" ? "text-center font-mono text-lg tracking-[0.4em]" : "font-mono text-xs")
            }
          />
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => finish(null)}
            className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="flex-1 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      </form>
    </div>
  );
}
