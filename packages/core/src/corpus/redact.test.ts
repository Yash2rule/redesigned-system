import { describe, expect, it } from "vitest";
import { redactText, redactValue } from "./redact.ts";

describe("redactText", () => {
  it("replaces every identifier we know how to spot", () => {
    const input = [
      "Candidate: Priya Sharma, priya.sharma@example.com, +91 98765 43210",
      "PAN ABCDE1234F, Aadhaar 1234 5678 9012, GSTIN 27ABCDE1234F1Z5",
      "Salary credited to A/c 123456789012 (IFSC HDFC0001234), UPI priya@okhdfcbank",
      "Vehicle KA01AB1234",
    ].join("\n");

    const { text, hits } = redactText(input);

    expect(text).not.toContain("priya.sharma@example.com");
    expect(text).not.toContain("9876543210");
    expect(text).not.toContain("98765 43210");
    expect(text).not.toContain("ABCDE1234F");
    expect(text).not.toContain("1234 5678 9012");
    expect(text).not.toContain("123456789012");
    expect(text).not.toContain("HDFC0001234");
    expect(text).not.toContain("priya@okhdfcbank");
    expect(text).not.toContain("KA01AB1234");

    expect(hits.email).toBe(1);
    expect(hits.pan).toBeGreaterThanOrEqual(1);
  });

  it("maps the same identifier to the same token, so rows stay linkable", () => {
    const a = redactText("Contact me at me@example.com").text;
    const b = redactText("Or write to me@example.com instead").text;
    const token = a.match(/\[email:[0-9a-f]{4}\]/)?.[0];
    expect(token).toBeTruthy();
    expect(b).toContain(token);
  });

  it("maps different identifiers to different tokens", () => {
    const text = redactText("a@example.com and b@example.com").text;
    const tokens = text.match(/\[email:[0-9a-f]{4}\]/g) ?? [];
    expect(new Set(tokens).size).toBe(2);
  });

  it("leaves salary figures alone — they are the whole point of the corpus", () => {
    const { text } = redactText("Basic 9,60,000 and HRA 4,80,000 for FY 2025-26");
    expect(text).toContain("9,60,000");
    expect(text).toContain("4,80,000");
    expect(text).toContain("2025-26");
  });
});

describe("redactValue", () => {
  it("drops name and address fields entirely rather than tokenising them", () => {
    const out = redactValue({
      candidateName: "Priya Sharma",
      billing_address: "12 MG Road, Bengaluru",
      ctc: 2_400_000,
      nested: { email: "x@y.com", notes: "call me on 9876543210" },
    }) as Record<string, unknown>;

    expect(out.candidateName).toBe("[redacted]");
    expect(out.billing_address).toBe("[redacted]");
    expect(out.ctc).toBe(2_400_000);
    const nested = out.nested as Record<string, unknown>;
    expect(nested.email).toBe("[redacted]");
    expect(String(nested.notes)).not.toContain("9876543210");
  });

  it("survives deeply nested and cyclic-looking structures", () => {
    let deep: unknown = "me@example.com";
    for (let i = 0; i < 20; i += 1) deep = { level: deep };
    expect(() => redactValue(deep)).not.toThrow();
    expect(JSON.stringify(redactValue(deep))).toContain("[depth-limit]");
  });
});

describe("phone number spellings", () => {
  it("catches every common way an Indian mobile is written", () => {
    for (const spelling of [
      "9876543210",
      "98765 43210",
      "98765-43210",
      "+91 98765 43210",
      "+919876543210",
      "91-98765-43210",
      "09876543210",
    ]) {
      const { text } = redactText(`Call me on ${spelling} today`);
      expect(text, spelling).not.toMatch(/9876/);
    }
  });

  it("normalises every spelling to the same token", () => {
    const tokenOf = (s: string) =>
      redactText(s).text.match(/\[phone:[0-9a-f]{4}\]/)?.[0];
    expect(tokenOf("9876543210")).toBe(tokenOf("+91 98765 43210"));
  });
});
