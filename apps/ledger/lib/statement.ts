import { UserFacingError } from "@probes/core";

/**
 * Read an Indian bank or UPI statement export into a normalised transaction
 * list.
 *
 * There is no shared format. HDFC, ICICI, SBI, Axis and Kotak each name their
 * columns differently, PhonePe and Google Pay export a single signed amount
 * with a type column, and everyone writes dates day-first. So this maps
 * column headers through synonym sets rather than guessing by position, and
 * reports exactly which columns it used — a statement silently read with
 * debit and credit swapped is worse than one that fails outright.
 */

export type Txn = {
  /** ISO date, yyyy-mm-dd. */
  date: string;
  narration: string;
  reference: string;
  /** Positive = money in, negative = money out. Minor units (paise). */
  amountMinor: number;
  balanceMinor: number | null;
};

export type ColumnMap = {
  date: number;
  narration: number;
  debit: number | null;
  credit: number | null;
  /** Single signed/typed amount column, used when debit/credit are absent. */
  amount: number | null;
  type: number | null;
  balance: number | null;
  reference: number | null;
};

export type StatementParse = {
  transactions: Txn[];
  columns: ColumnMap;
  /** Header text of each column we used, for the "what we read" panel. */
  columnLabels: Record<string, string>;
  headerRowIndex: number;
  /** Rows we could not read, with why. Shown to the user, never hidden. */
  skipped: { row: number; reason: string }[];
  dateFormat: "day-first" | "iso" | "month-name";
};

const SYNONYMS: Record<keyof ColumnMap, string[]> = {
  date: ["date", "txn date", "tran date", "transaction date", "value date", "posting date", "date of transaction"],
  narration: ["narration", "description", "particulars", "transaction details", "details", "remarks", "transaction remarks", "note", "merchant"],
  debit: ["debit", "withdrawal", "withdrawal amt", "withdrawal amt.", "withdrawal (dr)", "dr", "dr amount", "debit amount", "paid out", "money out"],
  credit: ["credit", "deposit", "deposit amt", "deposit amt.", "deposit (cr)", "cr", "cr amount", "credit amount", "paid in", "money in"],
  amount: ["amount", "transaction amount", "amt", "value"],
  type: ["type", "transaction type", "dr/cr", "cr/dr", "debit/credit", "indicator"],
  balance: ["balance", "closing balance", "running balance", "bal", "available balance"],
  reference: ["ref no", "ref no.", "reference", "cheque no", "chq no", "chq./ref.no.", "chq/ref no", "utr", "transaction id", "txn id", "ref"],
};

const normalise = (value: string): string =>
  value.toLowerCase().replace(/[\s_]+/g, " ").replace(/[."']/g, "").trim();

function matchColumn(headers: string[], key: keyof ColumnMap): number | null {
  const wanted = SYNONYMS[key];
  // Exact match first; only then fall back to substring, so "value date"
  // does not win the "amount" slot via the word "value".
  for (const candidate of wanted) {
    const index = headers.findIndex((h) => normalise(h) === candidate);
    if (index !== -1) return index;
  }
  for (const candidate of wanted) {
    const index = headers.findIndex((h) => {
      const n = normalise(h);
      return n.length > 2 && (n.startsWith(candidate) || n.includes(candidate));
    });
    if (index !== -1) return index;
  }
  return null;
}

/** Score a row on how much it looks like a header rather than data. */
function headerScore(row: string[]): number {
  let score = 0;
  for (const key of Object.keys(SYNONYMS) as (keyof ColumnMap)[]) {
    if (matchColumn(row, key) !== null) score += 1;
  }
  return score;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export type DateFormat = StatementParse["dateFormat"];

/**
 * Parse a date, day-first.
 *
 * Indian statements are universally dd/mm/yyyy, and reading 03/09/2026 as
 * March 9th would quietly move a transaction into the wrong month and the
 * wrong quarter. The one exception is an unambiguous ISO date.
 */
export function parseStatementDate(raw: string): { iso: string; format: DateFormat } | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return { iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, format: "iso" };
  }

  const named = value.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{2,4})/);
  if (named) {
    const [, d, monthName, year] = named;
    const month = MONTHS[(monthName ?? "").slice(0, 3).toLowerCase()];
    if (month) {
      const fullYear = (year ?? "").length === 2 ? `20${year}` : year;
      return {
        iso: `${fullYear}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        format: "month-name",
      };
    }
  }

  const dayFirst = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dayFirst) {
    const [, d, m, year] = dayFirst;
    const day = Number(d);
    const month = Number(m);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    const fullYear = (year ?? "").length === 2 ? `20${year}` : year;
    return {
      iso: `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      format: "day-first",
    };
  }
  return null;
}

