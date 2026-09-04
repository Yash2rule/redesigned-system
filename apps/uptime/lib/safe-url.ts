import { lookup as lookupAsync } from "node:dns/promises";
import { lookup as lookupCb } from "node:dns";
import net from "node:net";
import { UserFacingError } from "@probes/core";

/**
 * Guards against this tool being used as an SSRF proxy.
 *
 * It accepts a hostname from a stranger and makes a request to it from our
 * server. Without these checks, anyone could point it at 169.254.169.254 or
 * at a service on our own private network and read the response back out of
 * the result page. So: only http/https, only ports 80 and 443, and every
 * resolved IP address must be publicly routable — checked again on each
 * redirect hop, because a public host can redirect to a private one.
 */

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function v4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

export function isPublicAddress(address: string, family: number): boolean {
  if (family === 4) {
    const value = v4ToInt(address);
    if (value === null) return false;
    for (const [network, bits] of BLOCKED_V4) {
      const base = v4ToInt(network);
      if (base === null) continue;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((value & mask) === (base & mask)) return false;
    }
    return true;
  }

  const normalised = address.toLowerCase().split("%")[0] ?? "";
  if (normalised === "::" || normalised === "::1") return false;
  if (normalised.startsWith("fe80")) return false; // link-local
  if (/^f[cd]/.test(normalised)) return false; // unique local
  if (normalised.startsWith("ff")) return false; // multicast
  // An address carrying an embedded IPv4 address must be judged as IPv4:
  // ::ffff:10.0.0.1 (IPv4-mapped) and the deprecated ::10.0.0.1
  // (IPv4-compatible, RFC 4291 2.5.5.1) — glibc will render an AAAA of
  // ::7f00:1 in exactly that dotted form.
  const mapped = normalised.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPublicAddress(mapped[1], 4);
  return true;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Tests point the checks at a real loopback server on an ephemeral port, so
 * they exercise real sockets rather than mocks.
 *
 * Deliberately narrow: it applies only under NODE_ENV=test, only with the
 * env flag set, and only to loopback hostnames. A production deployment that
 * somehow had the flag set would still refuse every routable private address,
 * which is the case that matters.
 */
function relaxedFor(hostname: string): boolean {
  return (
    process.env.NODE_ENV === "test" &&
    process.env.UPTIME_ALLOW_PRIVATE_HOSTS === "1" &&
    LOOPBACK_HOSTS.has(hostname.toLowerCase())
  );
}

export type SafeUrl = { url: URL; addresses: string[] };

export async function assertSafeUrl(raw: string): Promise<SafeUrl> {
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new UserFacingError(`"${raw.slice(0, 80)}" is not a valid address.`, 400);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserFacingError(`We only check http and https addresses, not ${url.protocol}`, 400);
  }
  const relaxed = relaxedFor(url.hostname);

  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (!relaxed && port !== "80" && port !== "443") {
    throw new UserFacingError(
      `We only check ports 80 and 443. "${url.hostname}:${port}" was refused.`,
      400,
    );
  }

  if (relaxed) return { url, addresses: [] };

  let resolved: { address: string; family: number }[];
  try {
    resolved = await lookupAsync(url.hostname, { all: true });
  } catch {
    throw new UserFacingError(
      `We couldn't resolve "${url.hostname}". Check the spelling, or the domain may have expired.`,
      422,
    );
  }
  if (resolved.length === 0) {
    throw new UserFacingError(`"${url.hostname}" has no DNS records.`, 422);
  }

  // Every address must be public: a host that resolves to both a public and a
  // private address is still a way in.
  for (const entry of resolved) {
    if (!isPublicAddress(entry.address, entry.family)) {
      throw new UserFacingError(
        `"${url.hostname}" resolves to a private address (${entry.address}). We only check addresses reachable from the public internet.`,
        400,
      );
    }
  }

  return { url, addresses: resolved.map((r) => r.address) };
}

/**
 * Closes the gap between checking an address and connecting to it.
 *
 * `assertSafeUrl` resolves a hostname and rejects it if anything it resolves
 * to is private. But it hands back a URL carrying the *hostname*, and every
 * client that then uses that URL — fetch, http.request, tls.connect — resolves
 * it again. Nothing caches DNS between those two resolutions, so an attacker
 * running their own authoritative nameserver can answer the check with a
 * public address of theirs and the connection with 169.254.169.254. The guard
 * passes and the socket still lands inside the network. That is DNS rebinding,
 * and re-validating each redirect hop does not help, because the swap happens
 * inside a single hop.
 *
 * So: don't resolve twice. Hand Node a `lookup` that ignores the hostname and
 * returns only the addresses we already validated. The name is still used for
 * SNI and the Host header, so virtual hosting and certificates keep working —
 * only the address selection is pinned.
 *
 * The addresses are re-checked here as well as in `assertSafeUrl`. That is
 * deliberate belt-and-braces: this function is the last thing standing between
 * a stranger's hostname and a real socket.
 */
export function pinnedLookup(addresses: string[]): typeof lookupCb {
  // Empty means the relaxed test path, which never resolved anything to pin
  // to. Fall through to real DNS; `relaxedFor` has already limited that to
  // loopback under NODE_ENV=test.
  if (addresses.length === 0) return lookupCb;

  const entries = addresses
    .map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 }))
    .filter((entry) => isPublicAddress(entry.address, entry.family));

  return ((hostname: string, options: unknown, callback: unknown) => {
    // Node calls lookup as (hostname, callback) or (hostname, options, callback).
    const done = (typeof options === "function" ? options : callback) as (
      error: NodeJS.ErrnoException | null,
      address?: unknown,
      family?: number,
    ) => void;
    const opts = (typeof options === "function" ? {} : options) as {
      family?: number | string;
      all?: boolean;
    };

    const wanted = Number(opts.family);
    const matching =
      wanted === 4 || wanted === 6 ? entries.filter((e) => e.family === wanted) : entries;

    const first = matching[0];
    if (!first) {
      const error: NodeJS.ErrnoException = new Error(
        `No verified public address for ${hostname}.`,
      );
      error.code = "ENOTFOUND";
      done(error);
      return;
    }

    if (opts.all) done(null, matching);
    else done(null, first.address, first.family);
  }) as typeof lookupCb;
}
