import type { ReactNode } from "react";
import { Card } from "./primitives.tsx";

export type StatItem = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
};

/** The headline numbers at the top of every result. */
export function StatGrid({ items }: { items: StatItem[] }) {
  const tones = {
    default: "text-[var(--ink)]",
    good: "text-emerald-700",
    warn: "text-amber-700",
    bad: "text-rose-700",
  } as const;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {item.label}
          </p>
          <p className={`mt-1.5 text-2xl font-bold tracking-tight ${tones[item.tone ?? "default"]}`}>
            {item.value}
          </p>
          {item.hint ? <p className="mt-1 text-[12px] text-[var(--muted)]">{item.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function ResultSection({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

/** Horizontally scrollable so wide tables never break the mobile layout. */
export function DataTable({
  columns,
  rows,
  align = [],
}: {
  columns: string[];
  rows: ReactNode[][];
  align?: ("left" | "right")[];
}) {
  return (
    // `relative` is load-bearing: absolutely positioned descendants (Tailwind's
    // `sr-only` is `position: absolute`) are only clipped by an overflow
    // ancestor that is also their containing block. Without it they escape the
    // scroll container and drag the whole page sideways on mobile.
    <div className="relative -mx-1 overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--line)]">
            {columns.map((column, i) => (
              <th
                key={column}
                scope="col"
                className={`px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] ${
                  align[i] === "right" ? "text-right" : "text-left"
                }`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-[var(--line)] last:border-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`px-2 py-2 align-top ${align[cellIndex] === "right" ? "text-right tabular-nums" : "text-left"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Assumptions panel. Every calculated result in this repo ships with one. */
export function AssumptionsPanel({ items }: { items: string[] }) {
  return (
    <details className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--canvas)] px-5 py-4">
      <summary className="cursor-pointer list-none text-sm font-semibold">
        What we assumed to get these numbers ({items.length})
      </summary>
      <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-[var(--muted)]">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </details>
  );
}
