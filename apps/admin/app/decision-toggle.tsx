"use client";

import { useState, useTransition } from "react";
import type { ProbeDecision, ProbeId } from "@probes/core/types.ts";

const OPTIONS: { value: ProbeDecision; label: string }[] = [
  { value: "keep", label: "Keep" },
  { value: "undecided", label: "—" },
  { value: "kill", label: "Kill" },
];

/**
 * The kill/keep switch. Writes straight through to the store so the decision
 * survives a redeploy and shows up next to the numbers that produced it.
 */
export function DecisionToggle({
  probe,
  decision,
  note,
}: {
  probe: ProbeId;
  decision: ProbeDecision;
  note: string | null;
}) {
  const [current, setCurrent] = useState(decision);
  const [noteText, setNoteText] = useState(note ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(next: ProbeDecision, nextNote: string) {
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/decision", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ probe, decision: next, note: nextNote }),
        });
        if (!response.ok) {
          setError("Not saved");
          setCurrent(decision);
        }
      } catch {
        setError("Not saved");
        setCurrent(decision);
      }
    });
  }

  return (
    <div className="min-w-[13rem]">
      <div className="flex overflow-hidden rounded-lg border border-[var(--line)] text-sm">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={pending}
            onClick={() => save(option.value, noteText)}
            className={`flex-1 px-3 py-1.5 font-medium transition-colors ${
              current === option.value
                ? option.value === "keep"
                  ? "bg-emerald-600 text-white"
                  : option.value === "kill"
                    ? "bg-rose-600 text-white"
                    : "bg-slate-200 text-slate-700"
                : "bg-white text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {editing ? (
        <input
          value={noteText}
          autoFocus
          onChange={(e) => setNoteText(e.target.value)}
          onBlur={() => {
            setEditing(false);
            save(current, noteText);
          }}
          placeholder="Why?"
          className="mt-2 w-full rounded border border-[var(--line)] px-2 py-1 text-[12px]"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 block w-full truncate text-left text-[12px] text-[var(--muted)] hover:text-[var(--ink)]"
        >
          {noteText || "Add a note…"}
        </button>
      )}
      {error ? <p className="mt-1 text-[12px] text-rose-700">{error}</p> : null}
    </div>
  );
}
