import { renderPdf } from "@probes/core/server";
import type { PdfSection } from "@probes/core/server";
import { config } from "./config.ts";
import type { CheckRunResult } from "./monitor.ts";

export type BrandedResult = CheckRunResult & { brand?: { name: string; color: string } };

/** The weekly client report, as a PDF an agency can forward without editing. */
export async function buildStatusReport(result: BrandedResult): Promise<Buffer> {
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
    title: brandName ? `${brandName} — site health report` : "Site health report",
    subtitle: `${result.summary.total} sites · ${result.summary.critical} needing attention · ${new Date(result.checkedAt).toDateString()}`,
    disclaimer: config.disclaimer,
    footerBrand: brandName || config.name,
    sections,
  });
}
