import { UserFacingError } from "@probes/core";
import { checkDomain, checkHttp, checkTls } from "./checks.ts";
import type { DomainCheck, HttpCheck, TlsCheck } from "./checks.ts";
import { assertSafeUrl } from "./safe-url.ts";

export type Severity = "critical" | "warning" | "info" | "ok";

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** What the agency should do about it. */
  action: string;
};

export type MonitorResult = {
  input: string;
  hostname: string;
  url: string;
  checkedAt: string;
  http: HttpCheck;
  tls: TlsCheck | null;
  domain: DomainCheck;
  findings: Finding[];
  worst: Severity;
};

export type CheckRunResult = {
  monitors: MonitorResult[];
  checkedAt: string;
  summary: { total: number; critical: number; warning: number; healthy: number };
  limitations: string[];
};

export const MAX_MONITORS_PER_RUN = 8;

const SSL_CRITICAL_DAYS = 14;
const SSL_WARNING_DAYS = 30;
const DOMAIN_CRITICAL_DAYS = 30;
const DOMAIN_WARNING_DAYS = 60;
const SLOW_MS = 2_000;

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info", "ok"];
const worstOf = (severities: Severity[]): Severity =>
  SEVERITY_ORDER.find((s) => severities.includes(s)) ?? "ok";

