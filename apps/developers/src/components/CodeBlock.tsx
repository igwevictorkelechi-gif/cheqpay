"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** A block of code with a copy button. */
export default function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative my-4">
      {label && <div className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</div>}
      <pre className="code"><code>{code}</code></pre>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(code).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/80 opacity-0 transition hover:bg-white/20 group-hover:opacity-100 focus:opacity-100"
        style={label ? { top: "2.1rem" } : undefined}
        aria-label="Copy"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
