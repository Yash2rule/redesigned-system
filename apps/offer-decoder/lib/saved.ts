/**
 * Which decoded offers belong to this browser.
 *
 * Only ids and a short label are kept locally — the results themselves live on
 * the server. That keeps the client small and means the comparison page works
 * from a shared link, while still needing no account.
 */

export const SAVED_OFFERS_KEY = "offer-decoder:saved";

/**
 * How many offers can be compared at once. Lives here rather than beside the
 * comparison builder because the client picker needs it, and that module
 * reaches the database.
 */
export const MAX_COMPARE = 5;
export const MAX_SAVED = 12;

export type SavedOffer = {
  id: string;
  /** Something recognisable, e.g. "₹24 L · 10 clauses flagged". */
  label: string;
  decodedAt: string;
};

export function readSavedOffers(): SavedOffer[] {
  try {
    const raw = window.localStorage.getItem(SAVED_OFFERS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SavedOffer =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as SavedOffer).id === "string" &&
        typeof (entry as SavedOffer).label === "string",
    );
  } catch {
    // Private mode, disabled storage, or corrupt JSON. An empty list is the
    // correct answer to all three.
    return [];
  }
}

export function saveOffer(offer: SavedOffer): void {
  try {
    const existing = readSavedOffers().filter((entry) => entry.id !== offer.id);
    const next = [offer, ...existing].slice(0, MAX_SAVED);
    window.localStorage.setItem(SAVED_OFFERS_KEY, JSON.stringify(next));
  } catch {
    // Losing the local list only costs the comparison convenience; the result
    // itself is already on the server and still on screen.
  }
}