/** Parse an amount cell. Handles ₹, commas, (1,234) negatives and Dr/Cr suffixes. */
export function parseAmount(raw: string): number | null {
  const value = raw.trim();
  if (!value || value === "-" || value === "--") return null;

  const negativeByParens = /^\(.*\)$/.test(value);
  const negativeBySuffix = /\b(dr|debit)\b\s*$/i.test(value);
  const positiveBySuffix = /\b(cr|credit)\b\s*$/i.test(value);

  // Strip the Dr/Cr suffix BEFORE removing spaces: once "500.00 Dr" becomes
  // "500.00Dr" there is no word boundary left for \b to match against.
  const cleaned = value
    .replace(/\s*(dr|cr|debit|credit)\.?\s*$/i, "")
    .replace(/[₹,()\s]/g, "");
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return null;

  const magnitude = Math.round(Math.abs(number) * 100);
  const sign = number < 0 || negativeByParens || negativeBySuffix ? -1 : positiveBySuffix ? 1 : Math.sign(number) || 1;
  return magnitude * sign;
}

export function parseStatement(rows: string[][]): StatementParse {
  // Find the header: the row in the first 25 that looks most like one.
  let headerRowIndex = -1;
  let best = 0;
  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    const score = headerScore(rows[i] ?? []);
    if (score > best) {
      best = score;
      headerRowIndex = i;
    }
  }

  if (headerRowIndex === -1 || best < 2) {
    throw new UserFacingError(
      "We couldn't find a header row in that file. Export the statement as CSV from your bank or UPI app — the version with column names like Date, Narration and Withdrawal — and upload that.",
    );
  }

  const headers = rows[headerRowIndex] ?? [];
  const columns: ColumnMap = {
    date: matchColumn(headers, "date") ?? -1,
    narration: matchColumn(headers, "narration") ?? -1,
    debit: matchColumn(headers, "debit"),
    credit: matchColumn(headers, "credit"),
    amount: matchColumn(headers, "amount"),
    type: matchColumn(headers, "type"),
    balance: matchColumn(headers, "balance"),
    reference: matchColumn(headers, "reference"),
  };

  if (columns.date === -1) {
    throw new UserFacingError(
      `We found a header row but no date column in it. The columns we saw were: ${headers.filter(Boolean).join(", ")}.`,
    );
  }
  const hasDebitCredit = columns.debit !== null || columns.credit !== null;
  if (!hasDebitCredit && columns.amount === null) {
    throw new UserFacingError(
      `We found a header row but no amount column in it. The columns we saw were: ${headers.filter(Boolean).join(", ")}.`,
    );
  }

  const transactions: Txn[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const formats = new Set<DateFormat>();

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const cell = (index: number | null): string =>
      index === null || index < 0 ? "" : (row[index] ?? "").trim();

    const rawDate = cell(columns.date);
    if (!rawDate) continue; // blank spacer rows are normal at the end of exports

    const parsedDate = parseStatementDate(rawDate);
    if (!parsedDate) {
      // Statement footers ("Closing balance", "*** End of statement ***") land
      // here. Only worth reporting if the row has other content.
      if (row.some((c) => c.trim())) {
        skipped.push({ row: i + 1, reason: `couldn't read the date "${rawDate.slice(0, 30)}"` });
      }
      continue;
    }
    formats.add(parsedDate.format);

    let amountMinor: number | null = null;
    if (hasDebitCredit) {
      const debit = parseAmount(cell(columns.debit));
      const credit = parseAmount(cell(columns.credit));
      if (debit && debit !== 0) amountMinor = -Math.abs(debit);
      else if (credit && credit !== 0) amountMinor = Math.abs(credit);
    } else {
      const amount = parseAmount(cell(columns.amount));
      if (amount !== null) {
        const type = cell(columns.type).toLowerCase();
        if (/^(dr|debit|withdraw|paid|sent|out)/.test(type)) amountMinor = -Math.abs(amount);
        else if (/^(cr|credit|deposit|received|in)/.test(type)) amountMinor = Math.abs(amount);
        else amountMinor = amount; // rely on the sign already in the cell
      }
    }

    if (amountMinor === null || amountMinor === 0) {
      if (row.some((c) => c.trim())) {
        skipped.push({ row: i + 1, reason: "no amount on this row" });
      }
      continue;
    }

    transactions.push({
      date: parsedDate.iso,
      narration: cell(columns.narration) || cell(columns.reference) || "(no description)",
      reference: cell(columns.reference),
      amountMinor,
      balanceMinor: parseAmount(cell(columns.balance)),
    });
  }

  if (transactions.length === 0) {
    throw new UserFacingError(
      "We found the columns but not a single readable transaction. If this is a statement PDF rather than a CSV, export the CSV instead — PDF statements vary too much for us to read reliably.",
    );
  }

  const label = (index: number | null) =>
    index === null || index < 0 ? "" : (headers[index] ?? "").trim();

  return {
    transactions: transactions.sort((a, b) => a.date.localeCompare(b.date)),
    columns,
    columnLabels: {
      date: label(columns.date),
      narration: label(columns.narration),
      debit: label(columns.debit),
      credit: label(columns.credit),
      amount: label(columns.amount),
      balance: label(columns.balance),
      reference: label(columns.reference),
    },
    headerRowIndex: headerRowIndex + 1,
    skipped: skipped.slice(0, 50),
    dateFormat: formats.has("iso") && formats.size === 1 ? "iso" : formats.has("month-name") && formats.size === 1 ? "month-name" : "day-first",
  };
}