function buildFindings(http: HttpCheck, tls: TlsCheck | null, domain: DomainCheck): Finding[] {
  const findings: Finding[] = [];

  // --- reachability --------------------------------------------------------
  // Not every non-2xx is an outage. A 401 or 403 is a server that is up and
  // deliberately refusing anonymous access, which is the correct behaviour for
  // a staging site — reporting it as DOWN in a client report is a false alarm
  // that costs the agency credibility.
  if (!http.ok) {
    if (http.status === 401 || http.status === 403) {
      findings.push({
        id: "auth-required",
        severity: "info",
        title: `Responds ${http.status} to anonymous visitors`,
        detail:
          "The server is up and answering, but it refuses requests without credentials. Expected for a staging or members-only site; a problem if this is meant to be a public page.",
        action: "If this should be public, check the access rules or the WAF. If it is staging, no action needed.",
      });
    } else if (http.status === 404) {
      findings.push({
        id: "not-found",
        severity: "warning",
        title: "Returns 404 at this address",
        detail: "The server is up but has nothing at this path. Usually the wrong URL in the monitor list.",
        action: "Check the address, including whether it should have www or a trailing path.",
      });
    } else {
      findings.push({
        id: "down",
        severity: "critical",
        title: http.status ? `Returns HTTP ${http.status}` : "Not responding",
        detail:
          http.error ??
          `The server answered with ${http.status}, which visitors see as an error page.`,
        action: "Check the host and the application logs. This is what a visitor is seeing right now.",
      });
    }
  } else if ((http.latencyMs ?? 0) > SLOW_MS) {
    findings.push({
      id: "slow",
      severity: "warning",
      title: `Slow to respond (${((http.latencyMs ?? 0) / 1000).toFixed(1)}s)`,
      detail: `The first byte took ${http.latencyMs} ms. Anything over two seconds costs conversions and search ranking.`,
      action: "Look at server response time before optimising images or scripts.",
    });
  }

  if (http.downgradedToHttp) {
    findings.push({
      id: "https-downgrade",
      severity: "critical",
      title: "HTTPS redirects to plain HTTP",
      detail: "A secure request ended up on an unencrypted connection, so everything sent is readable in transit.",
      action: "Fix the redirect chain so it terminates on https, then add HSTS.",
    });
  }

  // --- certificate ---------------------------------------------------------
  if (tls) {
    if (tls.daysRemaining !== null && tls.daysRemaining < 0) {
      findings.push({
        id: "ssl-expired",
        severity: "critical",
        title: `Certificate expired ${Math.abs(tls.daysRemaining)} days ago`,
        detail: `It was valid until ${tls.validTo}. Browsers are showing a full-page security warning.`,
        action: "Renew immediately. If auto-renewal is set up, it has failed silently.",
      });
    } else if (tls.daysRemaining !== null && tls.daysRemaining <= SSL_CRITICAL_DAYS) {
      findings.push({
        id: "ssl-expiring",
        severity: "critical",
        title: `Certificate expires in ${tls.daysRemaining} days`,
        detail: `Valid until ${tls.validTo}, issued by ${tls.issuer ?? "an unknown issuer"}.`,
        action: "Renew this week. Certificates that auto-renew usually fail quietly, so verify rather than assume.",
      });
    } else if (tls.daysRemaining !== null && tls.daysRemaining <= SSL_WARNING_DAYS) {
      findings.push({
        id: "ssl-soon",
        severity: "warning",
        title: `Certificate expires in ${tls.daysRemaining} days`,
        detail: `Valid until ${tls.validTo}.`,
        action: "Confirm auto-renewal is working, or put a reminder in the calendar.",
      });
    }

    if (tls.hostnameMatches === false) {
      findings.push({
        id: "ssl-hostname",
        severity: "critical",
        title: "Certificate does not cover this hostname",
        detail: `It is issued for ${tls.altNames.slice(0, 5).join(", ") || tls.subject || "another name"}.`,
        action: "Reissue the certificate with this hostname in the subject alternative names.",
      });
    }
    if (!tls.ok && tls.error && tls.daysRemaining !== null && tls.daysRemaining > SSL_WARNING_DAYS) {
      findings.push({
        id: "ssl-invalid",
        severity: "critical",
        title: "Certificate does not validate",
        detail: tls.error,
        action: "Usually a missing intermediate certificate in the chain. Test with an SSL checker.",
      });
    }
  }

  // --- domain --------------------------------------------------------------
  if (domain.ok && domain.daysRemaining !== null) {
    if (domain.daysRemaining < 0) {
      findings.push({
        id: "domain-expired",
        severity: "critical",
        title: `Domain expired ${Math.abs(domain.daysRemaining)} days ago`,
        detail: `Registered with ${domain.registrar ?? "an unknown registrar"}.`,
        action: "Renew now. Past the redemption window the domain can be bought by anyone.",
      });
    } else if (domain.daysRemaining <= DOMAIN_CRITICAL_DAYS) {
      findings.push({
        id: "domain-expiring",
        severity: "critical",
        title: `Domain expires in ${domain.daysRemaining} days`,
        detail: `Expires ${domain.expiresAt?.slice(0, 10)}, registered with ${domain.registrar ?? "an unknown registrar"}.`,
        action: "Renew and turn on auto-renew. A lapsed domain takes a site down completely and costs far more to recover.",
      });
    } else if (domain.daysRemaining <= DOMAIN_WARNING_DAYS) {
      findings.push({
        id: "domain-soon",
        severity: "warning",
        title: `Domain expires in ${domain.daysRemaining} days`,
        detail: `Expires ${domain.expiresAt?.slice(0, 10)}.`,
        action: "Confirm auto-renew is on and the card on file has not expired.",
      });
    }

    const locked = domain.statuses.some((s) => s.toLowerCase().includes("transferprohibited"));
    if (!locked && domain.statuses.length > 0) {
      findings.push({
        id: "domain-unlocked",
        severity: "warning",
        title: "Domain transfer lock is off",
        detail: `Registry status: ${domain.statuses.join(", ")}.`,
        action: "Turn on the transfer lock at the registrar. It is the cheapest protection against domain hijacking.",
      });
    }
  }

  // --- security headers ----------------------------------------------------
  if (http.ok) {
    if (!http.headers["strict-transport-security"]) {
      findings.push({
        id: "no-hsts",
        severity: "info",
        title: "No HSTS header",
        detail: "Without Strict-Transport-Security, the first visit of the day can be downgraded to http.",
        action: "Add: Strict-Transport-Security: max-age=31536000; includeSubDomains",
      });
    }
    if (!http.headers["x-content-type-options"]) {
      findings.push({
        id: "no-nosniff",
        severity: "info",
        title: "No X-Content-Type-Options header",
        detail: "Browsers may guess at content types, which is a small but avoidable XSS vector.",
        action: "Add: X-Content-Type-Options: nosniff",
      });
    }
    if (!http.headers["content-security-policy"] && !http.headers["x-frame-options"]) {
      findings.push({
        id: "no-framing-protection",
        severity: "info",
        title: "Nothing stops the site being framed",
        detail: "No Content-Security-Policy and no X-Frame-Options, so the page can be embedded in someone else's site.",
        action: "Add: Content-Security-Policy: frame-ancestors 'self'",
      });
    }
  }

  return findings;
}

