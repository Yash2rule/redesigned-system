import { getStore } from "@probes/core/server";
import { buildLedgerWorkbook } from "../../../lib/export.ts";
import { applyOverrides, parseOverrides } from "../../../lib/overrides.ts";
import type { LedgerResult } from "../../../lib/ledger.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

async function workbookResponse(id: string, overrides: unknown): Promise<Response> {
  const artifact = await getStore().getArtifact(id);
  if (!artifact || artifact.probe !== "ledger") {
    return new Response("That ledger has expired or never existed.", { status: 404 });
  }

  // The user's corrections live in their browser, so they travel with the
  // request. Applying them here means the spreadsheet can never disagree with
  // what they were looking at.
  const result = applyOverrides(
    artifact.payload as unknown as LedgerResult,
    parseOverrides(overrides),
  );

  const workbook = await buildLedgerWorkbook(result);
  return new Response(new Uint8Array(workbook), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="ledger-${id.slice(0, 8)}.xlsx"`,
      "cache-control": "private, max-age=300",
    },
  });
}

/** GET /api/export?id=... — the plain download, with no corrections applied. */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });
  return workbookResponse(id, {});
}

/**
 * POST /api/export — same workbook, with the caller's category corrections.
 *
 * A POST rather than a longer query string: the override map is unbounded and
 * URLs are not.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { id?: unknown; overrides?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) {
    return new Response("Missing id", { status: 400 });
  }
  return workbookResponse(body.id, body.overrides);
}
