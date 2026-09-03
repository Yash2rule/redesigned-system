"use client";

import { useState } from "react";
import { Note, Pill, ResultSection, StatGrid, trackClient } from "@probes/ui";
import type { CheckRunResult, Severity } from "../lib/monitor.ts";

type BrandedResult = CheckRunResult & { brand?: { name: string; color: string } };

const TONE: Record<Severity, "bad" | "warn" | "neutral" | "good"> = {
  critical: "bad",
  warning: "warn",
  info: "neutral",
  ok: "good",
};

const SAMPLE = `example.com
wikipedia.org
https://developer.mozilla.org`;

export function Checker() {
  const [targets, setTargets] = useState("");
  const [brandName, setBrandName] = useState("");
  const [brandColor, setBrandColor] = useState("#7c3aed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BrandedResult | null>(null);
  const [id, setId] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (targets.trim().length < 3) {
      setError("Enter at least one domain.");
      return;
    }
    setError(null);
    setBusy(true);
    trackClient("upload_started", { mode: "domains" });

    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targets, brandName, brandColor }),
      });
      const payload = (await response.json()) as {
        id?: string;
        result?: BrandedResult;
        error?: string;
      };
      if (!response.ok || payload.error || !payload.result) {
        setError(payload.error ?? `Something went wrong (${response.status}).`);
        return;
      }
      setResult(payload.result);
      setId(payload.id ?? null);
      trackClient("result_viewed", { monitors: payload.result.summary.total });
      requestAnimationFrame(() =>
        document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch (err) {
      setError(`Could not reach the server: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form
        onSubmit={submit}
        className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6"
      >
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Client domains, one per line</span>
          <textarea
            value={targets}
            onChange={(e) => setTargets(e.target.value)}
            rows={6}
            placeholder={SAMPLE}
            className="w-full rounded-lg border border-[var(--line)] bg-white p-3 font-mono text-[13px]"
          />
          <span className="mt-1 block text-[12px] text-[var(--muted)]">
            Up to eight at a time. No account needed. We make one ordinary request per site and
            read its certificate — we never log in or crawl.
          </span>
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Your agency name (optional)</span>
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Northline Studio"
              maxLength={60}
              className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm"
            />
            <span className="mt-1 block text-[12px] text-[var(--muted)]">
              Goes on the status page and the PDF report.
            </span>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Your brand colour</span>
            <input
              type="color"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              className="h-11 w-full cursor-pointer rounded-lg border border-[var(--line)] bg-white px-2"
            />
          </label>
        </div>

        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-lg bg-[var(--accent)] px-5 py-3 text-[15px] font-semibold text-[var(--accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
        >
          {busy ? "Checking…" : "Check these sites"}
        </button>
        {busy ? (
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            Each site needs an HTTP request, a TLS handshake and a registry lookup. Give it a few
            seconds.
          </p>
        ) : null}
      </form>

      {result ? <Result result={result} id={id} /> : null}
    </div>
  );
}

function Result({ result, id }: { result: BrandedResult; id: string | null }) {
  return (
    <div id="result" className="mt-10 scroll-mt-6">
      <StatGrid
        items={[
          { label: "Sites checked", value: String(result.summary.total) },
          {
            label: "Need attention",
            value: String(result.summary.critical),
            tone: result.summary.critical > 0 ? "bad" : "good",
          },
          {
            label: "Worth watching",
            value: String(result.summary.warning),
            tone: result.summary.warning > 0 ? "warn" : "default",
          },
          { label: "Healthy", value: String(result.summary.healthy), tone: "good" },
        ]}
      />

      <div className="mt-6 space-y-4">
        {result.monitors.map((monitor) => (
          <section
            key={monitor.hostname + monitor.input}
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">{monitor.hostname}</h3>
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
                    ? `HTTP ${monitor.http.status} · ${monitor.http.latencyMs} ms`
                    : (monitor.http.error ?? "No response")}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Certificate
                </dt>
                <dd className="mt-1">
                  {monitor.tls?.daysRemaining != null
                    ? `${monitor.tls.daysRemaining} days · ${monitor.tls.issuer ?? "unknown issuer"}`
                    : (monitor.tls?.error ?? "Not checked (plain http)")}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Domain
                </dt>
                <dd className="mt-1">
                  {monitor.domain.daysRemaining != null
                    ? `${monitor.domain.daysRemaining} days · ${monitor.domain.registrar ?? "unknown registrar"}`
                    : "Registry does not publish this"}
                </dd>
              </div>
            </dl>

            {monitor.findings.length > 0 ? (
              <ul className="mt-4 space-y-3 border-t border-[var(--line)] pt-4">
                {monitor.findings.map((finding) => (
                  <li key={finding.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={TONE[finding.severity]}>{finding.severity}</Pill>
                      <span className="text-sm font-semibold">{finding.title}</span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">{finding.detail}</p>
                    <p className="mt-1 text-sm">
                      <span className="font-medium">Fix:</span>{" "}
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">
                        {finding.action}
                      </code>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 border-t border-[var(--line)] pt-4 text-sm text-[var(--muted)]">
                Nothing to report. Up, certificate comfortably in date, domain not near expiry, and
                the security headers we look for are present.
              </p>
            )}

            {monitor.http.redirects.length > 0 ? (
              <p className="mt-3 font-mono text-[12px] text-[var(--muted)]">
                Redirects: {monitor.http.redirects.join(" → ")}
              </p>
            ) : null}
          </section>
        ))}
      </div>

      <ResultSection title="What this check does and does not tell you">
        <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
          {result.limitations.map((limitation) => (
            <li key={limitation}>• {limitation}</li>
          ))}
        </ul>
      </ResultSection>

      {id ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={`/s/${id}`}
            className="inline-flex rounded-lg bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white"
          >
            Open the branded status page
          </a>
          <a
            href={`/api/report?id=${encodeURIComponent(id)}`}
            className="inline-flex rounded-lg border border-[var(--line)] px-5 py-3 text-sm font-semibold"
          >
            Download the client PDF
          </a>
        </div>
      ) : null}
      {id ? (
        <div className="mt-3">
          <Note>
            The status page link is shareable and re-checks itself once a day. It does not
            re-run the checks when a client opens it — that would mean a burst of network
            requests to your clients&apos; servers on every visit. It keeps the last fortnight of
            daily checks, and stops re-checking after 30 days with nobody looking at it.
          </Note>
        </div>
      ) : null}
    </div>
  );
}
