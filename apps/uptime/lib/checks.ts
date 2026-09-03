import tls from "node:tls";
import { assertSafeUrl } from "./safe-url.ts";

/**
 * The three checks an agency actually needs, all of which are free to run:
 * an HTTP request, a TLS handshake, and an RDAP lookup. No paid API anywhere.
 */

export type HttpCheck = {
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  finalUrl: string | null;
  redirects: string[];
  /** True when an https URL ended up on plain http. */
  downgradedToHttp: boolean;
  error: string | null;
  headers: Record<string, string>;
};

export type TlsCheck = {
  ok: boolean;
  issuer: string | null;
  subject: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  /** Whether the certificate actually covers the hostname we asked for. */
  hostnameMatches: boolean | null;
  altNames: string[];
  error: string | null;
};

export type DomainCheck = {
  ok: boolean;
  registrar: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  statuses: string[];
  /** "rdap" when we got an answer; "unavailable" when the registry has none. */
  source: "rdap" | "unavailable";
  error: string | null;
};

const HTTP_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

/** Response headers worth reporting to an agency's client. */
const INTERESTING_HEADERS = [
  "server",
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "cache-control",
];

export async function checkHttp(rawUrl: string): Promise<HttpCheck> {
  const redirects: string[] = [];
  let current: string;
  try {
    current = (await assertSafeUrl(rawUrl)).url.toString();
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: null,
      finalUrl: null,
      redirects,
      downgradedToHttp: false,
      error: (error as Error).message,
      headers: {},
    };
  }

  const startedHttps = current.startsWith("https:");
  const start = performance.now();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      const response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        headers: { "user-agent": "UptimeProbe/1.0 (+https://github.com)" },
      });

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop === MAX_REDIRECTS) {
          return {
            ok: false,
            status: response.status,
            latencyMs: Math.round(performance.now() - start),
            finalUrl: current,
            redirects,
            downgradedToHttp: false,
            error: `More than ${MAX_REDIRECTS} redirects — this is usually a redirect loop.`,
            headers: {},
          };
        }
        const next = new URL(location, current).toString();
        redirects.push(next);
        // Re-check every hop: a public host can redirect to a private one.
        try {
          current = (await assertSafeUrl(next)).url.toString();
        } catch (error) {
          return {
            ok: false,
            status: response.status,
            latencyMs: Math.round(performance.now() - start),
            finalUrl: current,
            redirects,
            downgradedToHttp: false,
            error: `Redirected somewhere we won't follow: ${(error as Error).message}`,
            headers: {},
          };
        }
        continue;
      }

      const headers: Record<string, string> = {};
      for (const name of INTERESTING_HEADERS) {
        const value = response.headers.get(name);
        if (value) headers[name] = value.slice(0, 300);
      }

      return {
        ok: response.status < 400,
        status: response.status,
        latencyMs: Math.round(performance.now() - start),
        finalUrl: current,
        redirects,
        downgradedToHttp: startedHttps && current.startsWith("http:"),
        error: null,
        headers,
      };
    } catch (error) {
      const message = (error as Error).name === "TimeoutError"
        ? `No response within ${HTTP_TIMEOUT_MS / 1000} seconds.`
        : (error as Error).message;
      return {
        ok: false,
        status: null,
        latencyMs: Math.round(performance.now() - start),
        finalUrl: current,
        redirects,
        downgradedToHttp: false,
        error: message,
        headers: {},
      };
    }
  }

  return {
    ok: false,
    status: null,
    latencyMs: null,
    finalUrl: current,
    redirects,
    downgradedToHttp: false,
    error: "Too many redirects.",
    headers: {},
  };
}

/**
 * Certificate name fields are string | string[] — a multi-valued RDN, e.g. two
 * OU entries — so every read has to collapse that.
 */
const firstValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const daysUntil = (iso: string): number =>
  Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);

