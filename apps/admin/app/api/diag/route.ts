import { getStore } from "@probes/core/server";
import { isAuthenticated } from "../../../lib/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TEMPORARY diagnostic. Times each store call and reports the real error. */
export async function GET(request: Request): Promise<Response> {
  if (!isAuthenticated(request.headers.get("cookie"))) {
    return new Response("no", { status: 401 });
  }
  const store = getStore();
  const out: Record<string, unknown> = {};
  const time = async (name: string, run: () => Promise<unknown>) => {
    const started = Date.now();
    try {
      const value = await run();
      out[name] = { ms: Date.now() - started, ok: true, sample: JSON.stringify(value).slice(0, 200) };
    } catch (error) {
      out[name] = {
        ms: Date.now() - started,
        ok: false,
        error: (error as Error).message,
        code: (error as { code?: string }).code ?? null,
        stack: ((error as Error).stack ?? "").split("\n").slice(0, 4).join(" | "),
      };
    }
  };
  await time("getProbeStates_first", () => store.getProbeStates());
  await time("getProbeStates_again", () => store.getProbeStates());
  await time("corpusCounts", () => store.corpusCounts());
  await time("recentIntents", () => store.recentIntents(5));
  await time("funnel", () => store.funnel());
  return new Response(JSON.stringify(out, null, 1), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
