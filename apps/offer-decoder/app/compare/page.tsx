import Link from "next/link";
import { formatIndianShort, formatInr } from "@probes/core";
import { Container, DataTable, Note, ResultSection, SectionHeading } from "@probes/ui";
import { buildComparison, parseIds } from "../../lib/compare.ts";
import { MAX_COMPARE } from "../../lib/saved.ts";
import { SavedOffers } from "./saved-offers.tsx";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids: raw } = await searchParams;
  const ids = parseIds(raw ?? null);
  const comparison =
    ids.length > 0 ? await buildComparison(ids, formatInr, formatIndianShort) : null;

  return (
    <Container className="py-10 sm:py-14">
      <SectionHeading
        eyebrow="Compare"
        title="Your offers, side by side"
        body={`Every offer you decode in this browser is remembered here. Pick up to ${MAX_COMPARE} and see them against each other.`}
      />

      <div className="mt-6">
        <SavedOffers selectedIds={ids} />
      </div>

      {comparison && comparison.missingIds.length > 0 ? (
        <div className="mt-6">
          <Note>
            {comparison.missingIds.length} of the offers you asked for could not be found. Results
            are kept on the server, and a link from another browser or an old session may have
            expired.
          </Note>
        </div>
      ) : null}

      {comparison && comparison.offers.length >= 2 ? (
        <>
          <ResultSection
            title="The numbers"
            description="The best value in each row is marked. Read the first two rows together — an offer that wins on one and loses on the other is riskier than it looks."
          >
            <DataTable
              columns={["", ...comparison.offers.map((_, i) => `Offer ${i + 1}`)]}
              align={["left", ...comparison.offers.map(() => "right" as const)]}
              rows={comparison.rows.map((row) => [
                <div key="label">
                  <span className="font-medium">{row.label}</span>
                  {row.note ? (
                    <span className="mt-0.5 block text-[12px] font-normal text-[var(--muted)]">
                      {row.note}
                    </span>
                  ) : null}
                </div>,
                ...row.values.map((value, index) => (
                  <span
                    key={index}
                    className={
                      row.bestIndex === index ? "font-bold text-emerald-700" : undefined
                    }
                  >
                    {value}
                    {row.bestIndex === index ? (
                      <span className="sr-only"> — best on this row</span>
                    ) : null}
                  </span>
                )),
              ])}
            />
          </ResultSection>

          <ResultSection title="What that adds up to">
            <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
              {comparison.verdict.map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
          </ResultSection>

          <ResultSection title="Each offer in full">
            <ul className="space-y-2 text-sm">
              {comparison.offers.map((offer, index) => (
                <li key={offer.id} className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">Offer {index + 1}</span>
                  <span className="text-[var(--muted)]">
                    {formatIndianShort(offer.result.salary.ctc)} CTC ·{" "}
                    {offer.result.redFlags.length} clauses flagged
                  </span>
                  <a
                    href={`/api/report?id=${encodeURIComponent(offer.id)}`}
                    className="text-[var(--accent)] underline underline-offset-2"
                  >
                    Download its PDF
                  </a>
                </li>
              ))}
            </ul>
          </ResultSection>
        </>
      ) : comparison && comparison.offers.length === 1 ? (
        <div className="mt-6">
          <Note>
            One offer selected. Pick at least one more to compare — or decode another first.
          </Note>
        </div>
      ) : null}

      <p className="mt-10">
        <Link
          href="/"
          className="text-sm font-semibold text-[var(--accent)] underline underline-offset-4"
        >
          Decode another offer
        </Link>
      </p>
    </Container>
  );
}
