import { renderPdf } from "@probes/core/server";
import type { PdfSection } from "@probes/core/server";
import { config } from "./config.ts";
import type { CheckRunResult } from "./monitor.ts";
import { summariseByClient } from "./clients.ts";
import { UserFacingError } from "@probes/core";

export type BrandedResult = CheckRunResult & {
  brand?: { name: string; color: string };
  clients?: Record<string, string>;
};

/**
 * Narrows a result to one client's domains.
 *
 * This is the difference between "a report" and "a report you can actually
 * send". An agency monitoring six clients in one list cannot forward the whole
 * thing to any of them — it names the other five. Passing a client here
 * produces a PDF with only their sites in it, and totals that are theirs.
 */
export function forClient(result: BrandedResult, client: string): BrandedResult {
  const summaries = summariseByClient(result.monitors, result.clients ?? {});
  const match = summaries.find(
    (s) => s.client !== null && s.client.toLowerCase() === client.trim().toLowerCase(),
  );
  if (!match) {
    throw new UserFacingError(`No client called "${client.slice(0, 60)}" in this check.`, 404);
  }

  // Narrow the assignment map too, not just the monitors. It maps every
  // hostname in the check to its client, so carrying it whole would put the
  // other clients' domains — and their names — inside a document written to be
  // forwarded to this one.
  const kept = new Set(match.monitors.flatMap((m) => [m.input.toLowerCase(), m.hostname.toLowerCase()]));
  const clients = Object.fromEntries(
    Object.entries(result.clients ?? {}).filter(([host]) => kept.has(host.toLowerCase())),
  );

  return {
    ...result,
    monitors: match.monitors,
    clients,
    summary: {
      total: match.counts.total,
      critical: match.counts.critical,
      warning: match.counts.warning,
      healthy: match.counts.healthy,
    },
  };
}

/** The weekly client report, as a PDF an agency can forward without editing. */
export async function buildStatusReport(
  result: BrandedResult,
  client?: string,
): Promise<Buffer> {
  const scoped = client ? forClient(result, client) : result;
  return buildReportFor(scoped, client ?? null);
}

async function buildReportFor(result: BrandedResult, client: string | null): Promise<Buffer> {
  const brandName = result.brand?.name?.trim();

  const sections: PdfSection[] = [
    {
      type: "keyValues",
      rows: [
        ["Sites checked", String(result.summary.total)],
        ["Needing attention now", String(result.summary.critical)],
        ["Worth watching", String(result.summary.warning)],
        ["Healthy", String(result.summary.healthy)],
        ["Checked at", new Date(result.checkedAt).toUTCString()],
      ],
    },
    {
      type: "table",
      columns: ["Site", "Status", "Certificate", "Domain"],
      rows: result.monitors.map((monitor) => [
        monitor.hostname,
        monitor.http.ok ? `up (${monitor.http.status}, ${monitor.http.latencyMs} ms)` : "DOWN",
        monitor.tls?.daysRemaining === null || monitor.tls === null
          ? "unknown"
          : `${monitor.tls.daysRemaining} days left`,
        monitor.domain.daysRemaining === null
          ? "unknown"
          : `${monitor.domain.daysRemaining} days left`,
      ]),
    },
  ];

  // Only on the whole-portfolio report: a single client's PDF is already
  // about one client, so a breakdown table would have exactly one row.
  if (!client) {
    const summaries = summariseByClient(result.monitors, result.clients ?? {});
    if (summaries.some((s) => s.client !== null)) {
      sections.push({ type: "heading", text: "By client" });
      sections.push({
        type: "table",
        columns: ["Client", "Sites", "Needs attention", "Worth watching"],
        rows: summaries.map((summary) => [
          summary.client ?? "Not assigned",
          String(summary.counts.total),
          String(summary.counts.critical),
          String(summary.counts.warning),
        ]),
      });
    }
  }

  for (const monitor of result.monitors) {
    sections.push({ type: "heading", text: monitor.hostname });

    if (monitor.findings.length === 0) {
      sections.push({
        type: "paragraph",
        text: "No issues found. The site responded normally, the certificate is comfortably in date, and the domain is not near expiry.",
      });
    } else {
      for (const finding of monitor.findings) {
        sections.push({
          type: "subheading",
          text: `[${finding.severity.toUpperCase()}] ${finding.title}`,
        });
        sections.push({ type: "paragraph", text: finding.detail });
        sections.push({ type: "paragraph", text: `Fix: ${finding.action}` });
      }
    }

    sections.push({
      type: "bullets",
      items: [
        `HTTP: ${monitor.http.ok ? `${monitor.http.status} in ${monitor.http.latencyMs} ms` : (monitor.http.error ?? "no response")}`,
        monitor.http.redirects.length > 0
          ? `Redirects: ${monitor.http.redirects.join(" -> ")}`
          : "Redirects: none",
        monitor.tls
          ? `Certificate: ${monitor.tls.subject ?? "unknown"} issued by ${monitor.tls.issuer ?? "unknown"}, valid until ${monitor.tls.validTo ?? "unknown"}`
          : "Certificate: not checked (plain http)",
        monitor.domain.ok
          ? `Domain: expires ${monitor.domain.expiresAt?.slice(0, 10)}, registrar ${monitor.domain.registrar ?? "unknown"}`
          : `Domain: ${monitor.domain.error ?? "no registry data"}`,
      ],
    });
    sections.push({ type: "divider" });
  }

  sections.push({ type: "heading", text: "What this report does and does not cover" });
  sections.push({ type: "bullets", items: result.limitations });

  return renderPdf({
    title: [brandName, client, "site health report"].filter(Boolean).join(" — "),
    subtitle: `${result.summary.total} sites · ${result.summary.critical} needing attention · ${new Date(result.checkedAt).toDateString()}`,
    disclaimer: config.disclaimer,
    footerBrand: brandName || config.name,
    sections,
  });
}
