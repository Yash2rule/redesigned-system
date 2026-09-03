import type { ProbeConfig } from "@probes/ui";

export const config: ProbeConfig = {
  id: "ledger",
  name: "Statement to Ledger",
  tagline: "Turn a bank or UPI export into a ledger you can actually file with.",
  headline: "Your bank export, categorised, totalled, and in Excel — in about ten seconds.",
  subheadline:
    "Upload the CSV your bank or UPI app already gives you. You get every transaction categorised, monthly totals, a category breakdown, and a shortlist of payments worth checking invoices against before you file GST. Nothing is guessed silently: every category shows the keyword that produced it.",
  ctaLabel: "Build my ledger",
  accent: "#047857",
  accentSoft: "#ecfdf5",
  contactEmail: "hello@statementledger.in",

  benefits: [
    {
      title: "Reads the format your bank already exports",
      body: "HDFC, ICICI, SBI, Axis, Kotak and the UPI apps all name their columns differently. We map them by name, not by position, and tell you exactly which column we used for what.",
    },
    {
      title: "Categories you can argue with",
      body: "Every row shows the keyword that decided its category. When we get one wrong you can see why in one glance, instead of wondering what the model was thinking.",
    },
    {
      title: "GST-ready, honestly framed",
      body: "We shortlist the payments that commonly carry GST so you know which invoices to chase. We do not invent an input-tax-credit number, because a bank statement does not contain one.",
    },
  ],

  plans: [
    {
      id: "single",
      name: "One statement",
      amountMinor: 14900,
      currency: "INR",
      interval: "one_time",
      description: "One statement, fully categorised, Excel export included.",
      features: ["Unlimited transactions in one file", "Excel export with four sheets", "Monthly and category totals", "GST review shortlist"],
    },
    {
      id: "monthly",
      name: "Monthly",
      amountMinor: 39900,
      currency: "INR",
      interval: "month",
      description: "For anyone doing this every month instead of every March.",
      highlight: true,
      features: ["Unlimited statements", "Excel export", "Category rules you can override", "Cancel any month"],
    },
    {
      id: "yearly",
      name: "Yearly",
      amountMinor: 399000,
      currency: "INR",
      interval: "year",
      description: "Two months free against the monthly price.",
      features: ["Everything in Monthly", "Full financial-year rollup", "Priority on parser fixes for your bank"],
    },
  ],

  faq: [
    {
      question: "Which banks and apps does it read?",
      answer:
        "Any CSV with a date column, a description column, and either debit/credit columns or a single amount column. That covers HDFC, ICICI, SBI, Axis, Kotak, IDFC, Yes Bank and the PhonePe, Google Pay and Paytm exports. If yours doesn't work, email the header row and we'll add it.",
      keywords: ["bank", "hdfc", "icici", "sbi", "axis", "kotak", "phonepe", "gpay", "paytm", "format", "support"],
    },
    {
      question: "Can it read a PDF statement?",
      answer:
        "Only if the PDF has selectable text laid out in a readable table, and even then CSV is far more reliable. PDF statement layouts vary enormously between banks and we would rather refuse than silently put your numbers in the wrong columns. Every bank offers a CSV or Excel export — use that.",
      keywords: ["pdf", "scan", "image", "photo", "upload"],
    },
    {
      question: "Is this GST filing software?",
      answer:
        "No. It does not file anything, compute a tax liability, or calculate input tax credit. It produces a categorised ledger and a shortlist of payments that commonly carry GST, so you know which invoices to collect. Your CA or your filing software does the rest.",
      keywords: ["gst", "file", "filing", "itc", "input tax credit", "return", "gstr"],
    },
    {
      question: "How are dates read?",
      answer:
        "Day-first (dd/mm/yyyy), which is what every Indian bank uses, unless the file uses an unambiguous ISO date or a month name. The result page tells you which convention it used, because reading 03/09 as March 9th would move transactions into the wrong quarter.",
      keywords: ["date", "format", "dd/mm", "mm/dd", "quarter"],
    },
    {
      question: "What happens to my statement?",
      answer:
        "It is processed to build your ledger. An anonymised copy of the descriptions and amounts is kept to improve the categorisation rules — account numbers, IFSC codes, UPI IDs, phone numbers and names are replaced with meaningless tokens before anything is stored. The original file is never written to disk.",
      keywords: ["privacy", "data", "store", "secure", "delete", "confidential"],
    },
    {
      question: "What if a category is wrong?",
      answer:
        "Every row shows the keyword that produced its category, so you can spot it immediately. Fix it in the Excel export, and email us the description — merchant rules are the part of this tool that gets better every week.",
      keywords: ["wrong", "incorrect", "category", "fix", "edit", "override"],
    },
    {
      question: "Does it handle transfers between my own accounts?",
      answer:
        "Only when the description says so, which banks are inconsistent about. If you shuffle money between your own accounts a lot, some of it will show up as both income and spending. The uncategorised list is the first place to look for that.",
      keywords: ["transfer", "self", "own account", "double", "duplicate"],
    },
    {
      question: "What does it cost?",
      answer:
        "Your first statement is free and complete — categories, totals, Excel export, everything. After that it is ₹149 per statement, or ₹399 a month if you do this regularly. No trial that turns into a subscription.",
      keywords: ["price", "cost", "free", "trial", "subscription", "pricing"],
    },
  ],

  disclaimer:
    "Statement to Ledger provides bookkeeping and categorisation assistance, not tax, accounting or legal advice. Categories are produced by keyword rules and will sometimes be wrong; every row shows the keyword that decided it so you can check. The GST section is a shortlist of payments worth reviewing against invoices — it is not an input tax credit computation, and nothing here is filed or submitted anywhere. Have a chartered accountant review anything you intend to file.",
};