/** Read the certificate straight off a TLS handshake. No API, no cost. */
export function checkTls(hostname: string, port = 443): Promise<TlsCheck> {
  return new Promise((resolve) => {
    const fail = (message: string) =>
      resolve({
        ok: false,
        issuer: null,
        subject: null,
        validFrom: null,
        validTo: null,
        daysRemaining: null,
        hostnameMatches: null,
        altNames: [],
        error: message,
      });

    let settled = false;
    const socket = tls.connect(
      {
        host: hostname,
        port,
        servername: hostname,
        // We want to REPORT on a bad certificate, not refuse to look at one.
        // An expired or mismatched cert is exactly what an agency is paying
        // us to notice, so the handshake must complete either way.
        rejectUnauthorized: false,
        timeout: HTTP_TIMEOUT_MS,
      },
      () => {
        if (settled) return;
        settled = true;
        const cert = socket.getPeerCertificate(false);
        const authorized = socket.authorized;
        const authError = socket.authorizationError?.toString() ?? null;
        socket.destroy();

        if (!cert || Object.keys(cert).length === 0) {
          resolve({
            ok: false,
            issuer: null,
            subject: null,
            validFrom: null,
            validTo: null,
            daysRemaining: null,
            hostnameMatches: null,
            altNames: [],
            error: "The server completed a handshake but presented no certificate.",
          });
          return;
        }

        const validTo = cert.valid_to ? new Date(cert.valid_to).toISOString() : null;
        const altNames = (cert.subjectaltname ?? "")
          .split(",")
          .map((entry) => entry.trim().replace(/^DNS:/, ""))
          .filter(Boolean);

        const matches =
          altNames.length > 0
            ? altNames.some((name) =>
                name.startsWith("*.")
                  ? hostname.endsWith(name.slice(1)) &&
                    hostname.split(".").length === name.split(".").length
                  : name.toLowerCase() === hostname.toLowerCase(),
              )
            : null;

        resolve({
          ok: authorized,
          issuer: firstValue(cert.issuer?.O) ?? firstValue(cert.issuer?.CN),
          subject: firstValue(cert.subject?.CN),
          validFrom: cert.valid_from ? new Date(cert.valid_from).toISOString() : null,
          validTo,
          daysRemaining: validTo ? daysUntil(validTo) : null,
          hostnameMatches: matches,
          altNames: altNames.slice(0, 30),
          error: authorized ? null : (authError ?? "Certificate did not validate."),
        });
      },
    );

    socket.on("error", (error) => {
      if (settled) return;
      settled = true;
      fail(error.message);
    });
    socket.on("timeout", () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fail("The TLS handshake timed out.");
    });
  });
}

type RdapEvent = { eventAction?: string; eventDate?: string };
type RdapEntity = { roles?: string[]; vcardArray?: unknown[] };
type RdapResponse = {
  events?: RdapEvent[];
  status?: string[];
  entities?: RdapEntity[];
};

/** Pull the registrar's organisation name out of an RDAP vCard. */
function registrarFrom(response: RdapResponse): string | null {
  for (const entity of response.entities ?? []) {
    if (!entity.roles?.includes("registrar")) continue;
    const vcard = entity.vcardArray?.[1];
    if (!Array.isArray(vcard)) continue;
    for (const field of vcard) {
      if (Array.isArray(field) && field[0] === "fn" && typeof field[3] === "string") {
        return field[3];
      }
    }
  }
  return null;
}

export function parseRdap(body: unknown): Omit<DomainCheck, "error"> {
  // Registries return all sorts of things on a bad day, including nothing.
  const response: RdapResponse =
    body && typeof body === "object" && !Array.isArray(body) ? (body as RdapResponse) : {};
  const expiryEvent = (response.events ?? []).find(
    (event) => event.eventAction === "expiration" || event.eventAction === "registrar expiration",
  );
  const expiresAt = expiryEvent?.eventDate ? new Date(expiryEvent.eventDate).toISOString() : null;

  return {
    ok: expiresAt !== null,
    registrar: registrarFrom(response),
    expiresAt,
    daysRemaining: expiresAt ? daysUntil(expiresAt) : null,
    statuses: (response.status ?? []).slice(0, 12),
    source: expiresAt ? "rdap" : "unavailable",
  };
}

/**
 * Domain expiry via RDAP — the free, public, IANA-run successor to WHOIS.
 *
 * Not every registry serves it: several ccTLDs, `.in` among them, return thin
 * records or nothing at all. When that happens we report "unknown" and say
 * why, rather than presenting a guessed date as fact.
 */
export async function checkDomain(hostname: string): Promise<DomainCheck> {
  const unavailable = (message: string): DomainCheck => ({
    ok: false,
    registrar: null,
    expiresAt: null,
    daysRemaining: null,
    statuses: [],
    source: "unavailable",
    error: message,
  });

  // RDAP is queried on the registrable domain, not the full hostname.
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 2) return unavailable("That doesn't look like a domain name.");
  const registrable = labels.slice(-2).join(".");

  const base = process.env.RDAP_BASE_URL?.trim() || "https://rdap.org/domain";
  try {
    const response = await fetch(`${base}/${encodeURIComponent(registrable)}`, {
      headers: { accept: "application/rdap+json" },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      redirect: "follow",
    });
    if (response.status === 404) {
      return unavailable(`No RDAP record for ${registrable}. The domain may be unregistered.`);
    }
    if (!response.ok) {
      return unavailable(
        `${registrable}'s registry did not answer over RDAP (${response.status}). Several country registries, .in among them, don't publish expiry this way.`,
      );
    }
    const parsed = parseRdap(await response.json());
    return {
      ...parsed,
      error: parsed.expiresAt
        ? null
        : `${registrable}'s registry answered but did not include an expiry date.`,
    };
  } catch (error) {
    return unavailable(`RDAP lookup failed: ${(error as Error).message}`);
  }
}
