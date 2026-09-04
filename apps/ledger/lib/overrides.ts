import { CATEGORIES, categorise } from "./categorise.ts";
import type { CategoryId } from "./categorise.ts";
import type { LedgerEntry, LedgerResult } from "./ledger.ts";

/**
 * Corrections the user has made, remembered per browser.
 *
 * The categorisation is keyword rules, so it will be wrong sometimes — that is
 * stated on the page. What turns that from a weakness into the product is
 * being able to fix it once and have it stick for every future statement.
 *
 * A rule is keyed on the merchant, not on the transaction, so correcting one
 * "UPI-SWIGGY-swiggy@ybl-409123456" fixes every Swiggy row past and future.
 */

export type Overrides = Record<string, CategoryId>;

const KEY = "statement-ledger:overrides:v1";

/** Tokens that appear in every narration and identify no merchant. */
const NOISE = new Set([
  "upi", "neft", "imps", "rtgs", "pos", "atm", "ach", "ecs", "nach", "chq", "cheque",
  "dr", "cr", "ref", "txn", "trf", "transfer", "payment", "paid", "received", "from",
  "to", "the", "and", "for", "via", "inb", "mob", "net", "banking", "india", "pvt",
  "ltd", "limited", "com", "www", "http", "https", "bank", "account", "acct", "no",
  "wdl", "amt", "value", "date", "info", "misc", "other", "self", "own",
]);

/**
 * Reduce a narration to the merchant it is about.
 *
 * Bank narrations are a soup of rails, reference numbers and handles. This
 * picks the longest alphabetic token that is not rail noise, which lands on
 * the merchant far more often than not — and when it does not, the user sees
 * exactly which word their rule is attached to and can judge it.
 */
export function merchantKey(narration: string): string | null {
  const tokens = narration
    .toLowerCase()
    .replace(/[^a-z\s@._-]/g, " ")
    // A UPI handle's merchant half is the useful part: swiggy@ybl -> swiggy.
    .replace(/@[a-z]+/g, " ")
    .split(/[\s._-]+/)
    .filter((token) => token.length >= 3 && !NOISE.has(token));

  // First meaningful token, not the longest. Bank narrations put the rail
  // first and the merchant immediately after, so the leading token is the
  // merchant far more often. Longest-wins was tried and produced "services"
  // for AWS and "koramangala" for an ATM withdrawal — both would have grouped
  // unrelated rows under one rule.
  return tokens[0] ?? null;
}

export function readOverrides(): Overrides {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Overrides = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value in CATEGORIES) out[key] = value as CategoryId;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveOverride(merchant: string, category: CategoryId): void {
  try {
    const next = { ...readOverrides(), [merchant]: category };
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The correction still applies to what is on screen; it just will not
    // survive a reload. Never surface this as an error.
  }
}

export function removeOverride(merchant: string): void {
  try {
    const next = readOverrides();
    delete next[merchant];
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function clearOverrides(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * Re-derive a ledger with the user's corrections applied.
 *
 * Pure, and shared by the result view and the Excel export, so the spreadsheet
 * can never disagree with what was on screen. Totals, the category breakdown
 * and the GST shortlist are all recomputed — a correction that did not move
 * the totals would be cosmetic and worse than useless.
 */
export function applyOverrides(result: LedgerResult, overrides: Overrides): LedgerResult {
  if (Object.keys(overrides).length === 0) return result;

  const entries: LedgerEntry[] = result.entries.map((entry) => {
    const merchant = merchantKey(entry.narration);
    const override = merchant ? overrides[merchant] : undefined;
    if (!override || override === entry.category) return entry;
    return {
      ...entry,
      category: override,
      categoryLabel: CATEGORIES[override].label,
      matchedOn: `your rule: ${merchant}`,
      basis: "rule",
    };
  });

  // --- recompute everything that depends on category ----------------------
  const categoryMap = new Map<CategoryId, { total: number; count: number }>();
  for (const entry of entries) {
    const existing = categoryMap.get(entry.category) ?? { total: 0, count: 0 };
    existing.total += Math.abs(entry.amountMinor);
    existing.count += 1;
    categoryMap.set(entry.category, existing);
  }

  const grandTotal = result.totals.moneyIn + result.totals.moneyOut;
  const byCategory = [...categoryMap.entries()]
    .map(([category, value]) => ({
      category,
      label: CATEGORIES[category].label,
      total: value.total,
      count: value.count,
      sharePct: grandTotal > 0 ? Number(((value.total / grandTotal) * 100).toFixed(1)) : 0,
      commonlyCarriesGst: CATEGORIES[category].commonlyCarriesGst,
      businessLikely: CATEGORIES[category].businessLikely,
    }))
    .sort((a, b) => b.total - a.total);

  const gstCandidates = entries.filter(
    (entry) => entry.amountMinor < 0 && CATEGORIES[entry.category].commonlyCarriesGst,
  );
  const gstByCategory = new Map<CategoryId, { total: number; count: number }>();
  for (const entry of gstCandidates) {
    const existing = gstByCategory.get(entry.category) ?? { total: 0, count: 0 };
    existing.total += Math.abs(entry.amountMinor);
    existing.count += 1;
    gstByCategory.set(entry.category, existing);
  }

  const uncategorised = entries.filter((entry) => entry.category === "uncategorised");

  return {
    ...result,
    entries,
    byCategory,
    gst: {
      ...result.gst,
      reviewableSpend: gstCandidates.reduce((sum, e) => sum + Math.abs(e.amountMinor), 0),
      reviewableCount: gstCandidates.length,
      byCategory: [...gstByCategory.entries()]
        .map(([category, value]) => ({
          category,
          label: CATEGORIES[category].label,
          total: value.total,
          count: value.count,
        }))
        .sort((a, b) => b.total - a.total),
    },
    uncategorisedCount: uncategorised.length,
    uncategorisedValue: uncategorised.reduce((sum, e) => sum + Math.abs(e.amountMinor), 0),
    assumptions: [
      ...result.assumptions,
      `${Object.keys(overrides).length} of your own category rules were applied on top of ours. Rows they changed say so in the "Matched on" column.`,
    ],
  };
}

/** Validate an overrides object arriving from a request body. */
export function parseOverrides(value: unknown): Overrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Overrides = {};
  for (const [key, category] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof key === "string" &&
      key.length > 0 &&
      key.length <= 64 &&
      typeof category === "string" &&
      category in CATEGORIES
    ) {
      out[key] = category as CategoryId;
    }
  }
  return out;
}

/** Exported so the UI can show what a fresh categorisation would have said. */
export function originalCategory(narration: string, amountMinor: number): CategoryId {
  return categorise(narration, amountMinor).category;
}
