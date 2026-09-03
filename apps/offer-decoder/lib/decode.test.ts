import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formRequest, useTempStore } from "../../../tests/helpers.ts";
import { POST as decode } from "../app/api/decode/route.ts";
import { GET as report } from "../app/api/report/route.ts";
import { parseOfferText } from "./parse.ts";
import { detectRedFlags, detectMissingClauses } from "./redflags.ts";

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
