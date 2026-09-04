import { Container } from "./primitives.tsx";
import type { ProbeConfig } from "../config.ts";

export function SiteFooter({ config }: { config: ProbeConfig }) {
  return (
    <footer className="mt-16 border-t border-[var(--line)] bg-[var(--surface)] py-10">
      <Container>
        <p className="text-sm font-semibold">{config.name}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">{config.tagline}</p>

        <p className="mt-6 max-w-3xl text-[13px] leading-relaxed text-[var(--muted)]">
          {config.disclaimer}
        </p>

        <p className="mt-6 text-[13px] text-[var(--muted)]">
          Questions:{" "}
          <a className="underline underline-offset-2" href={`mailto:${config.contactEmail}`}>
            {config.contactEmail}
          </a>
        </p>
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          Run by one person in India. No sales calls, no onboarding meetings — if the product
          doesn&apos;t explain itself, that&apos;s a bug worth emailing about.
        </p>
      </Container>
    </footer>
  );
}
