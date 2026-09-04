import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_PROFILE,
  MAX_CLIENTS,
  clientKey,
  forgetEverything,
  readProfile,
  saveClient,
  saveContractDefaults,
  saveLastInvoiceNumber,
  saveSupplier,
  suggestNextInvoiceNumber,
} from "./profile.ts";

/**
 * The profile lives in localStorage, so these tests install a minimal
 * implementation rather than a whole DOM. What matters is the behaviour a
 * freelancer notices: their details come back, clients de-duplicate, the
 * invoice number increments, and nothing throws when storage is unavailable.
 */
function installStorage(impl?: Partial<Storage>): void {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
    ...impl,
  };
  (globalThis as { window?: unknown }).window = { localStorage: storage };
}

beforeEach(() => installStorage());
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("supplier details", () => {
  it("come back after being saved", () => {
    saveSupplier({
      name: "Asha Menon",
      address: "12 Residency Road, Bengaluru",
      gstin: "29ABCDE1234F1Z5",
      email: "asha@example.com",
      phone: "",
      pan: "ABCDE1234F",
    });
    const profile = readProfile();
    expect(profile.supplier?.name).toBe("Asha Menon");
    expect(profile.supplier?.gstin).toBe("29ABCDE1234F1Z5");
  });

  it("start empty", () => {
    expect(readProfile()).toEqual(EMPTY_PROFILE);
  });
});

describe("the client book", () => {
  const client = (over: Partial<{ name: string; gstin: string }> = {}) => ({
    name: "Nimbus Design LLP",
    address: "Mumbai",
    gstin: "27ABCDE5678G1Z2",
    country: "India",
    ...over,
  });

  it("keeps the most recently billed client first", () => {
    saveClient(client());
    saveClient(client({ name: "Helios Labs", gstin: "29ZZZZZ9999Z1Z9" }));
    expect(readProfile().clients[0]?.name).toBe("Helios Labs");
  });

  it("updates a client rather than duplicating it", () => {
    saveClient(client());
    saveClient(client({ name: "Nimbus Design LLP (Bangalore)" }));
    const clients = readProfile().clients;
    expect(clients).toHaveLength(1);
    expect(clients[0]?.name).toBe("Nimbus Design LLP (Bangalore)");
  });

  it("identifies a client by GSTIN when it has one, and by name otherwise", () => {
    expect(clientKey({ name: "A", gstin: "27abcde5678g1z2" })).toBe("27ABCDE5678G1Z2");
    expect(clientKey({ name: "  Local Shop  ", gstin: "" })).toBe("local shop");
  });

  it("refuses to save a client with no name", () => {
    saveClient(client({ name: "   " }));
    expect(readProfile().clients).toHaveLength(0);
  });

  it("caps the book so storage cannot grow without bound", () => {
    for (let i = 0; i < MAX_CLIENTS + 8; i += 1) {
      saveClient(client({ name: `Client ${i}`, gstin: "" }));
    }
    expect(readProfile().clients).toHaveLength(MAX_CLIENTS);
  });
});

describe("suggestNextInvoiceNumber", () => {
  it("increments the trailing number, keeping the padding", () => {
    expect(suggestNextInvoiceNumber("INV-2026-001")).toBe("INV-2026-002");
    expect(suggestNextInvoiceNumber("INV-2026-009")).toBe("INV-2026-010");
    expect(suggestNextInvoiceNumber("INV-2026-099")).toBe("INV-2026-100");
    expect(suggestNextInvoiceNumber("7")).toBe("8");
    expect(suggestNextInvoiceNumber("2026/04/12")).toBe("2026/04/13");
  });

  it("declines rather than guessing when there is no number to increment", () => {
    // Invoice numbering has to be a consecutive series; a wrong guess is worse
    // than making someone type it.
    expect(suggestNextInvoiceNumber("INVOICE")).toBeNull();
    expect(suggestNextInvoiceNumber(null)).toBeNull();
    expect(suggestNextInvoiceNumber("")).toBeNull();
  });

  it("declines when the next number would break the 16-character GST rule", () => {
    expect(suggestNextInvoiceNumber("ABCDEFGHIJKLMN99")).toBeNull();
  });
});

describe("contract defaults", () => {
  it("round-trip", () => {
    saveContractDefaults({
      paymentTermsDays: "15",
      advancePct: "50",
      lateFeePctPerMonth: "2",
      noticeDays: "30",
      revisionRounds: "3",
      confidentialityMonths: "36",
      jurisdictionCity: "Bengaluru",
      ipTransfersOnPayment: "no",
    });
    const defaults = readProfile().contractDefaults;
    expect(defaults?.advancePct).toBe("50");
    expect(defaults?.jurisdictionCity).toBe("Bengaluru");
  });
});

describe("robustness", () => {
  it("forgets everything on request", () => {
    saveSupplier({ name: "A", address: "", gstin: "", email: "", phone: "", pan: "" });
    saveClient({ name: "B", address: "", gstin: "", country: "India" });
    forgetEverything();
    expect(readProfile()).toEqual(EMPTY_PROFILE);
  });

  it("survives corrupt stored JSON", () => {
    window.localStorage.setItem("freelance-desk:profile:v1", "{not json");
    expect(readProfile()).toEqual(EMPTY_PROFILE);
  });

  it("survives storage that throws on read and on write", () => {
    // Private browsing and locked-down browsers both do this.
    installStorage({
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(() => saveLastInvoiceNumber("INV-1")).not.toThrow();
    expect(readProfile()).toEqual(EMPTY_PROFILE);
  });

  it("ignores a stored shape it does not recognise", () => {
    window.localStorage.setItem("freelance-desk:profile:v1", JSON.stringify({ clients: "nope" }));
    expect(readProfile().clients).toEqual([]);
  });
});
