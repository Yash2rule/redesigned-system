/**
 * Redaction runs BEFORE anything reaches the corpus table, not after.
 *
 * The corpus exists to make the products better (salary benchmarks, merchant
 * categorisation). None of that needs to know who someone is. So identifiers
 * are replaced with stable tokens: the same PAN always maps to the same
 * `[pan:7f3a]`, which preserves "these two rows are the same person" for
 * de-duplication without preserving who that person is.
 */

import { createHash } from "node:crypto";

const token = (kind: string, value: string): string =>
  `[${kind}:${createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 4)}]`;

type Rule = { name: string; pattern: RegExp; replace: (match: string) => string };

const RULES: Rule[] = [
  {
    name: "email",
    pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g,
    replace: (m) => token("email", m),
  },
  {
    // Indian PAN: 5 letters, 4 digits, 1 letter.
    name: "pan",
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    replace: (m) => token("pan", m),
  },
  {
    // GSTIN: 2-digit state code + PAN + 3 chars.
    name: "gstin",
    pattern: /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/g,
    replace: (m) => token("gstin", m),
  },
  {
    name: "aadhaar",
    pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    replace: (m) => token("aadhaar", m),
  },
  {
    // Indian mobiles are written a dozen ways: 9876543210, 98765 43210,
    // +91 98765-43210, 09876543210. The digits are normalised before hashing
    // so every spelling of one number maps to the same token.
    name: "phone",
    pattern: /(?:\+?91[\s-]?|\b0)?[6-9]\d{4}[\s-]?\d{5}\b/g,
    replace: (m) => token("phone", m.replace(/\D/g, "").slice(-10)),
  },
  {
    // Bank account / UPI-style long digit runs (11+ digits).
    name: "account",
    pattern: /\b\d{11,18}\b/g,
    replace: (m) => token("acct", m),
  },
  {
    name: "upi",
    pattern: /\b[\w.-]{3,}@(?:ok\w+|paytm|ybl|axl|upi|ibl|apl|sbi|hdfcbank|icici)\b/gi,
    replace: (m) => token("upi", m),
  },
  {
    name: "ifsc",
    pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
    replace: (m) => token("ifsc", m),
  },
  {
    // Indian vehicle registration.
    name: "vehicle",
    pattern: /\b[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}\b/g,
    replace: (m) => token("vehicle", m),
  },
];

export type RedactionResult = { text: string; hits: Record<string, number> };

/** Replace every identifier in a string with a stable, non-reversible token. */
export function redactText(input: string): RedactionResult {
  const hits: Record<string, number> = {};
  let text = input;
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match) => {
      hits[rule.name] = (hits[rule.name] ?? 0) + 1;
      return rule.replace(match);
    });
  }
  return { text, hits };
}

/**
 * Keys whose values are dropped entirely rather than tokenised, because the
 * value is a name or address and a token is not worth keeping.
 */
const DROP_KEYS = new Set([
  "name",
  "fullname",
  "candidatename",
  "employeename",
  "clientname",
  "customername",
  "address",
  "billingaddress",
  "shippingaddress",
  "email",
  "phone",
  "mobile",
  "signature",
  "accountnumber",
  "accountno",
  "pan",
  "gstin",
  "aadhaar",
  "ifsc",
]);

/** Recursively redact an arbitrary JSON value. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[depth-limit]";
  if (typeof value === "string") return redactText(value).text;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 500).map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = DROP_KEYS.has(key.toLowerCase().replace(/[_\s-]/g, ""))
        ? "[redacted]"
        : redactValue(val, depth + 1);
    }
    return out;
  }
  return undefined;
}
