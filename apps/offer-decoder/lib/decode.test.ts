import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formRequest, useTempStore } from "../../../tests/helpers.ts";
import { POST as decode } from "../app/api/decode/route.ts";
import { GET as report } from "../app/api/report/route.ts";
import { parseOfferText } from "./parse.ts";
import { detectRedFlags, detectMissingClauses } from "./redflags.ts";
import { computeSalary } from "./salary.ts";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "fixtures", name), "utf8");

let store: ReturnType<typeof useTempStore>;
beforeAll(() => {
  store = useTempStore();
});
afterAll(() => store.cleanup());

describe("parseOfferText", () => {
  it("reads a two-column monthly/annual breakup and keeps the annual figures", () => {
    const parsed = parseOfferText(fixture("offer-letter-1.txt"));
    const value = (key: string) =>
      parsed.components.find((c) => c.key === key)?.annual ?? 0;

    expect(value("basic")).toBe(9_60_000 * 100);
    expect(value("hra")).toBe(4_80_000 * 100);
    expect(value("specialAllowance")).toBe(4_44_800 * 100);
    expect(value("employerPf")).toBe(1_15_200 * 100);
    expect(value("variablePay")).toBe(2_40_000 * 100);
    expect(value("totalCtc")).toBe(24_00_000 * 100);
    expect(parsed.unmatched).toHaveLength(0);
  });

  it("reads a single-column annual breakup", () => {
    const parsed = parseOfferText(fixture("offer-letter-2.txt"));
    const value = (key: string) => parsed.components.find((c) => c.key === key)?.annual ?? 0;
    expect(value("basic")).toBe(7_20_000 * 100);
    expect(value("totalCtc")).toBe(18_00_000 * 100);
    expect(value("variablePay")).toBe(1_80_000 * 100);
  });

  it("understands lakh shorthand", () => {
    const parsed = parseOfferText(fixture("offer-letter-3-ctc-only.txt"));
    expect(parsed.components.find((c) => c.key === "totalCtc")?.annual).toBe(32_00_000 * 100);
  });

  it("does not mistake a year for a salary", () => {
    const parsed = parseOfferText("Date of joining: 2026\nTotal CTC: 10,00,000 per annum");
    expect(parsed.components.find((c) => c.key === "totalCtc")?.annual).toBe(10_00_000 * 100);
  });
});

describe("detectRedFlags", () => {
  const flags = detectRedFlags(fixture("offer-letter-1.txt"));
  const ids = flags.map((f) => f.id);

  it("finds the bond, the clawback and the discretionary variable", () => {
    expect(ids).toContain("bond");
    expect(ids).toContain("clawback");
    expect(ids).toContain("variable-discretion");
    expect(ids).toContain("training-recovery");
    expect(ids).toContain("no-notice-buyout");
  });

  it("quotes the sentence it matched, so the user can check it", () => {
    const clawback = flags.find((f) => f.id === "clawback");
    expect(clawback?.quote.toLowerCase()).toContain("joining bonus");
    expect(clawback?.quote.length).toBeGreaterThan(20);
  });

  it("sorts the highest-severity flags first", () => {
    expect(flags[0]?.severity).toBe("high");
  });

  it("flags a 90-day notice period but not a 30-day one", () => {
    expect(detectRedFlags("The notice period shall be 90 days.").map((f) => f.id)).toContain(
      "notice-long",
    );
    expect(detectRedFlags("The notice period shall be 30 days.").map((f) => f.id)).not.toContain(
      "notice-long",
    );
  });

  it("finds nothing in a document with no clauses", () => {
    expect(detectRedFlags("Basic 100000\nHRA 50000")).toHaveLength(0);
  });
});

describe("detectMissingClauses", () => {
  it("does not treat 'Leave Travel Allowance' as a leave policy", () => {
    const missing = detectMissingClauses("Leave Travel Allowance 80,000");
    expect(missing.some((m) => m.includes("leave policy"))).toBe(true);
  });

  it("stays quiet when the policy really is mentioned", () => {
    const missing = detectMissingClauses("You are entitled to 24 days of earned leave per year.");
    expect(missing.some((m) => m.includes("leave policy"))).toBe(false);
  });
});

