import { getStore } from "../store/index.ts";
import type { ProbeId } from "../types.ts";

/**
 * Whether a probe has been retired, for the code paths that act on it.
 *
 * FAILS OPEN, DELIBERATELY. Every unknown answers "not retired": a database
 * blip, a timeout, a cold start that cannot reach the pooler. The two ways to
 * be wrong are not symmetrical. Showing a live probe for an extra minute after
 * it was killed costs a few rows of data nobody will read. Showing "this
 * experiment has ended" across four working products because a query failed is
 * a self-inflicted outage that also lies to everyone who sees it.
 */

const TTL_MS = 60_000;

type Entry = { retired: boolean; at: number };
const cache = new Map<ProbeId, Entry>();

/** Exposed for tests, and for the cron to clear after it writes a verdict. */
export function clearRetiredCache(): void {
  cache.clear();
}

export async function isRetired(probe: ProbeId): Promise<boolean> {
  const hit = cache.get(probe);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.retired;

  try {
    const states = await getStore().getProbeStates();
    const retired = states.find((s) => s.probe === probe)?.decision === "kill";
    cache.set(probe, { retired, at: Date.now() });
    return retired;
  } catch {
    // Do not cache a failure: the next request should try again rather than
    // inherit a minute of this one's bad luck.
    return hit?.retired ?? false;
  }
}

/** The message every retired surface shows. Honest, and identical everywhere. */
export const RETIRED_MESSAGE =
  "This experiment has ended. It ran to find out whether enough people wanted it, " +
  "and the answer was no — so it is not collecting anything further and the prices " +
  "it used to show are gone. Nothing you entered here is being used for anything.";
