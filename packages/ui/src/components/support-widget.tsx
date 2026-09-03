"use client";

import { useRef, useState } from "react";

type Message = { role: "user" | "bot"; text: string; source?: string };

/**
 * Per-probe support widget. Answers come from that probe's FAQ via
 * /api/support; when nothing matches it says so and hands over an email
 * address rather than improvising.
 */
export function SupportWidget({ productName }: { productName: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (trimmed.length < 3 || busy) return;
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setQuestion("");
    setBusy(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const payload = (await res.json()) as { answer?: string; source?: string };
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: payload.answer ?? "Sorry — I couldn't reach the server.", source: payload.source },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: "Sorry — I couldn't reach the server. Try again in a moment." },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      });
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 print:hidden">
      {open ? (
        <div className="flex h-[26rem] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Questions about {productName}?</p>
              <p className="text-[11px] text-[var(--muted)]">Answers come from our FAQ only.</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close support"
              className="rounded px-2 py-1 text-lg leading-none text-[var(--muted)] hover:text-[var(--ink)]"
            >
              ×
            </button>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Ask anything — pricing, what we do with your file, how the numbers are worked out.
                If it isn&apos;t in the FAQ I&apos;ll say so instead of guessing.
              </p>
            ) : null}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "ml-auto bg-[var(--accent)] text-[var(--accent-ink)]"
                    : "bg-slate-100 text-[var(--ink)]"
                }`}
              >
                {message.text}
              </div>
            ))}
            {busy ? <p className="text-sm text-[var(--muted)]">Looking…</p> : null}
          </div>

          <form onSubmit={ask} className="flex gap-2 border-t border-[var(--line)] p-3">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question"
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-ink)] disabled:opacity-50"
            >
              Ask
            </button>
          </form>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-white shadow-lg"
        >
          Ask a question
        </button>
      )}
    </div>
  );
}
