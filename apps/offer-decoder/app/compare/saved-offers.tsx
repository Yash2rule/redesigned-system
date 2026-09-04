"use client";

import { useEffect, useState } from "react";
import {
  MAX_COMPARE,
  SAVED_OFFERS_KEY,
  readSavedOffers,
  type SavedOffer,
} from "../../lib/saved.ts";

/**
 * The list of offers this browser has decoded.
 *
 * Kept in localStorage rather than behind an account, because the whole
 * product works without one. The consequence — offers do not follow you to
 * another browser — is stated on screen rather than left to be discovered.
 */
export function SavedOffers({ selectedIds }: { selectedIds: string[] }) {
  const [saved, setSaved] = useState<SavedOffer[] | null>(null);
  const [selected, setSelected] = useState<string[]>(selectedIds);

  useEffect(() => {
    setSaved(readSavedOffers());
  }, []);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((value) => value !== id)
        : prev.length >= MAX_COMPARE
          ? prev
          : [...prev, id],
    );
  }

  function clear() {
    try {
      window.localStorage.removeItem(SAVED_OFFERS_KEY);
    } catch {
      // Private mode or storage disabled; the list is already gone from view.
    }
    setSaved([]);
    setSelected([]);
  }

  if (saved === null) {
    return <p className="text-sm text-[var(--muted)]">Looking for offers saved in this browser…</p>;
  }

  if (saved.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-sm font-medium">No offers saved in this browser yet.</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Decode an offer and it appears here automatically. Nothing is sent anywhere extra — the
          list of which results are yours lives in this browser only, so it will not follow you to
          another device.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">
          {saved.length} offer{saved.length === 1 ? "" : "s"} saved in this browser
        </p>
        <button
          type="button"
          onClick={clear}
          className="text-[13px] text-[var(--muted)] underline underline-offset-2 hover:text-[var(--ink)]"
        >
          Forget them all
        </button>
      </div>

      <ul className="mt-4 space-y-2">
        {saved.map((offer) => {
          const checked = selected.includes(offer.id);
          const atLimit = !checked && selected.length >= MAX_COMPARE;
          return (
            <li key={offer.id}>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                  checked ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]"
                } ${atLimit ? "opacity-50" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={atLimit}
                  onChange={() => toggle(offer.id)}
                  className="h-4 w-4"
                />
                <span className="flex-1">
                  <span className="font-medium">{offer.label}</span>
                  <span className="ml-2 text-[var(--muted)]">
                    decoded {new Date(offer.decodedAt).toLocaleDateString()}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <a
        href={`/compare?ids=${selected.join(",")}`}
        aria-disabled={selected.length < 2}
        className={`mt-4 inline-flex rounded-lg px-5 py-2.5 text-sm font-semibold ${
          selected.length < 2
            ? "pointer-events-none bg-slate-200 text-slate-500"
            : "bg-[var(--accent)] text-[var(--accent-ink)]"
        }`}
      >
        {selected.length < 2
          ? "Pick at least two"
          : `Compare these ${selected.length}`}
      </a>
    </div>
  );
}
