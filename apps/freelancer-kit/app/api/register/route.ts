import { getStore } from "@probes/core/server";
import { buildRegister, financialYearOf } from "../../../lib/register.ts";
import { buildRegisterWorkbook } from "../../../lib/register-export.ts";
import type { InvoiceResult } from "../../../lib/invoice.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/register — combine invoices into a financial-year register. */
export async function POST(request: Request): Promise<Response> {
  let body: { ids?: unknown; year?: unknown; format?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = [
    ...new Set(
      (Array.isArray(body.ids) ? body.ids : []).filter(
        (id): id is string => typeof id === "string" && UUID.test(id),
      ),
    ),
  ].slice(0, 300);

  const store = getStore();
  const invoices: InvoiceResult[] = [];
  for (const id of ids) {
    const artifact = await store.getArtifact(id);
    if (!artifact || artifact.probe !== "freelancer-kit") continue;
    const payload = artifact.payload as unknown as { kind?: string; result?: InvoiceResult };
    if (payload.kind !== "invoice" || !payload.result) continue;
    invoices.push(payload.result);
  }

  if (invoices.length === 0) {
    return Response.json(
      { error: "None of those invoices could be found. They may have expired." },
      { status: 404 },
    );
  }

  const years = [
    ...new Map(
      invoices
        .filter((invoice) => invoice.input.invoiceDate)
        .map((invoice) => {
          const fy = financialYearOf(invoice.input.invoiceDate);
          return [fy.label, fy] as const;
        }),
    ).values(),
  ].sort((a, b) => a.startIso.localeCompare(b.startIso));

  const chosen =
    (typeof body.year === "string" ? years.find((y) => y.label === body.year) : undefined) ??
    years[years.length - 1] ??
    financialYearOf(new Date().toISOString().slice(0, 10));

  const register = buildRegister(invoices, chosen);
  const registered = invoices.some((invoice) => invoice.registered);

  if (body.format === "xlsx") {
    const workbook = await buildRegisterWorkbook(register);
    return new Response(new Uint8Array(workbook), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="invoice-register-${chosen.label}.xlsx"`,
        "cache-control": "private, max-age=300",
      },
    });
  }

  return Response.json(
    { register, availableYears: years, registered },
    { headers: { "cache-control": "no-store" } },
  );
}
