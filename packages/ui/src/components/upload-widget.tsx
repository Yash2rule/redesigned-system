"use client";

import { useId, useRef, useState } from "react";
import { trackClient } from "../client.ts";

export type UploadWidgetProps = {
  /** Where the multipart POST goes. */
  action: string;
  /** Accepted file extensions, e.g. ".pdf,.csv". */
  accept: string;
  ctaLabel: string;
  /** Label above the paste box. */
  pasteLabel: string;
  pastePlaceholder: string;
  /** Called with the parsed JSON response on success. */
  onResult: (result: unknown) => void;
  /** Optional extra fields appended to the FormData. */
  extraFields?: Record<string, string>;
  helpText?: string;
};

/**
 * File-or-paste input shared by every document probe.
 *
 * Paste is a first-class path, not a fallback: we do not run OCR, many people
 * only have a screenshot or a WhatsApp forward, and a textarea is more honest
 * than an upload box that silently fails on scans.
 */
export function UploadWidget({
  action,
  accept,
  ctaLabel,
  pasteLabel,
  pastePlaceholder,
  onResult,
  extraFields = {},
  helpText,
}: UploadWidgetProps) {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileFieldId = useId();
  const textFieldId = useId();

  const ready = mode === "file" ? file !== null : text.trim().length >= 10;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!ready) {
      setError(mode === "file" ? "Choose a file first." : "Paste a bit more text first.");
      return;
    }
    setBusy(true);
    trackClient("upload_started", { mode });

    try {
      const form = new FormData();
      for (const [key, value] of Object.entries(extraFields)) form.append(key, value);
      if (mode === "file" && file) form.append("file", file);
      else form.append("text", text);

      const res = await fetch(action, { method: "POST", body: form });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok || payload.error) {
        setError(payload.error ?? `Something went wrong (${res.status}).`);
        return;
      }
      onResult(payload);
      trackClient("result_viewed", { mode });
    } catch (err) {
      setError(`Could not reach the server: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
      <div role="tablist" aria-label="Input method" className="mb-4 inline-flex rounded-lg border border-[var(--line)] p-1 text-sm">
        {(["file", "paste"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
            }}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              mode === value
                ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {value === "file" ? "Upload a file" : "Paste text"}
          </button>
        ))}
      </div>

      {mode === "file" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) setFile(dropped);
          }}
          className={`rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]"
          }`}
        >
          <label htmlFor={fileFieldId} className="cursor-pointer text-sm font-medium text-[var(--accent)]">
            Choose a file
          </label>
          <input
            ref={inputRef}
            id={fileFieldId}
            type="file"
            accept={accept}
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="mt-1 text-sm text-[var(--muted)]">or drop it here — {accept}, up to 8 MB</p>
          {file ? (
            <p className="mt-3 text-sm font-medium">
              {file.name}{" "}
              <span className="font-normal text-[var(--muted)]">
                ({(file.size / 1024).toFixed(0)} KB)
              </span>
            </p>
          ) : null}
        </div>
      ) : (
        <div>
          <label htmlFor={textFieldId} className="mb-2 block text-sm font-medium">
            {pasteLabel}
          </label>
          <textarea
            id={textFieldId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={pastePlaceholder}
            className="w-full rounded-lg border border-[var(--line)] bg-white p-3 font-mono text-[13px] leading-relaxed"
          />
        </div>
      )}

      {helpText ? <p className="mt-3 text-[13px] text-[var(--muted)]">{helpText}</p> : null}

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded-lg bg-[var(--accent)] px-5 py-3 text-[15px] font-semibold text-[var(--accent-ink)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {busy ? "Working…" : ctaLabel}
      </button>
    </form>
  );
}
