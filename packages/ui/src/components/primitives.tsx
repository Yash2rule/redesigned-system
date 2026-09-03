import type { ReactNode } from "react";

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-5xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6 ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="max-w-2xl">
      {eyebrow ? (
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      {body ? <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{body}</p> : null}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "good" | "bad" }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700 border-slate-200",
    warn: "bg-amber-50 text-amber-800 border-amber-200",
    good: "bg-emerald-50 text-emerald-800 border-emerald-200",
    bad: "bg-rose-50 text-rose-800 border-rose-200",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Neutral, non-alarming note used for assumptions and limitations. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-4 py-3 text-[13px] leading-relaxed text-[var(--muted)]">
      {children}
    </p>
  );
}
