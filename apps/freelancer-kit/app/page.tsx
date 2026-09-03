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
import { Desk } from "./desk.tsx";

export const dynamic = "force-dynamic";

export default function Page() {
  const live = paymentsLive("INR");

  return (
    <>
      <PageView />
      <Hero config={config}>
        <p className="inline-flex rounded-full border border-[var(--line)] bg-[var(--canvas)] px-3 py-1.5 text-[13px] text-[var(--muted)]">
          First invoice, first contract and first tax estimate are free, PDFs included.
        </p>
      </Hero>

      <main>
        <Container className="py-10 sm:py-14">
          <Desk />
        </Container>

        <Container className="pb-14">
          <SectionHeading
            eyebrow="Why bother"
            title="Nobody went freelance to do this part"
            body="But an invoice with the wrong tax split gets rejected, a contract without a scope clause loses arguments, and a missed advance-tax date costs 1% a month in interest."
          />
          <div className="mt-6">
            <BenefitList config={config} />
          </div>
        </Container>

        <Container className="pb-14">
          <SectionHeading
            eyebrow="Pricing"
            title="One subscription, all three"
            body={
              live
                ? "First of each is free. After that, monthly or yearly."
                : "First of each is free and always will be. Payments aren't switched on yet; leave an email below if you want to know when they are."
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
