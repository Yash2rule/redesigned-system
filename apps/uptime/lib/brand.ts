/**
 * The agency's mark on the status page.
 *
 * A logo is a URL the agency already hosts, not an upload: there is no file
 * store here, and asking someone to upload a PNG to put their own logo on
 * their own page is friction for no gain.
 *
 * The browser fetches it, not us, so there is no SSRF surface — but the URL is
 * still written by one stranger and displayed to another, so it is validated
 * rather than trusted. https only, because the status page is https and a
 * mixed-content image silently fails to load, which looks like our bug.
 */

const MAX_URL_LENGTH = 300;

export type Brand = { name: string; color: string; logoUrl?: string };

export function normaliseLogoUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return undefined;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }

  // https only. Rejecting javascript:, data: and everything else is the point
  // — this string ends up in an src attribute on a page other people open.
  if (url.protocol !== "https:") return undefined;
  return url.toString();
}