describe("POST /api/decode", () => {
  it("turns a full offer letter into a complete, arithmetically sound result", async () => {
    const response = await decode(
      formRequest(
        "http://localhost/api/decode",
        { state: "KA", pfBasis: "full-basic", downsidePayoutRatio: "0.7" },
        { name: "offer.txt", content: fixture("offer-letter-1.txt") },
      ),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { id: string; result: any };
    const { salary } = body.result;

    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(salary.ctc).toBe(24_00_000 * 100);
    expect(salary.ctcWasStated).toBe(true);

    // Fixed cash = basic + HRA + special + LTA.
    expect(salary.fixedCash).toBe((9_60_000 + 4_80_000 + 4_44_800 + 80_000) * 100);
    // Employee PF = 12% of basic.
    expect(salary.employeePf).toBe(Math.round(9_60_000 * 0.12) * 100);
    // Karnataka professional tax.
    expect(salary.professionalTax).toBe(2_400 * 100);

    // A ₹24L offer should land somewhere sane, not off by a factor of twelve.
    expect(salary.monthlyInHand).toBeGreaterThan(1_00_000 * 100);
    expect(salary.monthlyInHand).toBeLessThan(1_60_000 * 100);

    // The downside must be strictly worse, but not catastrophically so at 70%.
    const perMonthGap = (salary.variableAtFullPayout - salary.variableAtDownside) / 12;
    expect(salary.monthlyInHandDownside).toBe(Math.round(salary.monthlyInHand - perMonthGap));
    expect(salary.variableAtDownside).toBe(Math.round(salary.variableAtFullPayout * 0.7));

    expect(body.result.redFlags.length).toBeGreaterThanOrEqual(5);
    expect(salary.assumptions.length).toBeGreaterThan(0);
  });

  it("defaults the payout ratio when the field is absent, rather than assuming zero", async () => {
    const response = await decode(
      formRequest(
        "http://localhost/api/decode",
        { state: "KA" },
        { name: "offer.txt", content: fixture("offer-letter-1.txt") },
      ),
    );
    const { result } = (await response.json()) as { result: any };
    expect(result.options.downsidePayoutRatio).toBe(0.7);
    expect(result.salary.variableAtDownside).toBeGreaterThan(0);
  });

  it("accepts pasted text as well as a file", async () => {
    const response = await decode(
      formRequest("http://localhost/api/decode", {
        state: "MH",
        text: fixture("offer-letter-2.txt"),
      }),
    );
    expect(response.status).toBe(200);
    const { result } = (await response.json()) as { result: any };
    expect(result.salary.ctc).toBe(18_00_000 * 100);
    expect(result.salary.professionalTax).toBe(2_500 * 100);
  });

  it("reconstructs a plausible structure when only a CTC number is given", async () => {
    const response = await decode(
      formRequest("http://localhost/api/decode", {
        state: "DL",
        text: fixture("offer-letter-3-ctc-only.txt"),
      }),
    );
    const { result } = (await response.json()) as { result: any };
    expect(result.salary.ctc).toBe(32_00_000 * 100);
    expect(result.salary.professionalTax).toBe(0); // Delhi levies none
    expect(result.salary.assumptions.join(" ")).toContain("didn't break out basic pay");
    expect(result.salary.gaps.join(" ")).toContain("No component-wise breakup");
  });

  it("says something useful when the text has no salary in it", async () => {
    const response = await decode(
      formRequest("http://localhost/api/decode", {
        text: "Dear candidate, we are delighted to welcome you to the team. Please report on Monday.",
      }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("couldn't find any salary figures");
  });

  it("rejects an empty submission", async () => {
    const response = await decode(formRequest("http://localhost/api/decode", {}));
    expect(response.status).toBe(400);
  });

  it("refuses an image instead of pretending to read it", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const response = await decode(
      formRequest("http://localhost/api/decode", {}, { name: "offer.png", content: png }),
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toContain("can't read images");
  });
});

describe("GET /api/report", () => {
  it("renders the stored result as a real PDF", async () => {
    const decoded = await decode(
      formRequest(
        "http://localhost/api/decode",
        { state: "KA" },
        { name: "offer.txt", content: fixture("offer-letter-1.txt") },
      ),
    );
    const { id } = (await decoded.json()) as { id: string };

    const response = await report(new Request(`http://localhost/api/report?id=${id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(3000);
  });

  it("404s on an unknown id rather than throwing", async () => {
    const response = await report(new Request("http://localhost/api/report?id=nope"));
    expect(response.status).toBe(404);
  });
});

describe("apportioning tax between fixed and variable pay", () => {
  /**
   * The monthly headline shows tax on guaranteed cash only, because tax on a
   * bonus is deducted when the bonus is paid. That apportionment is a fraction,
   * and both halves must describe the same total — the numerator counted the
   * employer-PF perquisite while the denominator did not, so the fraction could
   * exceed 1 and subtract more than the whole year's tax.
   */
  const decode = (letter: string) =>
    computeSalary({
      parsed: parseOfferText(letter),
      state: "KA",
      pfBasis: "full-basic",
      extraOldRegimeDeductions: 0,
      downsidePayoutRatio: 1,
    });

  /** Tax actually deducted from the guaranteed portion, read back out. */
  const taxOnFixed = (r: ReturnType<typeof computeSalary>, outcome: { annualInHand: number }) =>
    r.fixedCash - r.employeePf - r.professionalTax - outcome.annualInHand;

  it("never deducts more than the year's tax, even with a large PF perquisite", () => {
    // Employer PF above ₹7.5 lakh is a taxable perquisite. With no variable
    // component this was the exact shape that pushed the ratio over 1.
    const result = decode(`Offer of Employment
Basic Salary: Rs 75,00,000 per annum
House Rent Allowance: Rs 37,50,000 per annum
Special Allowance: Rs 20,00,000 per annum
Employer PF Contribution: Rs 9,00,000 per annum
`);

    expect(result.employerPf).toBeGreaterThan(750_000 * 100);
    for (const outcome of result.regimes) {
      const deducted = taxOnFixed(result, outcome);
      expect(deducted).toBeLessThanOrEqual(outcome.tax.total);
      expect(deducted).toBeGreaterThanOrEqual(0);
      expect(outcome.monthlyInHand).toBeGreaterThan(0);
    }
  });

  it("still holds when there is variable pay", () => {
    const result = decode(`Offer of Employment
Basic Salary: Rs 20,00,000 per annum
House Rent Allowance: Rs 10,00,000 per annum
Special Allowance: Rs 10,00,000 per annum
Variable Pay: Rs 8,00,000 per annum
`);
    for (const outcome of result.regimes) {
      const deducted = taxOnFixed(result, outcome);
      expect(deducted).toBeLessThan(outcome.tax.total);
      expect(deducted).toBeGreaterThan(0);
    }
  });

  it("attributes the whole year's tax to fixed pay when there is nothing else", () => {
    const result = decode(`Offer of Employment
Basic Salary: Rs 8,00,000 per annum
House Rent Allowance: Rs 4,00,000 per annum
Special Allowance: Rs 4,00,000 per annum
`);
    for (const outcome of result.regimes) {
      expect(taxOnFixed(result, outcome)).toBe(outcome.tax.total);
    }
  });
});

describe("every flag quotes the clause it actually matched", () => {
  const fixture = (name: string) =>
    readFileSync(path.join(process.cwd(), "fixtures", name), "utf8");

  /**
   * The product's central promise is "each one quotes your own letter …
   * nothing here is invented". The strongest check available without reaching
   * into the rules: a quote must be enough, on its own, to trigger the same
   * rule. If it is a window of surrounding text that happens to sit near the
   * match, it will not be.
   */
  for (const name of ["offer-letter-1.txt", "offer-letter-2.txt", "offer-letter-3-ctc-only.txt"]) {
    it(`holds for ${name}`, () => {
      const flags = detectRedFlags(fixture(name));
      expect(flags.length).toBeGreaterThan(0);
      for (const flag of flags) {
        const reRun = detectRedFlags(flag.quote).map((f) => f.id);
        expect(reRun, `"${flag.title}" quoted text that does not contain its own clause`).toContain(
          flag.id,
        );
      }
    });
  }

  it("quotes the notice clause for notice, not the salary table", () => {
    // The exact regression: collapsing newlines before splitting left the
    // whole document as a handful of enormous sentences, so this flag quoted
    // the compensation table — which reads precisely like the invention the
    // quote exists to rule out.
    const flag = detectRedFlags(fixture("offer-letter-1.txt")).find((f) =>
      /notice/i.test(f.title),
    );
    expect(flag?.quote).toMatch(/notice period/i);
    expect(flag?.quote).not.toMatch(/Basic Salary/i);
  });

  it("splits numbered clauses even when the line breaks are lost", () => {
    // A paste out of a PDF often arrives as one line. "…bought out. 2. The
    // Joining Bonus…" splits at neither full stop without an explicit rule.
    const flattened =
      "1. You will serve a notice period of 90 days. 2. The Joining Bonus is refundable in full if you resign within 12 months of joining. 3. Variable pay is at the sole discretion of the management.";
    const flags = detectRedFlags(flattened);
    const clawback = flags.find((f) => /clawback/i.test(f.title));
    expect(clawback?.quote).toMatch(/Joining Bonus is refundable/i);
    expect(clawback?.quote).not.toMatch(/sole discretion/i);
  });
});

describe("stray text is not read as money", () => {
  it("ignores a digit that is part of an identifier", () => {
    // A shell line pasted above a letter turned "offer-letter-1.txt" into a
    // component worth one rupee. It was disclosed rather than counted, but it
    // should never have been picked up.
    const withNoise = `$ cat fixtures/offer-letter-1.txt
Reference: REQ-7 / Form-16
Basic Salary 9,60,000
`;
    const parsed = parseOfferText(withNoise);
    expect(parsed.unmatched).toEqual([]);
    expect(parsed.components.map((c) => c.key)).toContain("basic");
  });

  it("still reads a small amount when it is marked as money", () => {
    // The floor applies only to bare numbers: if the writer said ₹ or a unit,
    // they have told us it is money and we believe them.
    expect(parseOfferText("Meal allowance ₹900").components).toHaveLength(1);
    expect(parseOfferText("Sundry 900").components).toHaveLength(0);
  });
});
