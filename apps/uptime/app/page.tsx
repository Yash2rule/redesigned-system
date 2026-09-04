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
import { Checker } from "./checker.tsx";

export const dynamic = "force-dynamic";

export default async function Page() {
  // A retired probe shows why it ended instead of a shopfront that no
  // longer works. Fails open: if this cannot be determined, the real page
  // is served.
  if (await isRetired("uptime")) {
    return <RetiredPage name={config.name} message={RETIRED_MESSAGE} />;
  }

  const live = paymentsLive("USD");

  return (
    <>
      <PageView />
      <Hero config={config}>
        <p className="inline-flex rounded-full border border-[var(--line)] bg-[var(--canvas)] px-3 py-1.5 text-[13px] text-[var(--muted)]">
          Eight sites, no account, no card. The full check.
        </p>
      </Hero>

      <main>
        <Container className="py-10 sm:py-14">
          <Checker />
        </Container>

        <Container className="pb-14">
          <SectionHeading
            eyebrow="Why bother"
            title="Nobody gets fired over a slow page"
            body="They get fired over the Saturday the certificate expired, or the Monday the domain lapsed and email stopped working. Both are visible weeks ahead if anyone is looking."
          />
          <div className="mt-6">
            <BenefitList config={config} />
          </div>
        </Container>

        <Container className="pb-14">
          <SectionHeading
            eyebrow="Pricing"
            title="Priced per agency, not per monitor"
            body={
              live
                ? "Checking by hand stays free. Paid plans add scheduled checks, the branded status page and the weekly report."
                : "Checking by hand is free and always will be. Payments aren't switched on yet; leave an email below if you want to know when they are."
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
