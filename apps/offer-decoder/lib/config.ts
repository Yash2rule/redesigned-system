import type { ProbeConfig } from "@probes/ui";

export const config: ProbeConfig = {
  id: "offer-decoder",
  name: "Offer Decoder",
  tagline: "Read an Indian offer letter the way an experienced friend would.",
  headline: "Your offer says ₹24 LPA. Here is what actually reaches your bank.",
  subheadline:
    "Paste your CTC breakup or upload the letter. You get the monthly in-hand figure under both tax regimes, how much of the package is conditional rather than guaranteed, and every clause worth arguing about — each one quoted from your own letter.",
  ctaLabel: "Decode my offer",
  accent: "#1d4ed8",
  accentSoft: "#eff6ff",
  contactEmail: "hello@offerdecoder.in",

  benefits: [
    {
      title: "The real monthly number",
      body: "In-hand after PF, professional tax for your state, and income tax under FY 2025-26 rules. Both regimes computed, the cheaper one shown, and every assumption listed so a CA can check the arithmetic.",
    },
    {
      title: "Variable and ESOP, honestly",
      body: "We separate guaranteed cash from the part that depends on a payout ratio, a vesting cliff, or a liquidity event that may never come. You see take-home at full payout and at a realistic downside.",
    },
    {
      title: "Clauses, quoted not summarised",
      body: "Bonds, clawbacks, notice periods, discretionary variable pay, non-competes. Every flag quotes the sentence from your letter and gives you the exact question to put to HR.",
    },
  ],

  plans: [
    {
      id: "single",
      name: "One offer",
      amountMinor: 19900,
      currency: "INR",
      interval: "one_time",
      description: "One full report, downloadable as PDF.",
      features: [
        "Full in-hand breakdown, both regimes",
        "Every red-flag clause, quoted",
        "PDF you can share with a CA or a parent",
        "Benchmark against contributed offers",
      ],
    },
    {
      id: "compare",
      name: "Compare five",
      amountMinor: 49900,
      currency: "INR",
      interval: "one_time",
      description: "Five reports, side by side. For when you're choosing between offers.",
      highlight: true,
      features: [
        "Everything in One offer, five times",
        "Side-by-side comparison, with the trade-offs called out",
        "The questions to put to HR, per offer",
        "Valid for 90 days",
      ],
    },
  ],

  faq: [
    {
      question: "Is this tax advice?",
      answer:
        "No. It is arithmetic against the published FY 2025-26 slabs, and it shows you every assumption it used so you or your CA can check it. It is explanation and drafting assistance, not advice, and it does not file anything anywhere.",
      keywords: ["advice", "legal", "ca", "chartered accountant", "tax advice"],
    },
    {
      question: "What happens to my offer letter?",
      answer:
        "The text is used to produce your result. An anonymised copy is stored to improve the tool and to build the comparison benchmark — names, emails, phone numbers, PAN, Aadhaar, bank accounts and UPI IDs are replaced with meaningless tokens before anything is written to the database. We never store the original file.",
      keywords: ["privacy", "data", "store", "delete", "gdpr", "secure", "confidential"],
    },
    {
      question: "Why is your in-hand number different from the one HR told me?",
      answer:
        "Usually one of three things: HR quoted the figure before income tax, they assumed a different professional-tax state, or they computed PF on the ₹15,000 statutory ceiling while we used your full basic. You can switch the PF basis and the state on the result page and watch the number move.",
      keywords: ["different", "wrong", "hr", "mismatch", "doesn't match"],
    },
    {
      question: "Which tax regime does it use?",
      answer:
        "Both. It computes the new regime and the old regime and shows you the cheaper one. The old-regime figure only counts deductions we can actually see — the standard deduction and your own PF — so if you claim HRA exemption, 80D or home-loan interest, the old regime may do better than we show.",
      keywords: ["regime", "old", "new", "80c", "hra", "deduction"],
    },
    {
      question: "Can it read a PDF or a photo?",
      answer:
        "PDFs with selectable text, yes. Scans and photos, no — we do not run OCR, and we would rather tell you that than quietly guess at your numbers. Paste the text instead; it takes ten seconds and gives a better result.",
      keywords: ["pdf", "image", "photo", "scan", "ocr", "upload", "screenshot"],
    },
    {
      question: "How accurate is the red-flag list?",
      answer:
        "It matches known clause patterns and quotes the sentence it matched, so you can judge each one yourself. It will miss unusual wording, and it is not a lawyer. Treat it as a checklist that saves you a first read, not as a legal opinion on your contract.",
      keywords: ["accurate", "accuracy", "red flag", "clause", "lawyer", "miss"],
    },
    {
      question: "What does it cost, and can I try it first?",
      answer:
        "Your first offer is decoded free, in full, before you are asked for anything. After that it is ₹199 for a single report or ₹499 for five. There is no subscription and no trial that turns into one.",
      keywords: ["price", "cost", "free", "trial", "subscription", "pricing", "pay"],
    },
    {
      question: "Who is behind this?",
      answer:
        "One engineer in India, building it alone. There are no sales calls and no onboarding meetings — if something is unclear, that is a bug, and emailing hello@offerdecoder.in is the fastest way to get it fixed.",
      keywords: ["who", "team", "company", "founder", "support", "contact"],
    },
  ],

  disclaimer:
    "Offer Decoder provides drafting and explanation assistance, not tax, legal or financial advice. Figures are estimates computed from the text you provide using published FY 2025-26 rules, and every assumption used is listed with the result. Your employer's actual payroll may differ. Nothing here is filed or submitted anywhere. For decisions that matter, check the numbers with a chartered accountant and the clauses with a lawyer.",
};
