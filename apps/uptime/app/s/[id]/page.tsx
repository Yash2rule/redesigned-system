import { notFound } from "next/navigation";
import { getStore } from "@probes/core/server";
import { Container, Pill } from "@probes/ui";
import type { MonitorResult } from "../../../lib/monitor.ts";
import type { MonitorSet } from "../../../lib/schedule.ts";
import { hasClients, summariseByClient } from "../../../lib/clients.ts";
import { config } from "../../../lib/config.ts";

export const dynamic = "force-dynamic";

const TONE = {
  critical: "bad",
  warning: "warn",
  info: "neutral",
  ok: "good",
} as const;

/** One domain's card. Shared by the flat list and the per-client grouping. */
function MonitorCard({ monitor }: { monitor: MonitorResult }) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
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
  );
}

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

  // Group only when the agency actually named clients. Nobody who typed a
  // plain list of domains should be shown a heading called "Not assigned".
  const assignments = result.clients ?? {};
  const grouped = hasClients(assignments);
  const summaries = grouped ? summariseByClient(result.monitors, assignments) : [];

  return (
    <div style={{ ["--accent" as string]: brandColor }}>
      <header className="border-b border-[var(--line)] bg-[var(--surface)] py-10">
        <Container>
          {result.brand?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- an arbitrary
            // remote URL the agency supplied; next/image would need its host
            // allow-listed at build time, which cannot work for user input.
            <img
              src={result.brand.logoUrl}
              alt={brandName}
              className="mb-3 h-10 w-auto max-w-[200px] object-contain"
            />
          ) : null}
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
          {grouped ? (
            summaries.map((summary) => (
              <section key={summary.client ?? "__none"} className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
                    {summary.client ?? "Not assigned to a client"}
                  </h2>
                  <p className="text-[13px] text-[var(--muted)]">
                    {summary.counts.critical > 0
                      ? `${summary.counts.critical} of ${summary.counts.total} need attention`
                      : summary.counts.warning > 0
                        ? `${summary.counts.warning} of ${summary.counts.total} need watching`
                        : `All ${summary.counts.total} operational`}
                    {summary.client ? (
                      <>
                        {" · "}
                        {/* Only this client's sites, so it can be forwarded as-is. */}
                        <a
                          className="underline underline-offset-2 hover:text-[var(--fg)]"
                          href={`/api/report?id=${encodeURIComponent(id)}&client=${encodeURIComponent(summary.client)}`}
                        >
                          PDF for {summary.client}
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
                {summary.monitors.map((monitor) => (
                  <MonitorCard key={monitor.hostname} monitor={monitor} />
                ))}
              </section>
            ))
          ) : (
            result.monitors.map((monitor) => (
              <MonitorCard key={monitor.hostname} monitor={monitor} />
            ))
          )}
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
