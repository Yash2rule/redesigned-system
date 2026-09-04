/**
 * What this browser remembers between documents.
 *
 * Three things get retyped on every invoice and every contract: your own
 * details, the client's details, and the terms you always use. Storing them
 * removes the single biggest reason someone uses this once and never comes
 * back.
 *
 * Kept in localStorage rather than on the server, deliberately:
 *
 * - No account is needed, which is true of every probe here.
 * - Your GSTIN, PAN, address and your clients' details never leave your
 *   machine. For a tool handling this kind of data that is the better default,
 *   not just the cheaper one.
 * - The cost is that it does not follow you to another browser, and clearing
 *   site data loses it. Both are stated on screen rather than discovered.
 */

const KEY = "freelance-desk:profile:v1";

export type SupplierProfile = {
  name: string;
  address: string;
  gstin: string;
  email: string;
  phone: string;
  pan: string;
};

export type SavedClient = {
  /** Stable key so re-saving the same client updates rather than duplicates. */
  id: string;
  name: string;
  address: string;
  gstin: string;
  country: string;
  lastUsedAt: string;
};

export type ContractDefaults = {
  paymentTermsDays: string;
  advancePct: string;
  lateFeePctPerMonth: string;
  noticeDays: string;
  revisionRounds: string;
  confidentialityMonths: string;
  jurisdictionCity: string;
  ipTransfersOnPayment: string;
};

export type Profile = {
  supplier: SupplierProfile | null;
  clients: SavedClient[];
  contractDefaults: ContractDefaults | null;
  /** Last invoice number issued, so the next one can be suggested. */
  lastInvoiceNumber: string | null;
};

export const EMPTY_PROFILE: Profile = {
  supplier: null,
  clients: [],
  contractDefaults: null,
  lastInvoiceNumber: null,
};

export const MAX_CLIENTS = 25;

/** A client's identity, for de-duplication: GSTIN if there is one, else name. */
export function clientKey(client: { name: string; gstin: string }): string {
  const gstin = client.gstin.trim().toUpperCase();
  return gstin || client.name.trim().toLowerCase();
}

export function readProfile(): Profile {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY_PROFILE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_PROFILE;
    const profile = parsed as Partial<Profile>;
    return {
      supplier: profile.supplier ?? null,
      clients: Array.isArray(profile.clients) ? profile.clients.slice(0, MAX_CLIENTS) : [],
      contractDefaults: profile.contractDefaults ?? null,
      lastInvoiceNumber:
        typeof profile.lastInvoiceNumber === "string" ? profile.lastInvoiceNumber : null,
    };
  } catch {
    // Private mode, disabled storage, or corrupt JSON. Starting fresh is the
    // right answer to all three — it costs convenience, never correctness.
    return EMPTY_PROFILE;
  }
}

function write(profile: Profile): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Losing the memory only means retyping. Never surface this as an error.
  }
}

export function saveSupplier(supplier: SupplierProfile): void {
  write({ ...readProfile(), supplier });
}

export function saveClient(client: Omit<SavedClient, "id" | "lastUsedAt">): void {
  const profile = readProfile();
  const id = clientKey(client);
  if (!client.name.trim()) return;

  const entry: SavedClient = { ...client, id, lastUsedAt: new Date().toISOString() };
  const others = profile.clients.filter((existing) => existing.id !== id);
  // Most recently used first, so the client you are billing today is on top.
  write({ ...profile, clients: [entry, ...others].slice(0, MAX_CLIENTS) });
}

export function forgetClient(id: string): void {
  const profile = readProfile();
  write({ ...profile, clients: profile.clients.filter((client) => client.id !== id) });
}

export function saveContractDefaults(defaults: ContractDefaults): void {
  write({ ...readProfile(), contractDefaults: defaults });
}

export function saveLastInvoiceNumber(invoiceNumber: string): void {
  write({ ...readProfile(), lastInvoiceNumber: invoiceNumber.trim() });
}

export function forgetEverything(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Already unreachable; nothing to do.
  }
}

/**
 * Suggest the next invoice number from the last one issued.
 *
 * Increments the final run of digits and preserves its zero padding, so
 * INV-2026-001 becomes INV-2026-002 and 7 becomes 8. Returns null when there
 * is no trailing number to increment, rather than guessing a format —
 * invoice numbering has to be a consecutive series, and a wrong guess there is
 * worse than making someone type it.
 */
export function suggestNextInvoiceNumber(previous: string | null): string | null {
  if (!previous) return null;
  const match = previous.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return null;
  const [, prefix = "", digits = "", suffix = ""] = match;
  const next = String(Number(digits) + 1).padStart(digits.length, "0");
  const candidate = `${prefix}${next}${suffix}`;
  // Rule 46(b): at most 16 characters, alphanumeric with / and - only.
  return /^[A-Za-z0-9/-]{1,16}$/.test(candidate) ? candidate : null;
}
