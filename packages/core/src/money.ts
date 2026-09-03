/**
 * All money in this repo is stored in minor units (paise, cents) as integers.
 * Floating-point rupees produce ₹0.01 discrepancies that make a salary
 * breakdown look wrong even when it is right.
 */

export type Currency = "INR" | "USD";

export const rupees = (amount: number): number => Math.round(amount * 100);
export const fromPaise = (minor: number): number => minor / 100;

/** Indian digit grouping: 12,34,567 rather than 1,234,567. */
export function formatInr(minor: number, options: { paise?: boolean } = {}): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const digits = String(whole);
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
  }
  const suffix = options.paise ? `.${String(fraction).padStart(2, "0")}` : "";
  return `${negative ? "-" : ""}₹${grouped}${suffix}`;
}

export function formatUsd(minor: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);
}

export function formatMoney(minor: number, currency: Currency): string {
  return currency === "USD" ? formatUsd(minor) : formatInr(minor);
}

/** "₹12.5 L" / "₹1.2 Cr" — how Indians actually talk about salaries. */
export function formatIndianShort(minor: number): string {
  const value = Math.abs(minor) / 100;
  const sign = minor < 0 ? "-" : "";
  if (value >= 1e7) return `${sign}₹${(value / 1e7).toFixed(2).replace(/\.00$/, "")} Cr`;
  if (value >= 1e5) return `${sign}₹${(value / 1e5).toFixed(2).replace(/\.00$/, "")} L`;
  if (value >= 1e3) return `${sign}₹${(value / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return formatInr(minor);
}

/**
 * Parse the many ways an Indian salary figure gets written:
 * "12,00,000", "₹12L", "12 lakh", "1.2 Cr", "1200000.00".
 * Returns minor units, or null when nothing numeric is present.
 */
export function parseIndianAmount(input: string): number | null {
  const cleaned = input
    .replace(/[₹,\s]/g, "")
    .replace(/₹/g, "")
    .trim()
    .toLowerCase();
  if (!cleaned) return null;

  // Longest alternatives first: "lpa" must win over "l", or "32 LPA" parses
  // as thirty-two rupees.
  const match = cleaned.match(
    /^(-?\d+(?:\.\d+)?)\s*(crores|crore|cr|lakhs|lakh|lacs|lac|lpa|l|k|th)?/,
  );
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  const unit = match[2] ?? "";
  const CRORE = new Set(["cr", "crore", "crores"]);
  const LAKH = new Set(["l", "lac", "lacs", "lakh", "lakhs", "lpa"]);
  const THOUSAND = new Set(["k", "th"]);
  const multiplier = CRORE.has(unit) ? 1e7 : LAKH.has(unit) ? 1e5 : THOUSAND.has(unit) ? 1e3 : 1;
  return Math.round(value * multiplier * 100);
}
