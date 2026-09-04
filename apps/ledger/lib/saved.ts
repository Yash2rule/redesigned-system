/**
 * Which statements this browser has processed.
 *
 * Ids and a label only; the ledgers themselves stay on the server. Enough to
 * offer a financial-year rollup without asking anyone to make an account.
 */

export const SAVED_STATEMENTS_KEY = "statement-ledger:saved:v1";
export const MAX_SAVED = 24;

export type SavedStatement = {
  id: string;
  label: string;
  /** First and last transaction date, so the picker can show the period. */
  from: string;
  to: string;
  savedAt: string;
};

export function readSavedStatements(): SavedStatement[] {
  try {
    const raw = window.localStorage.getItem(SAVED_STATEMENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SavedStatement =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as SavedStatement).id === "string" &&
        typeof (entry as SavedStatement).label === "string",
    );
  } catch {
    return [];
  }
}

export function saveStatement(statement: SavedStatement): void {
  try {
    const existing = readSavedStatements().filter((entry) => entry.id !== statement.id);
    window.localStorage.setItem(
      SAVED_STATEMENTS_KEY,
      JSON.stringify([statement, ...existing].slice(0, MAX_SAVED)),
    );
  } catch {
    // The ledger on screen is unaffected; only the rollup convenience is lost.
  }
}

export function forgetStatements(): void {
  try {
    window.localStorage.removeItem(SAVED_STATEMENTS_KEY);
  } catch {
    // ignore
  }
}
