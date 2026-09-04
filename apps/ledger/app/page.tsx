import { paymentsLive } from "@probes/billing";
import {
  BenefitList,
  Container,
  FaqSection,
  Hero,
  PageView,
  PricingBlock,
  SectionHeading,
  SiteFooter,
  SupportWidget,
} from "@probes/ui";
import { config } from "../lib/config.ts";
import { LedgerView } from "./ledger-view.tsx";

export const dynamic = "force-dynamic";

export default function Page() {
  const live = paymentsLive("INR");

  return (
    <>
      <PageView />
      <Hero config={config}>
        <p className="inline-flex rounded-full border border-[var(--line)] bg-[var(--canvas)] px-3 py-1.5 text-[13px] text-[var(--muted)]">
          Your first statement is free and complete — Excel export included.
        </p>
      </Hero>

      <main>
        <Container className="py-10 sm:py-14">
          <LedgerView />
        </Container>

        <Container className="pb-14">
          <SectionHeading
            eyebrow="Why bother"
            title="The categorising is the boring part"
            body="Downloading the CSV takes thirty seconds. Deciding what four hundred rows of UPI narrations mean is what eats an evening every month."
          />
          <div className="mt-6">
            <BenefitList config={config} />
          </div>
        </Container>

        <Container className="pb-14">
          <SectionHeading
            eyebrow="Pricing"
            title="Per statement, or monthly"
            body={
              live
                ? "First statement free. After that, pay per statement or monthly."
                : "First statement free and always will be. Payments aren't switched on yet; leave an email below if you want to know when they are."
            }
          />
          <div className="mt-6">
            <PricingBlock config={config} paymentsLive={live} />
          </div>
        </Container>

        <Container className="pb-14">
          <SectionHeading eyebrow="Questions" title="Things people ask" />
          <div className="mt-6">
            <FaqSection config={config} />
          </div>
        </Container>
      </main>

      <SiteFooter config={config} />
      <SupportWidget productName={config.name} />
    </>
  );
}
