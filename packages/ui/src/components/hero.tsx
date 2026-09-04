import type { ReactNode } from "react";
import { Container } from "./primitives.tsx";
import type { ProbeConfig } from "../config.ts";

export function Hero({ config, children }: { config: ProbeConfig; children?: ReactNode }) {
  return (
    <header className="border-b border-[var(--line)] bg-[var(--surface)]">
      <Container className="py-12 sm:py-16">
        <p className="text-sm font-semibold text-[var(--accent)]">{config.name}</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          {config.headline}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--muted)] sm:text-lg">
          {config.subheadline}
        </p>
        {children ? <div className="mt-8">{children}</div> : null}
      </Container>
    </header>
  );
}

export function BenefitList({ config }: { config: ProbeConfig }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-3">
      {config.benefits.map((benefit) => (
        <li key={benefit.title} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h3 className="text-[15px] font-semibold">{benefit.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{benefit.body}</p>
        </li>
      ))}
    </ul>
  );
}
