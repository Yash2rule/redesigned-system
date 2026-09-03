import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { EVENT_NAMES, formatMoney } from "@probes/core";
import { Container, Note, Pill } from "@probes/ui";
import { isAuthenticated } from "../lib/auth.ts";
import { EVENT_LABELS, loadDashboard } from "../lib/data.ts";
import { DecisionToggle } from "./decision-toggle.tsx";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const headerList = await headers();
  if (!isAuthenticated(headerList.get("cookie"))) redirect("/login");

  const dashboard = await loadDashboard();
  const ranked = [...dashboard.rows].sort((a, b) => {
    // Rank on the strongest honest signal, then on volume as a tiebreak.
    if (b.intentRatePct !== a.intentRatePct) return b.intentRatePct - a.intentRatePct;
    return b.funnel.counts.email_captured - a.funnel.counts.email_captured;
  });

  return (
    <Container className="py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Probe dashboard</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {dashboard.totals.sessions} sessions · {dashboard.totals.results} results ·{" "}
            {dashboard.totals.intents} purchase intents · generated{" "}
            {new Date(dashboard.generatedAt).toUTCString()}
          </p>
        </div>
        <Pill tone={dashboard.storeKind === "postgres" ? "good" : "warn"}>
          {dashboard.storeKind === "postgres" ? "Postgres" : "Local files"}
        </Pill>
      </header>

      {dashboard.storeKind === "file" ? (
        <div className="mt-5">
          <Note>
            <strong>DATABASE_URL is not set.</strong> Everything below is being read from local
            JSON files. On a serverless host that means each instance has its own copy and a
            redeploy loses the lot — which would destroy the only thing these probes exist to
            produce. This is handoff item #1.
          </Note>
        </div>
      ) : null}

      {dashboard.totals.sessions === 0 ? (
        <div className="mt-5">
          <Note>
            No traffic recorded yet. Numbers appear here as soon as the first stranger opens one of
            the probes — nothing needs configuring for that to work.
          </Note>
        </div>
      ) : null}

      {/* --- the comparison ------------------------------------------------ */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">Funnel, side by side</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Each cell counts distinct visitors, not events. The percentage is against the number who
          landed.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th scope="col" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Probe
                </th>
                {EVENT_NAMES.map((name) => (
                  <th key={name} scope="col" className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    {EVENT_LABELS[name]}
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Intent value
                </th>
              </tr>
            </thead>
            <tbody>
              {dashboard.rows.map((row) => (
                <tr key={row.probe} className="border-b border-[var(--line)] last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    {row.label}
                    {row.decision !== "undecided" ? (
                      <span className="ml-2">
                        <Pill tone={row.decision === "keep" ? "good" : "bad"}>{row.decision}</Pill>
                      </span>
                    ) : null}
                  </th>
                  {EVENT_NAMES.map((name) => (
                    <td key={name} className="px-3 py-3 text-right tabular-nums">
                      <span className="font-medium">{row.funnel.counts[name]}</span>
                      {name !== "page_view" && row.funnel.counts.page_view > 0 ? (
                        <span className="ml-1 text-[12px] text-[var(--muted)]">
                          {row.conversion[name]}%
                        </span>
                      ) : null}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {formatMoney(row.funnel.intentValueMinor, row.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- ranking ------------------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Ranking</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
          Ranked on the share of people who got a real result and then left an email against a
          named price. With no payment rail live, &ldquo;paid&rdquo; reads zero for every probe, so
          it cannot rank anything — this is the strongest signal that is currently honest. Once
          payments are on, rank on paid instead.
        </p>
        <div className="mt-4 space-y-3">
          {ranked.map((row, index) => (
            <div
              key={row.probe}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
            >
              <div className="flex items-baseline gap-3">
                <span className="text-lg font-bold tabular-nums text-[var(--muted)]">
                  {index + 1}
                </span>
                <div>
                  <p className="font-semibold">{row.label}</p>
                  <p className="text-[13px] text-[var(--muted)]">
                    {row.funnel.counts.result_viewed} results · {row.activationRatePct}% of landers
                    got one · {row.corpusRows} corpus rows
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-6">
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Result → email
                  </p>
                  <p className="text-xl font-bold tabular-nums">{row.intentRatePct}%</p>
                </div>
                <DecisionToggle probe={row.probe} decision={row.decision} note={row.note} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* --- intents ------------------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Latest purchase intent</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          People who picked a plan and left an email while payments were off. These are the ones to
          message the day the rail goes live.
        </p>
        {dashboard.recentIntents.length === 0 ? (
          <div className="mt-4">
            <Note>Nothing yet.</Note>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)]">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  {["When", "Probe", "Plan", "Amount", "Email"].map((heading) => (
                    <th key={heading} scope="col" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dashboard.recentIntents.map((intent) => (
                  <tr key={intent.id} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-4 py-2.5 text-[13px] text-[var(--muted)]">
                      {intent.createdAt.slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-4 py-2.5">{intent.probe}</td>
                    <td className="px-4 py-2.5">{intent.plan}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {formatMoney(intent.amountMinor, intent.currency)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[13px]">{intent.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-10 text-[13px] leading-relaxed text-[var(--muted)]">
        A note on reading this: with small numbers, a five-point difference in conversion is noise.
        Wait for at least 100 landers per probe before treating the ranking as real, and prefer the
        probe where people who got a result came back a second time — that is a stronger signal
        than any first-visit percentage.
      </p>
    </Container>
  );
}
