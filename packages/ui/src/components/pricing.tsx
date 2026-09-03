"use client";

import { useState } from "react";
import { trackClient } from "../client.ts";
import type { ProbeConfig } from "../config.ts";
import type { Plan } from "@probes/billing";

function priceLabel(plan: Plan): string {
  const major = plan.amountMinor / 100;
  const amount =
    plan.currency === "INR"
      ? `₹${major.toLocaleString("en-IN")}`
      : `$${major.toLocaleString("en-US")}`;
  const suffix =
    plan.interval === "month" ? "/mo" : plan.interval === "year" ? "/yr" : "";
  return `${amount}${suffix}`;
}

type CheckoutResponse = {
  mode?: "checkout" | "intent" | "error";
  url?: string;
  message?: string;
  recorded?: boolean;
  error?: string;
};

/**
 * Pricing block + purchase flow.
 *
 * When payments are live this redirects to a hosted checkout. When they are
 * not, the button says so in plain words, collects an email, and records the
 * click as purchase intent. It never pretends a payment is about to happen.
 */
export function PricingBlock({
  config,
  paymentsLive,
}: {
  config: ProbeConfig;
  paymentsLive: boolean;
}) {
  const [selected, setSelected] = useState<Plan | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function choose(plan: Plan) {
    setSelected(plan);
    setDone(null);
    setError(null);
    trackClient("price_clicked", {
      plan: plan.id,
      amount_minor: plan.amountMinor,
      currency: plan.currency,
      payments_live: paymentsLive,
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setError(null);
    setBusy(true);
    trackClient("checkout_started", { plan: selected.id, payments_live: paymentsLive });

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: selected.id, email }),
      });
      const payload = (await res.json()) as CheckoutResponse;

      if (payload.mode === "checkout" && payload.url) {
        window.location.href = payload.url;
        return;
      }
      if (payload.mode === "intent") {
        trackClient("email_captured", { plan: selected.id });
        setDone(payload.message ?? "Recorded.");
        setEmail("");
        return;
      }
      setError(payload.message ?? payload.error ?? "Something went wrong. Nothing was charged.");
    } catch (err) {
      setError(`Could not reach the server: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {config.plans.map((plan) => {
          const active = selected?.id === plan.id;
          return (
            <div
              key={plan.id}
              className={`flex flex-col rounded-xl border bg-[var(--surface)] p-5 transition-colors ${
                active || plan.highlight ? "border-[var(--accent)]" : "border-[var(--line)]"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-semibold">{plan.name}</h3>
                {plan.highlight ? (
                  <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                    Most useful
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight">{priceLabel(plan)}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">{plan.description}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden className="text-[var(--accent)]">
                      ✓
                    </span>
                    <span className="text-[var(--muted)]">{feature}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => choose(plan)}
                className={`mt-5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 ${
                  active
                    ? "bg-[var(--ink)] text-white"
                    : "bg-[var(--accent)] text-[var(--accent-ink)]"
                }`}
              >
                {paymentsLive ? `Buy ${plan.name}` : "Join early access"}
              </button>
            </div>
          );
        })}
      </div>

      {selected ? (
        <form
          onSubmit={submit}
          className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"
        >
          <p className="text-sm font-semibold">
            {paymentsLive
              ? `Continue with ${selected.name} — ${priceLabel(selected)}`
              : `${selected.name} — ${priceLabel(selected)}. Payments open this week.`}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
            {paymentsLive
              ? "You'll be taken to a hosted payment page. We never see your card."
              : "Payments aren't switched on yet. Leave your email and we'll send one message the day they open — nothing else, and no card is taken now."}
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm sm:max-w-xs"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : paymentsLive ? "Continue to payment" : "Notify me"}
            </button>
          </div>
          {done ? (
            <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {done}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
