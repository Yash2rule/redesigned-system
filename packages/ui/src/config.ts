import type { ProbeId } from "@probes/core/types.ts";
import type { Plan } from "@probes/billing";

export type Benefit = { title: string; body: string };

export type FaqItem = { question: string; answer: string; keywords?: string[] };

/**
 * One object per probe drives the landing page, pricing, FAQ, support widget
 * and every disclaimer. Keeping it as data is what makes four probes in one
 * night possible: the apps differ only in their core flow.
 */
export type ProbeConfig = {
  id: ProbeId;
  /** Product name as a stranger sees it. */
  name: string;
  /** One line under the logo. */
  tagline: string;
  headline: string;
  subheadline: string;
  benefits: Benefit[];
  plans: Plan[];
  faq: FaqItem[];
  /** Shown in the footer and on every generated document. */
  disclaimer: string;
  contactEmail: string;
  /** CSS colour for --accent. */
  accent: string;
  accentSoft: string;
  /** Short label for the primary call to action, e.g. "Decode my offer". */
  ctaLabel: string;
};
