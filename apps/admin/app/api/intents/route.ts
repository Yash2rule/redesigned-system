import { isAuthenticated } from "../../../lib/auth.ts";
import { buildAudience, intentsCsv } from "../../../lib/outreach.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/intents?probe=... — the intent list as CSV. Password-gated. */
export async function GET(request: Request): Promise<Response> {
  if (!isAuthenticated(request.headers.get("cookie"))) {
    return new Response("Not signed in", { status: 401 });
  }

  const probe = new URL(request.url).searchParams.get("probe") ?? "all";
  const audience = await buildAudience(probe);
  const csv = intentsCsv(audience.intents);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="purchase-intent-${probe}.csv"`,
      "cache-control": "no-store",
    },
  });
}
