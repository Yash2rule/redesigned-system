import type { ProbeConfig } from "../config.ts";

export function FaqSection({ config }: { config: ProbeConfig }) {
  return (
    <div className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
      {config.faq.map((item) => (
        <details key={item.question} className="group px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
            {item.question}
            <span aria-hidden className="shrink-0 text-[var(--muted)] transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
