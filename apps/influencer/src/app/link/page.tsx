"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Check, Copy, Download, Loader2, Share2 } from "lucide-react";
import Shell from "@/components/Shell";
import { api, type Dashboard } from "@/lib/api";

const CAPTIONS = (code: string, link: string) => [
  `I use CheqPay to send money, pay bills and buy crypto from one Naira balance. Join with my code ${code} 👉 ${link}`,
  `Stop juggling five apps. CheqPay does transfers, airtime, data, bills and crypto in one place. Sign up with ${code}: ${link}`,
  `Need a dollar card for online shopping? CheqPay has you covered. Use my code ${code} when you join → ${link}`,
];

export default function LinkPage() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const qr = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.dashboard().then(setD).catch(() => undefined);
  }, []);

  const copy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  function downloadQr() {
    const canvas = qr.current?.querySelector("canvas");
    if (!canvas || !d) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `cheqpay-${d.code}-qr.png`;
    a.click();
  }

  return (
    <Shell>
      {!d ? (
        <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-5">
            <div className="card">
              <p className="font-bold">Your tracking link</p>
              <p className="mt-1 text-sm text-muted">Every click is counted, and everyone who signs up through it is yours.</p>
              <div className="mt-4 flex gap-2">
                <input readOnly value={d.link} className="input min-w-0 flex-1 font-mono text-sm" />
                <button onClick={() => copy("link", d.link)} className="btn !px-4">{copied === "link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>
                <button
                  onClick={() => (navigator.share ? navigator.share({ title: "Join CheqPay", url: d.link }).catch(() => undefined) : copy("link", d.link))}
                  className="btn-ghost !px-4"
                  aria-label="Share"
                >
                  <Share2 className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-3 text-sm text-muted">Or ask followers to enter <b className="font-mono text-ink">{d.code}</b> when they sign up.</p>
            </div>

            <div className="card">
              <p className="font-bold">Caption ideas</p>
              <div className="mt-3 space-y-3">
                {CAPTIONS(d.code, d.link).map((c, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-2xl bg-circle p-4">
                    <p className="min-w-0 flex-1 text-sm leading-relaxed [overflow-wrap:anywhere]">{c}</p>
                    <button onClick={() => copy(`c${i}`, c)} className="shrink-0 text-muted hover:text-ink" aria-label="Copy caption">
                      {copied === `c${i}` ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <p className="font-bold">Brand assets</p>
              <p className="mt-1 text-sm text-muted">Use our logo as is — please don&apos;t change its colours or stretch it.</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { src: "/icon.png", name: "cheqpay-icon.png", label: "App icon" },
                  { src: "/logo.png", name: "cheqpay-logo.png", label: "Logo" },
                ].map((a) => (
                  <a key={a.src} href={a.src} download={a.name} className="flex flex-col items-center gap-3 rounded-2xl bg-circle p-4 hover:bg-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.src} alt={a.label} className="h-16 object-contain" />
                    <span className="inline-flex items-center gap-1 text-sm font-semibold"><Download className="h-4 w-4" /> {a.label}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="card h-fit text-center">
            <p className="font-bold">QR code</p>
            <p className="mt-1 text-sm text-muted">For flyers, events and stories.</p>
            <div ref={qr} className="mx-auto mt-4 w-fit rounded-2xl bg-white p-3">
              <QRCodeCanvas value={d.link} size={220} level="M" marginSize={1} imageSettings={{ src: "/icon.png", height: 44, width: 44, excavate: true }} />
            </div>
            <button onClick={downloadQr} className="btn mt-4 w-full"><Download className="h-4 w-4" /> Download PNG</button>
          </div>
        </div>
      )}
    </Shell>
  );
}