export async function runMonitor(rawTarget: string): Promise<MonitorResult> {
  const { url } = await assertSafeUrl(rawTarget);
  const hostname = url.hostname;

  // All three in parallel: a slow RDAP registry should not delay the HTTP result.
  const [http, tls, domain] = await Promise.all([
    checkHttp(url.toString()),
    url.protocol === "https:" ? checkTls(hostname) : Promise.resolve(null),
    checkDomain(hostname),
  ]);

  const findings = buildFindings(http, tls, domain);
  return {
    input: rawTarget,
    hostname,
    url: url.toString(),
    checkedAt: new Date().toISOString(),
    http,
    tls,
    domain,
    findings,
    worst: worstOf(findings.map((f) => f.severity)),
  };
}

/** Split a textarea of domains, one per line or comma-separated. */
export function parseTargets(raw: string): string[] {
  const targets = raw
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const unique = [...new Set(targets.map((t) => t.toLowerCase()))];
  if (unique.length === 0) {
    throw new UserFacingError("Enter at least one domain, one per line.", 400);
  }
  if (unique.length > MAX_MONITORS_PER_RUN) {
    throw new UserFacingError(
      `That's ${unique.length} domains. We check up to ${MAX_MONITORS_PER_RUN} at a time so the page returns quickly — split them into two runs.`,
      400,
    );
  }
  return unique;
}

export async function runChecks(targets: string[]): Promise<CheckRunResult> {
  const monitors = await Promise.all(
    targets.map(async (target) => {
      try {
        return await runMonitor(target);
      } catch (error) {
        // One bad domain must not fail the whole batch.
        const message = (error as Error).message;
        return {
          input: target,
          hostname: target,
          url: target,
          checkedAt: new Date().toISOString(),
          http: {
            ok: false,
            status: null,
            latencyMs: null,
            finalUrl: null,
            redirects: [],
            downgradedToHttp: false,
            error: message,
            headers: {},
          },
          tls: null,
          domain: {
            ok: false,
            registrar: null,
            expiresAt: null,
            daysRemaining: null,
            statuses: [],
            source: "unavailable" as const,
            error: null,
          },
          findings: [
            {
              id: "unusable-target",
              severity: "critical" as const,
              title: "Could not check this address",
              detail: message,
              action: "Check the spelling, or drop it from the list.",
            },
          ],
          worst: "critical" as Severity,
        };
      }
    }),
  );

  return {
    monitors,
    checkedAt: new Date().toISOString(),
    summary: {
      total: monitors.length,
      critical: monitors.filter((m) => m.worst === "critical").length,
      warning: monitors.filter((m) => m.worst === "warning").length,
      healthy: monitors.filter((m) => m.worst === "ok" || m.worst === "info").length,
    },
    limitations: [
      "Every check here runs from one place, right now. That tells you whether a site is up, not what its uptime percentage was last month — for that you need scheduled checks over time.",
      "Domain expiry comes from RDAP, the free public registry protocol. Several country registries, .in among them, publish thin records or none, and those show as unknown rather than being guessed.",
      "Certificate checks read the certificate the server presents on a fresh handshake. A CDN may present a different certificate from a different region.",
    ],
  };
}
