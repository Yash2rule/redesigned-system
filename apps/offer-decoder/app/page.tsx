import { RETIRED_MESSAGE, isRetired } from "@probes/core/server";
import { paymentsLive } from "@probes/billing";
import {
  BenefitList,
  Container,
  FaqSection,
  Hero,
  PageView,
  RetiredPage,
  PricingBlock,
  SectionHeading,
  SiteFooter,
  SupportWidget,
} from "@probes/ui";
import { config } from "../lib/config.ts";
import { Decoder } from "./decoder.tsx";

export const dynamic = "force-dynamic";

export default async function Page() {
  // A retired probe shows why it ended instead of a shopfront that no
  // longer works. Fails open: if this cannot be determined, the real page
  // is served.
  if (await isRetired("offer-decoder")) {
    return <RetiredPage name={config.name} message={RETIRED_MESSAGE} />;
  }

  const live = paymentsLive("INR");

  return (
    <>
      <PageView />
      <Hero config={config}>
        <p className="inline-flex rounded-full border border-[var(--line)] bg-[var(--canvas)] px-3 py-1.5 text-[13px] text-[var(--muted)]">
          First offer is decoded free, in full, before you are asked for anything.
        </p>
      </Hero>

      <main>
        <Container className="py-10 sm:py-14">
          <Decoder />
        </Container>

        <Container className="pb-14">
          <SectionHeading
            eyebrow="Why bother"
            title="A CTC number is a marketing figure"
            body="It bundles money that never reaches you, money that depends on a payout ratio, and money you only see after five years. This separates the three."
          />
          <div className="mt-6">
            <BenefitList config={config} />
          </div>
        </Container>

        <Container className="pb-14">
          <SectionHeading
            eyebrow="Pricing"
            title="Pay once, or not at all"
            body={
              live
                ? "Your first offer is free. After that, per report — no subscription."
                : "Your first offer is free and always will be. Payments aren't switched on yet; if you want to be told when they are, leave an email below."
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
