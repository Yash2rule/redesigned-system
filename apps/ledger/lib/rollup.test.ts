import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jsonRequest, useTempStore } from "../../../tests/helpers.ts";
import { POST as ledgerRoute } from "../app/api/ledger/route.ts";
import { POST as rollupRoute } from "../app/api/rollup/route.ts";
import { buildLedger } from "./ledger.ts";
import {
  buildRollup,
  financialYearOf,
  financialYearsIn,
  monthsInYear,
  transactionKey,
} from "./rollup.ts";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "fixtures", name), "utf8");
const rows = () => fixture("statement-hdfc.csv").split("\n").map((l) => l.split(","));

let store: ReturnType<typeof useTempStore>;
beforeAll(() => {
  store = useTempStore();
});
afterAll(() => store.cleanup());

describe("the Indian financial year", () => {
  it("runs April to March, not January to December", () => {
    // Filing against the wrong twelve months is not a rounding error.
    expect(financialYearOf("2026-04-01").label).toBe("2026-27");
    expect(financialYearOf("2026-03-31").label).toBe("2025-26");
    expect(financialYearOf("2025-12-31").label).toBe("2025-26");
    expect(financialYearOf("2026-01-15").label).toBe("2025-26");
  });

  it("gives the right boundaries", () => {
    const fy = financialYearOf("2026-01-15");
    expect(fy.startIso).toBe("2025-04-01");
    expect(fy.endIso).toBe("2026-03-31");
  });

  it("lists twelve months starting in April", () => {
    const months = monthsInYear(financialYearOf("2025-06-01"));
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-04");
    expect(months[11]).toBe("2026-03");
  });

  it("finds every year present in a set of transactions", () => {
    const years = financialYearsIn([
      { date: "2025-05-01" },
      { date: "2026-02-01" },
      { date: "2026-06-01" },
    ]);
    expect(years.map((y) => y.label)).toEqual(["2025-26", "2026-27"]);
  });
});

describe("de-duplication across overlapping exports", () => {
  it("identifies the same transaction regardless of reference number", () => {
    const base = {
      date: "2026-04-02",
      narration: "UPI-SWIGGY-swiggy@ybl",
      amountMinor: -48600,
      balanceMinor: null,
      category: "food-delivery" as const,
      categoryLabel: "Food & dining",
      matchedOn: "swiggy",
      basis: "rule" as const,
    };
    // Banks give the same transaction different references in two exports.
    expect(transactionKey({ ...base, reference: "A1" })).toBe(
      transactionKey({ ...base, reference: "B2" }),
    );
    expect(transactionKey({ ...base, reference: "A1" })).not.toBe(
      transactionKey({ ...base, reference: "A1", amountMinor: -48601 }),
    );
  });

  it("counts a transaction present in two statements exactly once", () => {
    const ledger = buildLedger(rows());
    const fy = financialYearOf(ledger.period.from);

    const one = buildRollup([{ id: "a", label: "A", result: ledger }], fy);
    const twice = buildRollup(
      [
        { id: "a", label: "A", result: ledger },
        { id: "b", label: "B (the same export again)", result: ledger },
      ],
      fy,
    );

    // Double-counted income is worse than no rollup at all.
    expect(twice.totals.count).toBe(one.totals.count);
    expect(twice.totals.moneyIn).toBe(one.totals.moneyIn);
    expect(twice.duplicatesRemoved).toBe(one.totals.count);
    expect(twice.sources[1]?.duplicates).toBe(one.totals.count);
  });
});

describe("buildRollup", () => {
  const ledger = () => buildLedger(rows());

  it("keeps only the chosen financial year", () => {
    const result = ledger();
    // The fixture is Apr-Jun 2026, which is FY 2026-27.
    const wrongYear = buildRollup([{ id: "a", label: "A", result }], financialYearOf("2024-06-01"));
    expect(wrongYear.totals.count).toBe(0);
    expect(wrongYear.outOfYearRemoved).toBe(result.totals.count);
  });

  it("reports the months with nothing in them", () => {
    const result = ledger();
    const rollup = buildRollup([{ id: "a", label: "A", result }], financialYearOf(result.period.from));
    // Three months of data in a twelve-month year.
    expect(rollup.missingMonths).toHaveLength(9);
    expect(rollup.notes.join(" ")).toContain("statement is missing");
  });

  it("totals the year, and the months add back up to it", () => {
    const result = ledger();
    const rollup = buildRollup([{ id: "a", label: "A", result }], financialYearOf(result.period.from));
    const monthIn = rollup.byMonth.reduce((s, m) => s + m.moneyIn, 0);
    const monthOut = rollup.byMonth.reduce((s, m) => s + m.moneyOut, 0);
    expect(monthIn).toBe(rollup.totals.moneyIn);
    expect(monthOut).toBe(rollup.totals.moneyOut);
    expect(rollup.totals.net).toBe(rollup.totals.moneyIn - rollup.totals.moneyOut);
  });

  it("says plainly that it can only count what it was given", () => {
    const result = ledger();
    const rollup = buildRollup([{ id: "a", label: "A", result }], financialYearOf(result.period.from));
    expect(rollup.notes.join(" ")).toContain("cannot know what we were not given");
  });
});

describe("POST /api/rollup", () => {
  async function statementId(): Promise<string> {
    const response = await ledgerRoute(
      jsonRequest("http://localhost/api/ledger", {}) &&
        new Request("http://localhost/api/ledger", {
          method: "POST",
          body: (() => {
            const form = new FormData();
            form.append("text", fixture("statement-hdfc.csv"));
            return form;
          })(),
        }),
    );
    return ((await response.json()) as { id: string }).id;
  }

  it("combines statements and reports the years available", async () => {
    const id = await statementId();
    const response = await rollupRoute(
      jsonRequest("http://localhost/api/rollup", { ids: [id, id] }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      rollup: { totals: { count: number }; duplicatesRemoved: number };
      availableYears: { label: string }[];
    };
    expect(body.rollup.totals.count).toBeGreaterThan(0);
    // The same id twice must not double the year.
    expect(body.rollup.duplicatesRemoved).toBe(0);
    expect(body.availableYears.map((y) => y.label)).toContain("2026-27");
  });

  it("applies the caller's category corrections to the whole year", async () => {
    const id = await statementId();
    const response = await rollupRoute(
      jsonRequest("http://localhost/api/rollup", {
        ids: [id],
        overrides: { swiggy: "professional-fees" },
      }),
    );
    const body = (await response.json()) as {
      rollup: { byCategory: { category: string; total: number }[] };
    };
    const fees = body.rollup.byCategory.find((c) => c.category === "professional-fees");
    expect(fees?.total).toBeGreaterThan(0);
  });

  it("returns a workbook when asked", async () => {
    const id = await statementId();
    const response = await rollupRoute(
      jsonRequest("http://localhost/api/rollup", { ids: [id], format: "xlsx" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("rejects ids that are not ids, rather than trusting them", async () => {
    const response = await rollupRoute(
      jsonRequest("http://localhost/api/rollup", { ids: ["../../etc/passwd", 42, null] }),
    );
    expect(response.status).toBe(404);
  });

  it("404s when nothing resolves", async () => {
    const response = await rollupRoute(
      jsonRequest("http://localhost/api/rollup", {
        ids: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
      }),
    );
    expect(response.status).toBe(404);
  });
});
