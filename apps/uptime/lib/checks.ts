import net from "node:net";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { assertSafeUrl, pinnedLookup } from "./safe-url.ts";

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
const USER_AGENT = "UptimeProbe/1.0 (+https://github.com)";

/**
 * Turns a socket error into something a customer can act on.
 *
 * Node's messages carry the address it tried ("connect ECONNREFUSED
 * 203.0.113.4:443"). That address is always one we validated as public, so it
 * is not a leak — but it is noise to a person reading a status page, and
 * keeping it out of the response means an error string can never become an
 * oracle for anything.
 */
function describeConnectionError(error: Error): string {
  if (error.name === "TimeoutError") return error.message;
  const code = (error as NodeJS.ErrnoException).code;
  switch (code) {
    case "ECONNREFUSED":
      return "Nothing accepted a connection on that port.";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "The hostname did not resolve.";
    case "ECONNRESET":
      return "The server closed the connection before responding.";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "The host was unreachable.";
    case "CERT_HAS_EXPIRED":
      return "The server's TLS certificate has expired.";
    default:
      return code ? `The connection failed (${code}).` : error.message;
  }
}

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

type RawResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
};

/**
 * One HTTP request, sent to an address `assertSafeUrl` already vetted.
 *
 * This is node:http rather than fetch for one reason: fetch gives no way to
 * choose the address it connects to without an undici dispatcher, and this
 * app has to pin the address to close the DNS-rebinding hole (see
 * `pinnedLookup`). `http.request` takes a `lookup` directly. Redirects are
 * followed by hand either way, so nothing is lost — `request` simply does not
 * follow them at all, where fetch needed `redirect: "manual"`.
 */
function requestOnce(url: URL, addresses: string[]): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";
    const client = secure ? https : http;
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const isIpLiteral = net.isIP(hostname) !== 0;

    const request = client.request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { "user-agent": USER_AGENT, host: url.host },
        lookup: pinnedLookup(addresses),
        // SNI must not carry an IP address (RFC 6066).
        ...(secure && !isIpLiteral ? { servername: hostname } : {}),
        timeout: HTTP_TIMEOUT_MS,
      },
      (response) => {
        // Nothing here reads the body — deliberately, so this can never be
        // used to read a page back out of somebody else's network. Draining
        // it frees the socket.
        response.resume();
        resolve({ status: response.statusCode ?? 0, headers: response.headers });
      },
    );

    request.on("error", (error) => reject(error));
    request.on("timeout", () => {
      request.destroy(new TimeoutError());
    });
    request.end();
  });
}

class TimeoutError extends Error {
  constructor() {
    super(`No response within ${HTTP_TIMEOUT_MS / 1000} seconds.`);
    this.name = "TimeoutError";
  }
}

