import { notFound } from "next/navigation";
import { getStore } from "@probes/core/server";
import { Container, Pill } from "@probes/ui";
import type { MonitorSet } from "../../../lib/schedule.ts";
import { config } from "../../../lib/config.ts";

export const dynamic = "force-dynamic";

const TONE = {
  critical: "bad",
  warning: "warn",
  info: "neutral",
  ok: "good",
} as const;

/**
 * The white-label status page. Shows the last completed check, with the
 * agency's name and colour, at a URL they can send a client.
 *
 * It renders the stored result rather than re-checking on every load: a
 * status page that runs eight live network checks per visitor is a denial of
 * service against your own clients' servers.
 */
export default async function StatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = await getStore().getArtifact(id);
  if (!artifact || artifact.probe !== "uptime") notFound();

  const result = artifact.payload as unknown as MonitorSet;
  const brandName = result.brand?.name?.trim() || config.name;
  const brandColor = result.brand?.color ?? config.accent;

  return (
    <div style={{ ["--accent" as string]: brandColor }}>
      <header className="border-b border-[var(--line)] bg-[var(--surface)] py-10">
        <Container>
          <p className="text-sm font-semibold text-[var(--accent)]">{brandName}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Site status</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Last checked {new Date(result.checkedAt).toUTCString()}.{" "}
            {result.summary.critical === 0
              ? "Nothing needs attention right now."
              : `${result.summary.critical} of ${result.summary.total} sites need attention.`}
          </p>
        </Container>
      </header>

      <Container className="py-10">
        <div className="space-y-4">
          {result.monitors.map((monitor) => (
            <section
              key={monitor.hostname}
              className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{monitor.hostname}</h2>
                <Pill tone={TONE[monitor.worst]}>
                  {monitor.worst === "ok" || monitor.worst === "info"
                    ? "Operational"
                    : monitor.worst === "warning"
                      ? "Needs watching"
                      : "Needs attention"}
                </Pill>
              </div>

              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Reachability
                  </dt>
                  <dd className="mt-1">
                    {monitor.http.ok
                      ? `HTTP ${monitor.http.status} in ${monitor.http.latencyMs} ms`
                      : (monitor.http.error ?? "No response")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Certificate
                  </dt>
                  <dd className="mt-1">
                    {monitor.tls?.daysRemaining != null
                      ? `${monitor.tls.daysRemaining} days remaining`
                      : "Not checked"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Domain
                  </dt>
                  <dd className="mt-1">
                    {monitor.domain.daysRemaining != null
                      ? `${monitor.domain.daysRemaining} days remaining`
                      : "Registry does not publish this"}
                  </dd>
                </div>
              </dl>

              {monitor.findings.length > 0 ? (
                <ul className="mt-4 space-y-2 border-t border-[var(--line)] pt-4 text-sm">
                  {monitor.findings.map((finding) => (
                    <li key={finding.id} className="flex flex-wrap items-baseline gap-2">
                      <Pill tone={TONE[finding.severity]}>{finding.severity}</Pill>
                      <span className="font-medium">{finding.title}</span>
                      <span className="text-[var(--muted)]">{finding.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        {(result.history?.length ?? 0) > 1 ? (
          <section className="mt-8 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="text-sm font-semibold">Recent checks</h2>
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              Newest first. Each square is one scheduled check.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(result.history ?? []).map((entry) => (
                <span
                  key={entry.checkedAt}
                  title={`${new Date(entry.checkedAt).toUTCString()} — ${entry.critical} needing attention, ${entry.warning} worth watching`}
                  className={`h-6 w-3 rounded-sm ${
                    entry.critical > 0
                      ? "bg-rose-500"
                      : entry.warning > 0
                        ? "bg-amber-400"
                        : "bg-emerald-500"
                  }`}
                />
              ))}
            </div>
          </section>
        ) : null}

        <p className="mt-8 text-[13px] leading-relaxed text-[var(--muted)]">{config.disclaimer}</p>
      </Container>
    </div>
  );
}
