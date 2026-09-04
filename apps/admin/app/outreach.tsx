"use client";

import { useState } from "react";
import { Note, Pill } from "@probes/ui";
import type { OutreachResult } from "../lib/outreach.ts";

const PROBES = [
  { id: "all", label: "Everyone" },
  { id: "offer-decoder", label: "Offer Decoder" },
  { id: "ledger", label: "Statement to Ledger" },
  { id: "uptime", label: "Client Watch" },
  { id: "freelancer-kit", label: "Freelance Desk" },
];

const DEFAULT_MESSAGE = `Payments are open.

You left your email a while back asking to be told when you could pay for this. You can now.

Nothing about the free tier has changed — what you used is still free and still complete.

If it is not useful to you any more, ignore this. I will not send another.`;

/**
 * Messaging the people who left an email.
 *
 * Dry run first, always. The preview shows the exact message and the real
 * recipient count before anything is sent, and sending requires typing SEND.
 * These are strangers who trusted a one-person product with an address; the
 * cost of a mistaken blast is the whole list.
 */
export function Outreach({ emailLive }: { emailLive: boolean }) {
  const [open, setOpen] = useState(false);
  const [probe, setProbe] = useState("all");
  const [subject, setSubject] = useState("Payments are open");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(OutreachResult & { emailLive?: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(send: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          probe,
          subject,
          message,
          productName: PROBES.find((p) => p.id === probe)?.label ?? "our tools",
          confirm: send ? confirm : "",
        }),
      });
      const payload = (await response.json()) as OutreachResult & { error?: string };
      if (!response.ok || payload.error) {
        setError(payload.error ?? `Failed (${response.status})`);
        return;
      }
      setResult(payload);
      if (send) setConfirm("");
    } catch (err) {
      setError(`Could not reach the server: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium"
        >
          Message the people who left an email
        </button>
        <a
          href="/api/intents?probe=all"
          className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium"
        >
          Download the list as CSV
        </a>
        {!emailLive ? (
          <Pill tone="warn">Email not configured — sending is disabled</Pill>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight">Message the intent list</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-[var(--muted)] underline underline-offset-2"
        >
          Close
        </button>
      </div>

      {!emailLive ? (
        <div className="mt-4">
          <Note>
            <strong>RESEND_API_KEY and EMAIL_FROM are not set</strong>, so nothing can be sent from
            this deployment. You can still preview the message and download the list. See HANDOFF
            item 7a.
          </Note>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Who</span>
          <select
            value={probe}
            onChange={(e) => {
              setProbe(e.target.value);
              setResult(null);
            }}
            className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm"
          >
            {PROBES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[12px] text-[var(--muted)]">
            Addresses are de-duplicated, so someone who left an email on three probes gets one
            message.
          </span>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm"
          />
        </label>
      </div>

      <label className="mt-4 block text-sm">
        <span className="mb-1.5 block font-medium">Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={9}
          className="w-full rounded-lg border border-[var(--line)] bg-white p-3 font-mono text-[13px]"
        />
        <span className="mt-1 block text-[12px] text-[var(--muted)]">
          Plain text. A footer saying why they are getting this and how to stop is added
          automatically.
        </span>
      </label>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(false)}
          className="rounded-lg bg-[var(--ink)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Preview — who would get this"}
        </button>
      </div>

      {result ? (
        <div className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--canvas)] p-4">
          <p className="text-sm font-semibold">
            {result.dryRun ? "Dry run — nothing was sent." : `Sent to ${result.sent}.`}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {result.recipientCount} unique address{result.recipientCount === 1 ? "" : "es"}
            {result.duplicatesRemoved > 0
              ? `, after removing ${result.duplicatesRemoved} duplicate${result.duplicatesRemoved === 1 ? "" : "s"}`
              : ""}
            {result.sample.length > 0 ? ` — e.g. ${result.sample.join(", ")}` : ""}
          </p>
          {result.failed > 0 ? (
            <p className="mt-2 text-sm text-rose-700">
              {result.failed} failed: {result.failures.join("; ")}
            </p>
          ) : null}
          {result.notConfigured ? (
            <p className="mt-2 text-sm text-amber-800">
              Email is not configured, so nothing was sent.
            </p>
          ) : null}

          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">
              The exact message they would receive
            </summary>
            <p className="mt-2 text-sm font-semibold">{result.preview.subject}</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-white p-3 text-[12px] leading-relaxed">
              {result.preview.text}
            </pre>
          </details>

          {result.dryRun && result.recipientCount > 0 && emailLive ? (
            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <label className="text-sm">
                <span className="mb-1.5 block font-medium">
                  To send to {result.recipientCount} real {result.recipientCount === 1 ? "person" : "people"}, type SEND
                </span>
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="SEND"
                  className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm sm:max-w-[12rem]"
                />
              </label>
              <button
                type="button"
                disabled={busy || confirm !== "SEND"}
                onClick={() => void run(true)}
                className="mt-3 block rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy ? "Sending…" : `Send to ${result.recipientCount}`}
              </button>
              <p className="mt-2 text-[12px] text-[var(--muted)]">
                There is no undo. Preview it once more first.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
