import type { Metadata } from "next";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import NotFoundActions from "@/components/NotFoundActions";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

/**
 * 404, drawn as a Wi-Fi signal that can't find the network: the dot is lit,
 * the arcs keep reaching for a bar they never hold. Pure CSS animation, and it
 * stays still for anyone who asks their device for reduced motion.
 */
export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-surface px-6 py-16 text-center">
      <style>{`
        @keyframes cp-seek { 0%, 100% { opacity: .12 } 40%, 60% { opacity: .9 } }
        @keyframes cp-drop { 0%, 70%, 100% { opacity: .12 } 80% { opacity: .55 } }
        @keyframes cp-pulse { 0%, 100% { transform: scale(1); opacity: .9 } 50% { transform: scale(1.15); opacity: 1 } }
        @keyframes cp-ripple { from { transform: scale(.6); opacity: .35 } to { transform: scale(2.4); opacity: 0 } }
        .cp-arc-1 { animation: cp-seek 2.4s ease-in-out infinite; }
        .cp-arc-2 { animation: cp-seek 2.4s ease-in-out .35s infinite; }
        .cp-arc-3 { animation: cp-drop 2.4s ease-in-out .7s infinite; }
        .cp-dot { transform-origin: 60px 96px; animation: cp-pulse 2.4s ease-in-out infinite; }
        .cp-ripple { animation: cp-ripple 3s ease-out infinite; }
        .cp-ripple-2 { animation-delay: 1.5s; }
        @media (prefers-reduced-motion: reduce) {
          .cp-arc-1, .cp-arc-2, .cp-arc-3, .cp-dot, .cp-ripple { animation: none; }
        }
      `}</style>

      <BrandLogo className="absolute left-6 top-6 h-8 w-auto" />

      <div className="relative">
      {/* Signal fading out from the icon */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[80%]">
        <span className="cp-ripple absolute -left-24 -top-24 h-48 w-48 rounded-full border border-brand/40" />
        <span className="cp-ripple cp-ripple-2 absolute -left-24 -top-24 h-48 w-48 rounded-full border border-brand/40" />
      </div>
      <svg
        viewBox="0 0 120 120"
        className="relative h-40 w-40 text-brand-light"
        role="img"
        aria-label="Wi-Fi with no signal"
      >
        <path className="cp-arc-3" d="M12 50 a68 68 0 0 1 96 0" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
        <path className="cp-arc-2" d="M28 66 a45 45 0 0 1 64 0" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
        <path className="cp-arc-1" d="M44 82 a22 22 0 0 1 32 0" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
        <circle className="cp-dot" cx="60" cy="96" r="7" fill="currentColor" />
        {/* the "no connection" mark */}
        <g transform="translate(88 86)">
          <circle r="15" className="fill-surface" />
          <circle r="12" fill="#EF4444" />
          <path d="M-4.5 -4.5 L4.5 4.5 M4.5 -4.5 L-4.5 4.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        </g>
      </svg>
      </div>

      <p className="relative mt-8 text-sm font-bold uppercase tracking-[0.3em] text-brand-light">Error 404</p>
      <h1 className="relative mt-3 text-4xl font-extrabold text-ink sm:text-5xl">No signal here</h1>
      <p className="relative mt-4 max-w-md text-base text-muted">
        We searched every bar and couldn&apos;t find this page. It may have moved, or the link
        dropped a letter on the way. Your money is safe — only this page is out of range.
      </p>

      {/* Signal-strength bars: one faint bar, the rest dark */}
      <div aria-hidden className="relative mt-6 flex items-end gap-1.5">
        {[10, 16, 22, 28].map((h, i) => (
          <span
            key={h}
            style={{ height: h }}
            className={`w-2 rounded-sm ${i === 0 ? "cp-arc-1 bg-brand-light" : "bg-border"}`}
          />
        ))}
        <span className="ml-2 text-xs font-semibold text-muted">1 bar · page not found</span>
      </div>

      <NotFoundActions />

      <p className="relative mt-10 text-xs text-muted">
        Still stuck?{" "}
        <Link href="/support" className="font-semibold text-brand-light hover:underline">
          Contact support
        </Link>
      </p>
    </main>
  );
}
