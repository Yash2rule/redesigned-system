import { getStore } from "@probes/core/server";
import { applyOverrides, parseOverrides } from "../../../lib/overrides.ts";
import { buildRollup, financialYearOf, financialYearsIn } from "../../../lib/rollup.ts";
import { buildRollupWorkbook } from "../../../lib/rollup-export.ts";
import type { LedgerResult } from "../../../lib/ledger.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(ids: unknown, overrides: unknown) {
  const list = Array.isArray(ids) ? ids : [];
  const clean = [...new Set(list.filter((id): id is string => typeof id === "string" && UUID.test(id)))].slice(0, 24);
  const parsedOverrides = parseOverrides(overrides);

  const store = getStore();
  const sources: { id: string; label: string; result: LedgerResult }[] = [];
  const missing: string[] = [];

  for (const id of clean) {
    const artifact = await store.getArtifact(id);
    if (!artifact || artifact.probe !== "ledger") {
      missing.push(id);
      continue;
    }
    // The user's category corrections apply to the year as much as to one
    // statement, or the rollup would disagree with every page they came from.
    const result = applyOverrides(artifact.payload as unknown as LedgerResult, parsedOverrides);
    sources.push({
      id,
      label: `${result.period.from} to ${result.period.to} (${result.totals.count} rows)`,
      result,
    });
  }
  return { sources, missing };
}

/** POST /api/rollup — combine statements into one financial year. */
export async function POST(request: Request): Promise<Response> {
  let body: { ids?: unknown; year?: unknown; overrides?: unknown; format?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { sources, missing } = await load(body.ids, body.overrides);
  if (sources.length === 0) {
    return new Response(
      JSON.stringify({ error: "None of those statements could be found. They may have expired." }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }

  const allEntries = sources.flatMap((source) => source.result.entries);
  const years = financialYearsIn(allEntries);
  const chosen =
    (typeof body.year === "string" ? years.find((y) => y.label === body.year) : undefined) ??
    years[years.length - 1] ??
    financialYearOf(new Date().toISOString().slice(0, 10));

  const rollup = buildRollup(sources, chosen);

  if (body.format === "xlsx") {
    const workbook = await buildRollupWorkbook(rollup);
    return new Response(new Uint8Array(workbook), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="financial-year-${chosen.label}.xlsx"`,
        "cache-control": "private, max-age=300",
      },
    });
  }

  return new Response(
    JSON.stringify({ rollup, availableYears: years, missing }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
