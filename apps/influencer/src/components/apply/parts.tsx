"use client";

import { Check, ChevronLeft } from "lucide-react";

/** The top bar of a guided flow: back, and a segmented progress bar. */
export function FlowBar({ step, total, onBack }: { step: number; total: number; onBack?: () => void }) {
  return (
    <div className="sticky top-0 z-10 -mx-5 bg-surface/85 px-5 pb-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-xl">
      <div className="flex h-11 items-center gap-3">
        {onBack ? (
          <button onClick={onBack} aria-label="Back" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-brand-light transition hover:bg-circle active:scale-95">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
        ) : (
          <span className="w-9" />
        )}
        <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step} aria-label={`Step ${step} of ${total}`}>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-border/80">
              <span className={`block h-full rounded-full bg-brand transition-[width] duration-500 ease-spring ${i < step ? "w-full" : "w-0"}`} />
            </span>
          ))}
        </div>
        <span className="w-9 text-right text-[13px] font-medium tabular-nums text-muted">{step}/{total}</span>
      </div>
    </div>
  );
}

/** The bottom action area, pinned above the home indicator. */
export function FlowFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-10 bg-gradient-to-t from-surface via-surface/95 to-surface/0 px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-6">
      {children}
    </div>
  );
}

export function StepHeader({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <header className="mb-7 mt-4">
      <h1 className="title">{title}</h1>
      {sub && <p className="subhead mt-2 text-[17px] leading-snug">{sub}</p>}
    </header>
  );
}

/** A choice that looks like an Apple segmented/chip control. */
export function Chip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} disabled={disabled} className={`chip ${on ? "chip-on" : "hover:bg-border/60"} disabled:opacity-40`}>
      {on && <Check className="h-4 w-4" strokeWidth={3} />}
      {children}
    </button>
  );
}

/** A small round tick / empty circle, like an iOS list selection. */
export function Tick({ on }: { on: boolean }) {
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition ${on ? "bg-brand text-white" : "ring-2 ring-inset ring-border"}`}>
      {on && <Check className="h-4 w-4" strokeWidth={3} />}
    </span>
  );
}

export function FieldError({ children }: { children: React.ReactNode }) {
  return children ? <p className="mt-1.5 px-1 text-[13px] text-bad" role="alert">{children}</p> : null;
}

export function Counter({ n, max }: { n: number; max: number }) {
  return <span className={`text-[13px] tabular-nums ${n > max ? "text-bad" : "text-muted"}`}>{n}/{max}</span>;
}