export async function checkHttp(rawUrl: string): Promise<HttpCheck> {
  const redirects: string[] = [];
  let current: string;
  let addresses: string[];
  try {
    const safe = await assertSafeUrl(rawUrl);
    current = safe.url.toString();
    addresses = safe.addresses;
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
      const response = await requestOnce(new URL(current), addresses);

      const location = firstValue(response.headers.location) ?? null;
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
          const safe = await assertSafeUrl(next);
          current = safe.url.toString();
          addresses = safe.addresses;
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
        const value = firstValue(response.headers[name]);
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
      const message = describeConnectionError(error as Error);
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

/**
 * Read the certificate straight off a TLS handshake. No API, no cost.
 *
 * `addresses` are the ones `assertSafeUrl` vetted for this hostname. Passing
 * them pins the socket to an address we checked, instead of letting Node
 * resolve the name a second time — see `pinnedLookup`. Callers that have not
 * resolved the name pass nothing and get ordinary DNS.
 */
export function checkTls(
  hostname: string,
  port = 443,
  addresses: string[] = [],
): Promise<TlsCheck> {
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

    // SNI must not carry an IP address (RFC 6066). Sending one is ignored by
    // servers and deprecated by Node; omitting it is the correct behaviour.
    const isIpLiteral =
      /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");

    let settled = false;
    const socket = tls.connect(
      {
        host: hostname,
        port,
        lookup: pinnedLookup(addresses),
        ...(isIpLiteral ? {} : { servername: hostname }),
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
      fail(describeConnectionError(error));
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
 * Second-level suffixes where the registrable domain is three labels, not two.
 *
 * A deliberate subset, not a public suffix list. Pulling in the real PSL is
 * ~200KB that changes monthly, for a probe whose visitors are overwhelmingly
 * on `.in`, `.co.in` and a handful of gTLDs. These are the ones that would
 * otherwise be looked up as "co.in" or "co.uk" — a query about the registry
 * itself rather than about anybody's domain. If a suffix is missing here the
 * lookup degrades to "unknown", which is the honest failure, never a wrong
 * date. Add to it when a real domain lands in the wrong bucket.
 */
const MULTIPART_SUFFIXES = new Set([
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in", "ac.in", "edu.in", "res.in", "gov.in",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "net.uk", "sch.uk", "me.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au",
  "co.nz", "net.nz", "org.nz", "co.za", "org.za", "com.br", "com.sg", "com.my",
]);

/**
 * The registrable domain — what RDAP is queried on. `www.acme.co.in` is
 * `acme.co.in`, not `co.in`.
 */
export function registrableDomain(hostname: string): string | null {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return null;
  const lastTwo = labels.slice(-2).join(".");
  if (MULTIPART_SUFFIXES.has(lastTwo)) {
    return labels.length >= 3 ? labels.slice(-3).join(".") : null;
  }
  return lastTwo;
}

type BootstrapService = [string[], string[]];

/**
 * IANA publishes which RDAP server is authoritative for each TLD. Parsing is
 * split out from fetching so it can be tested without a network.
 */
export function parseRdapBootstrap(body: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const services = (body as { services?: unknown })?.services;
  if (!Array.isArray(services)) return map;
  for (const service of services as BootstrapService[]) {
    if (!Array.isArray(service) || service.length < 2) continue;
    const [tlds, urls] = service;
    if (!Array.isArray(tlds) || !Array.isArray(urls)) continue;
    // Registries list both http and https; take the secure one where offered.
    const url = urls.find((u) => typeof u === "string" && u.startsWith("https://")) ?? urls[0];
    if (typeof url !== "string") continue;
    for (const tld of tlds) {
      if (typeof tld === "string" && tld) map.set(tld.toLowerCase(), url.endsWith("/") ? url : `${url}/`);
    }
  }
  return map;
}

const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
let bootstrapCache: { fetchedAt: number; map: Map<string, string> } | null = null;

/** Exposed so tests can start from a known state. */
export function resetRdapBootstrap(): void {
  bootstrapCache = null;
}

async function rdapBaseFor(tld: string): Promise<string | null> {
  if (bootstrapCache && Date.now() - bootstrapCache.fetchedAt < BOOTSTRAP_TTL_MS) {
    return bootstrapCache.map.get(tld) ?? null;
  }
  const response = await fetch(BOOTSTRAP_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`IANA's RDAP registry answered ${response.status}`);
  const map = parseRdapBootstrap(await response.json());
  if (map.size === 0) throw new Error("IANA's RDAP registry was empty or unreadable");
  bootstrapCache = { fetchedAt: Date.now(), map };
  return map.get(tld) ?? null;
}

/**
 * Domain expiry via RDAP — the free, public, IANA-run successor to WHOIS.
 *
 * Queries the registry that IANA names as authoritative for the TLD, rather
 * than going through a redirector. That is not a preference: `rdap.org`, the
 * obvious redirector and what this used to use, returns 403 to requests from
 * Vercel, so every lookup in production failed while the parsing underneath
 * was working perfectly.
 *
 * `RDAP_BASE_URL` still overrides the lookup, and is a query base to which
 * `/<domain>` is appended. Be careful with it: one base serves one registry,
 * so pinning it to a `.com` server makes every `.in` domain look unregistered.
 * It exists for tests and for pinning a single-TLD deployment, not as a fix.
 *
 * Not every registry serves RDAP, and when one doesn't we report "unknown"
 * and say why, rather than presenting a guessed date as fact. `.in` used to
 * be listed here as an example of that; it is not one. It answers in full,
 * `.co.in` included — the redirector was the thing that never worked.
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

  const registrable = registrableDomain(hostname);
  if (!registrable) return unavailable("That doesn't look like a domain name.");
  const tld = registrable.split(".").pop() as string;

  let query: string;
  const override = process.env.RDAP_BASE_URL?.trim();
  if (override) {
    query = `${override.replace(/\/$/, "")}/${encodeURIComponent(registrable)}`;
  } else {
    let base: string | null;
    try {
      base = await rdapBaseFor(tld);
    } catch (error) {
      return unavailable(`Could not reach IANA's RDAP registry: ${(error as Error).message}`);
    }
    if (!base) {
      return unavailable(
        `.${tld} has no RDAP service listed with IANA, so expiry cannot be looked up. A few country registries still don't publish one.`,
      );
    }
    query = `${base}domain/${encodeURIComponent(registrable)}`;
  }

  try {
    const response = await fetch(query, {
      headers: { accept: "application/rdap+json" },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      redirect: "follow",
    });
    if (response.status === 404) {
      return unavailable(`No RDAP record for ${registrable}. The domain may be unregistered.`);
    }
    if (!response.ok) {
      return unavailable(
        `${registrable}'s registry did not answer over RDAP (${response.status}). Some registries rate-limit or refuse automated lookups.`,
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
