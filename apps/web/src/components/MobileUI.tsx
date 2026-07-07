"use client";

import { ReactNode, useCallback, useState } from "react";
import { LucideIcon } from "lucide-react";

/** Lightweight transient toast for "coming soon" / small feedback. */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 1800);
  }, []);
  const node = msg ? (
    <div className="fixed inset-x-0 bottom-28 z-50 flex justify-center px-6">
      <div className="rounded-full bg-card px-5 py-3 text-sm font-semibold text-ink shadow-xl ring-1 ring-border">
        {msg}
      </div>
    </div>
  ) : null;
  return { show, node };
}

/** Small circular avatar shown top-left of each screen. */
export function Avatar({ name }: { name?: string | null }) {
  const initial = (name || "C").trim().charAt(0).toUpperCase();
  return (
    <div
      className="flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold text-white"
      style={{ backgroundColor: "#D81E9B" }}
    >
      {initial}
    </div>
  );
}

/** Round white icon button used in the top bar. */
export function TopIcon({
  icon: Icon,
  onClick,
}: {
  icon: LucideIcon;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="ml-3 flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink shadow-sm transition hover:opacity-80"
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

/** Top bar: avatar on the left, round icon buttons on the right. */
export function TopBar({
  name,
  icons,
  onAvatar,
}: {
  name?: string | null;
  icons: { icon: LucideIcon; onClick?: () => void }[];
  onAvatar?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-5 pb-1 pt-3">
      {onAvatar ? (
        <button onClick={onAvatar} aria-label="Open profile">
          <Avatar name={name} />
        </button>
      ) : (
        <Avatar name={name} />
      )}
      <div className="flex items-center">
        {icons.map((it, i) => (
          <TopIcon key={i} icon={it.icon} onClick={it.onClick} />
        ))}
      </div>
    </div>
  );
}

/** Centered "Total ... Balance" + big amount block. */
export function BalanceBlock({
  label,
  amount,
}: {
  label: string;
  amount: string;
}) {
  return (
    <div className="mb-7 mt-4 flex flex-col items-center">
      <span className="text-base text-muted">{label}</span>
      <span className="mt-2 text-[40px] font-extrabold leading-none text-ink">
        {amount}
      </span>
    </div>
  );
}

/** Round grey quick-action button with a label underneath. */
export function CircleAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-circle text-ink transition active:scale-95">
        <Icon className="h-6 w-6" />
      </span>
      <span className="mt-2 text-sm font-semibold text-ink">{label}</span>
    </button>
  );
}

/** Row of quick-action buttons, evenly spaced. */
export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="mb-8 flex justify-center gap-9 px-10">{children}</div>;
}

/** Small Nigerian flag rendered as a circle (green / white / green). */
export function NairaFlag({ size = 44 }: { size?: number }) {
  return (
    <div
      className="flex overflow-hidden rounded-full"
      style={{ width: size, height: size }}
    >
      <div className="h-full flex-1" style={{ backgroundColor: "#008751" }} />
      <div className="h-full flex-1 bg-white" />
      <div className="h-full flex-1" style={{ backgroundColor: "#008751" }} />
    </div>
  );
}

/** Section header with a chevron, e.g. "Transactions >". */
export function SectionHeader({
  title,
  onClick,
}: {
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="mb-3 flex items-center gap-0.5 text-base font-bold text-brand"
    >
      {title}
      <ChevronRight />
    </button>
  );
}

function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** Circular crypto coin badge (BTC / ETH / USDT …). */
export function CoinBadge({
  symbol,
  size = 40,
}: {
  symbol: string;
  size?: number;
}) {
  const map: Record<string, { bg: string; glyph: string }> = {
    BTC: { bg: "#F7931A", glyph: "₿" },
    ETH: { bg: "#627EEA", glyph: "Ξ" },
    USDT: { bg: "#26A17B", glyph: "₮" },
    USDC: { bg: "#2775CA", glyph: "$" },
    NGN: { bg: "#2E8B57", glyph: "₦" },
  };
  const c = map[symbol] ?? { bg: "#6B5B95", glyph: symbol.charAt(0) };
  return (
    <span
      className="flex items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: c.bg,
        fontSize: size * 0.45,
      }}
    >
      {c.glyph}
    </span>
  );
}

/** White rounded card wrapper. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-3xl bg-card p-5 ${className}`}>{children}</div>
  );
}
