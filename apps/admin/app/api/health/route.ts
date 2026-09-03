import { capabilities } from "@probes/core";
import { adminConfigured } from "../../../lib/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deliberately reveals no data: capability flags only, never counts. */
export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      app: "admin",
      ok: true,
      passwordSet: adminConfigured(),
      capabilities: capabilities(),
      time: new Date().toISOString(),
    }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
