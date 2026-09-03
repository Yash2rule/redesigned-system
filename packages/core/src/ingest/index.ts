import Papa from "papaparse";

export type IngestKind = "pdf" | "csv" | "text" | "image" | "unknown";

export type IngestResult = {
  kind: IngestKind;
  /** Extracted text. Empty when `ok` is false. */
  text: string;
  /** Parsed rows, for CSV inputs only. */
  rows: string[][];
  ok: boolean;
  /** Visitor-facing explanation when `ok` is false. Never a stack trace. */
  message: string;
  meta: Record<string, unknown>;
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Classify by extension first, then by magic bytes, then by content shape. */
export function detectKind(filename: string, bytes: Uint8Array): IngestKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "txt" || ext === "md") return "text";
  if (["png", "jpg", "jpeg", "webp", "heic", "gif"].includes(ext)) return "image";

  const header = Array.from(bytes.slice(0, 4));
  if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
    return "pdf";
  }
  if (header[0] === 0x89 && header[1] === 0x50) return "image";
  if (header[0] === 0xff && header[1] === 0xd8) return "image";
  return "unknown";
}

async function extractPdf(bytes: Uint8Array): Promise<IngestResult> {
  try {
    // Imported lazily: unpdf pulls in a sizeable pdf.js build, and probes that
    // only ever see CSVs should not pay that cost on cold start.
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text;
    if (merged.trim().length < 20) {
      return {
        kind: "pdf",
        text: merged,
        rows: [],
        ok: false,
        message:
          "This PDF has almost no selectable text — it is probably a scan or a photo. Copy the text and paste it instead.",
        meta: { totalPages },
      };
    }
    return {
      kind: "pdf",
      text: merged,
      rows: [],
      ok: true,
      message: "",
      meta: { totalPages },
    };
  } catch (error) {
    return {
      kind: "pdf",
      text: "",
      rows: [],
      ok: false,
      message: `We could not read that PDF (${(error as Error).message}). If it is password-protected, remove the password and try again, or paste the text.`,
      meta: {},
    };
  }
}

function extractCsv(raw: string): IngestResult {
  // Bank exports are inconsistent about delimiters; let Papa sniff it.
  const parsed = Papa.parse<string[]>(raw.trim(), {
    skipEmptyLines: "greedy",
    delimiter: "",
  });
  const rows = (parsed.data ?? []).filter((row): row is string[] => Array.isArray(row));
  if (rows.length === 0) {
    return {
      kind: "csv",
      text: raw,
      rows: [],
      ok: false,
      message: "That CSV had no readable rows.",
      meta: {},
    };
  }
  return {
    kind: "csv",
    text: raw,
    rows,
    ok: true,
    message: "",
    meta: { rowCount: rows.length, delimiter: parsed.meta?.delimiter },
  };
}

/**
 * Turn an uploaded file into text (and rows, for CSV).
 *
 * Images are deliberately NOT OCR'd. tesseract.js downloads tens of megabytes
 * of WASM and language data at runtime, which breaks both the cold-start and
 * the near-zero-cost constraints. When an LLM key is present a probe may send
 * the image to a vision model itself; with no key we tell the visitor the
 * truth and offer the paste box.
 */
export async function ingestFile(
  filename: string,
  bytes: Uint8Array,
): Promise<IngestResult> {
  if (bytes.byteLength === 0) {
    return { kind: "unknown", text: "", rows: [], ok: false, message: "That file was empty.", meta: {} };
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return {
      kind: "unknown",
      text: "",
      rows: [],
      ok: false,
      message: `That file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      meta: {},
    };
  }

  const kind = detectKind(filename, bytes);
  switch (kind) {
    case "pdf":
      return extractPdf(bytes);
    case "csv":
      return extractCsv(new TextDecoder("utf-8").decode(bytes));
    case "text": {
      const text = new TextDecoder("utf-8").decode(bytes);
      return { kind: "text", text, rows: [], ok: true, message: "", meta: {} };
    }
    case "image":
      return {
        kind: "image",
        text: "",
        rows: [],
        ok: false,
        message:
          "We can't read images yet — we don't run OCR, and we'd rather say so than guess at your numbers. Please paste the text instead.",
        meta: {},
      };
    default:
      return {
        kind: "unknown",
        text: "",
        rows: [],
        ok: false,
        message: "We couldn't tell what kind of file that is. Upload a PDF, a CSV, or paste the text.",
        meta: {},
      };
  }
}

export type TextMode = "auto" | "csv" | "text";

/**
 * Text pasted directly into a textarea, normalised the same way files are.
 *
 * `mode` is explicit rather than sniffed, because sniffing was wrong in both
 * directions: a bank statement whose first line is a title has no commas on
 * that line, and a salary breakup full of "9,60,000" figures looks exactly
 * like a comma-delimited file. Each probe knows which one it wants, so it says
 * so instead of leaving it to a heuristic.
 */
export function ingestText(raw: string, mode: TextMode = "auto"): IngestResult {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (text.length < 10) {
    return {
      kind: "text",
      text: "",
      rows: [],
      ok: false,
      message: "That's too short to work with. Paste the whole thing.",
      meta: {},
    };
  }

  if (mode === "csv") return extractCsv(text);
  if (mode === "text") return { kind: "text", text, rows: [], ok: true, message: "", meta: {} };

  // "auto": treat it as delimited only when most lines split the same way.
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length >= 3) {
    const counts = lines.slice(0, 40).map((line) => (line.match(/,/g)?.length ?? 0));
    const modal = counts
      .slice()
      .sort(
        (a, b) =>
          counts.filter((c) => c === b).length - counts.filter((c) => c === a).length || a - b,
      )[0];
    const agreement = counts.filter((c) => c === modal).length / counts.length;
    if ((modal ?? 0) >= 2 && agreement >= 0.7) {
      const csv = extractCsv(text);
      if (csv.ok) return csv;
    }
  }
  return { kind: "text", text, rows: [], ok: true, message: "", meta: {} };
}
