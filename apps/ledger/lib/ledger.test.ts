import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formRequest, useTempStore } from "../../../tests/helpers.ts";
import { POST as ledgerRoute } from "../app/api/ledger/route.ts";
import { GET as exportRoute } from "../app/api/export/route.ts";
import { categorise } from "./categorise.ts";
import { parseAmount, parseStatementDate } from "./statement.ts";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "fixtures", name), "utf8");

let store: ReturnType<typeof useTempStore>;
beforeAll(() => {
  store = useTempStore();
});
afterAll(() => store.cleanup());

describe("parseStatementDate", () => {
  it("reads Indian dates day-first", () => {
    // The whole point: 03/09 is 3 September, never 9 March.
    expect(parseStatementDate("03/09/2026")?.iso).toBe("2026-09-03");
    expect(parseStatementDate("31-12-2026")?.iso).toBe("2026-12-31");
  });

  it("reads unambiguous ISO dates as ISO", () => {
    const result = parseStatementDate("2026-04-01");
    expect(result?.iso).toBe("2026-04-01");
    expect(result?.format).toBe("iso");
  });

  it("reads month names", () => {
    expect(parseStatementDate("03-Apr-2026")?.iso).toBe("2026-04-03");
    expect(parseStatementDate("3 January 2026")?.iso).toBe("2026-01-03");
  });

  it("expands two-digit years", () => {
    expect(parseStatementDate("01/04/26")?.iso).toBe("2026-04-01");
  });

  it("rejects nonsense rather than guessing", () => {
    expect(parseStatementDate("Closing Balance")).toBeNull();
    expect(parseStatementDate("45/13/2026")).toBeNull();
    expect(parseStatementDate("")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("handles the shapes Indian banks actually emit", () => {
    expect(parseAmount("1,23,456.78")).toBe(12_345_678);
    expect(parseAmount("₹ 1,000")).toBe(100_000);
    expect(parseAmount("(1,234.00)")).toBe(-123_400);
    expect(parseAmount("500.00 Dr")).toBe(-50_000);
    expect(parseAmount("500.00 Cr")).toBe(50_000);
    expect(parseAmount("-250")).toBe(-25_000);
  });

  it("returns null for empty and placeholder cells", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("-")).toBeNull();
    expect(parseAmount("n/a")).toBeNull();
  });
});

describe("categorise", () => {
  const cases: [string, number, string][] = [
    ["SALARY CREDIT ACME TECHNOLOGIES", 185_000_00, "salary"],
    ["UPI-SWIGGY-swiggy@ybl", -486_00, "food-delivery"],
    ["UPI-AWS AMAZON WEB SERVICES", -7412_00, "software-saas"],
    ["NEFT DR-RENT APRIL 2026", -38_000_00, "rent"],
    ["UPI-ZERODHA BROKING LTD", -25_000_00, "investments"],
    ["ATM CASH WDL BLR", -10_000_00, "cash-withdrawal"],
    ["GOOGLE ADS INDIA PVT LTD", -18_000_00, "advertising"],
    ["GST PAYMENT CHALLAN CPIN 26050012345", -42_000_00, "taxes"],
    ["ADVANCE TAX ITNS 280 AY 2027-28", -85_000_00, "taxes"],
    ["INT.PD:01-04-2026 TO 30-04-2026", 1420_00, "interest-income"],
    ["BESCOM ELECTRICITY BILL PAYMENT", -3120_00, "utilities"],
    ["HDFC CREDIT CARD PAYMENT AUTOPAY", -64_200_00, "credit-card"],
    ["LIC OF INDIA PREMIUM", -18_500_00, "insurance"],
    ["NEFT CR-INVOICE INV-2026-014-NIMBUS DESIGN", 75_000_00, "client-payment"],
  ];

  for (const [narration, amount, expected] of cases) {
    it(`puts "${narration.slice(0, 34)}" in ${expected}`, () => {
      expect(categorise(narration, amount).category).toBe(expected);
    });
  }

  it("always says which keyword decided it", () => {
    const result = categorise("UPI-SWIGGY-swiggy@ybl", -486_00);
    expect(result.matchedOn).toBe("swiggy");
    expect(result.basis).toBe("rule");
  });

  it("prefers the more specific rule when two could match", () => {
    // "amazon" (shopping, weight 6) vs "amazon web serv" (SaaS, weight 10).
    expect(categorise("AMAZON WEB SERVICES INDIA", -5000_00).category).toBe("software-saas");
    expect(categorise("AMAZON PAY INDIA ORDER", -4599_00).category).toBe("shopping");
  });

  it("leaves unknown spending uncategorised rather than guessing a bucket", () => {
    const result = categorise("UPI-9876543210@ybl RAVI SHANKAR", -5000_00);
    expect(result.category).toBe("uncategorised");
    expect(result.matchedOn).toBeNull();
  });

  it("does not apply an out-only rule to money coming in", () => {
    expect(categorise("RENT RECEIVED FROM TENANT", 25_000_00).category).not.toBe("rent");
  });
});

describe("POST /api/ledger", () => {
  it("reads an HDFC-style export end to end", async () => {
    const response = await ledgerRoute(
      formRequest(
        "http://localhost/api/ledger",
        {},
        { name: "statement.csv", content: fixture("statement-hdfc.csv"), type: "text/csv" },
      ),
    );
    expect(response.status).toBe(200);
    const { result } = (await response.json()) as { result: any };

    expect(result.totals.count).toBe(38);
    expect(result.period.from).toBe("2026-04-01");
    expect(result.period.to).toBe("2026-06-30");
    expect(result.period.months).toBe(3);
    expect(result.byMonth).toHaveLength(3);

    // Three ₹1,85,000 salary credits plus invoices and interest.
    expect(result.totals.moneyIn).toBe(
      (185_000 * 3 + 75_000 + 120_000 + 95_000 + 1_420 + 1_780 + 2_010) * 100,
    );

    // Money in minus money out must equal net, exactly.
    expect(result.totals.net).toBe(result.totals.moneyIn - result.totals.moneyOut);

    // Every entry lands in exactly one category, and the categories sum back.
    const categorySum = result.byCategory.reduce((s: number, c: any) => s + c.total, 0);
    expect(categorySum).toBe(result.totals.moneyIn + result.totals.moneyOut);
  });

  it("skips the statement header and footer without counting them", async () => {
    const response = await ledgerRoute(
      formRequest(
        "http://localhost/api/ledger",
        {},
        { name: "statement.csv", content: fixture("statement-hdfc.csv"), type: "text/csv" },
      ),
    );
    const { result } = (await response.json()) as { result: any };
    // "*** End of statement ***" and the "Closing Balance" trailer.
    expect(result.parse.skipped.length).toBeGreaterThan(0);
    expect(result.entries.every((e: any) => e.date.startsWith("2026-"))).toBe(true);
  });

  it("names the columns it used, so a mis-read is visible", async () => {
    const response = await ledgerRoute(
      formRequest(
        "http://localhost/api/ledger",
        {},
        { name: "statement.csv", content: fixture("statement-hdfc.csv"), type: "text/csv" },
      ),
    );
    const { result } = (await response.json()) as { result: any };
    expect(result.parse.columnLabels.date).toBe("Date");
    expect(result.parse.columnLabels.narration).toBe("Narration");
    expect(result.parse.columnLabels.debit).toBe("Withdrawal Amt.");
    expect(result.parse.columnLabels.credit).toBe("Deposit Amt.");
  });

  it("reads a UPI app export with one amount column and a type column", async () => {
    const response = await ledgerRoute(
      formRequest("http://localhost/api/ledger", { text: fixture("statement-upi-app.csv") }),
    );
    expect(response.status).toBe(200);
    const { result } = (await response.json()) as { result: any };
    expect(result.totals.count).toBe(5);
    expect(result.totals.moneyIn).toBe(75_000_00);
    expect(result.totals.moneyOut).toBe((486 + 38_000 + 649 + 842) * 100);
  });

  it("reads a quoted ICICI-style export with ISO dates", async () => {
    const response = await ledgerRoute(
      formRequest("http://localhost/api/ledger", { text: fixture("statement-icici.csv") }),
    );
    const { result } = (await response.json()) as { result: any };
    expect(result.totals.count).toBe(3);
    expect(result.parse.dateFormat).toBe("iso");
    expect(result.totals.moneyIn).toBe(185_000_00);
  });

  it("keeps the GST list to spending only, and offers no credit figure", async () => {
    const response = await ledgerRoute(
      formRequest("http://localhost/api/ledger", { text: fixture("statement-hdfc.csv") }),
    );
    const { result } = (await response.json()) as { result: any };
    expect(result.gst.reviewableSpend).toBeGreaterThan(0);
    expect(result.gst.caveats.join(" ")).toContain("not an input tax credit figure");
    // No key anywhere claims a claimable or creditable amount.
    expect(Object.keys(result.gst)).not.toContain("claimable");
  });

  it("explains itself when the file is not a statement", async () => {
    const response = await ledgerRoute(
      formRequest("http://localhost/api/ledger", { text: "hello,world\nfoo,bar\nbaz,qux" }),
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /header row|date column|amount column/i,
    );
  });

  it("refuses a PDF rather than mangling the columns", async () => {
    const response = await ledgerRoute(
      formRequest(
        "http://localhost/api/ledger",
        {},
        { name: "s.pdf", content: "%PDF-1.4 not really a pdf", type: "application/pdf" },
      ),
    );
    expect(response.status).toBe(422);
  });
});

describe("GET /api/export", () => {
  it("produces a real xlsx workbook", async () => {
    const built = await ledgerRoute(
      formRequest("http://localhost/api/ledger", { text: fixture("statement-hdfc.csv") }),
    );
    const { id } = (await built.json()) as { id: string };

    const response = await exportRoute(new Request(`http://localhost/api/export?id=${id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml");

    const bytes = new Uint8Array(await response.arrayBuffer());
    // xlsx is a zip: "PK\x03\x04".
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(bytes.byteLength).toBeGreaterThan(5000);
  });

  it("404s on an unknown id", async () => {
    const response = await exportRoute(new Request("http://localhost/api/export?id=nope"));
    expect(response.status).toBe(404);
  });
});

describe("categorisation edge cases found while testing real statements", () => {
  it("treats a bank fee line mentioning GST as a bank charge, not a tax payment", () => {
    // "SMS CHARGES INCL GST" is the bank billing you, not you paying GST.
    expect(categorise("SMS CHARGES INCL GST", -17_70).category).toBe("bank-charges");
    expect(categorise("GST ON DEBIT CARD AMC", -118_00).category).toBe("bank-charges");
  });

  it("still recognises an actual GST payment", () => {
    expect(categorise("GST PAYMENT CHALLAN CPIN 26050012345", -42_000_00).category).toBe("taxes");
    expect(categorise("CGST OUTPUT LIABILITY", -9_000_00).category).toBe("taxes");
  });

  it("recognises advance tax and TDS separately from GST", () => {
    expect(categorise("ADVANCE TAX ITNS 280 AY 2027-28", -85_000_00).category).toBe("taxes");
    expect(categorise("TDS-194J PROFESSIONAL", -5_000_00).category).toBe("taxes");
  });
});
