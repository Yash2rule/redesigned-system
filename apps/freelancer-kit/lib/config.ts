import type { ProbeConfig } from "@probes/ui";

export const config: ProbeConfig = {
  id: "freelancer-kit",
  name: "Freelance Desk",
  tagline: "Invoices, contracts and advance-tax dates for Indian freelancers.",
  headline: "The paperwork side of freelancing, done in three minutes instead of three evenings.",
  subheadline:
    "A GST invoice that splits CGST and SGST correctly, a services agreement written in plain words, and an advance-tax schedule that knows section 44ADA has one due date rather than four. Your details are remembered so the second invoice takes seconds. No account needed.",
  ctaLabel: "Make an invoice",
  accent: "#b45309",
  accentSoft: "#fffbeb",
  contactEmail: "hello@freelancedesk.in",

  benefits: [
    {
      title: "Type your details once",
      body: "Your name, GSTIN, PAN and address are remembered, your clients build up into a list you pick from, and the invoice number increments itself. All of it stays in your browser — none of it is sent to us.",
    },
    {
      title: "GST that splits the right way",
      body: "Same state as your client means CGST plus SGST at half the rate each. Different state means IGST at the full rate. We decide it from the GSTINs, not from a dropdown you might get wrong — and if you have no GSTIN, we refuse to add tax at all.",
    },
    {
      title: "The 44ADA date almost nobody gets right",
      body: "Under presumptive taxation the whole year's advance tax is due in one instalment on 15 March. Most calculators show four dates regardless. We show your actual schedule and say which rule produced it.",
    },
  ],

  plans: [
    {
      id: "monthly",
      name: "Monthly",
      amountMinor: 29900,
      currency: "INR",
      interval: "month",
      description: "Unlimited invoices, contracts and tax estimates.",
      highlight: true,
      features: [
        "Unlimited GST invoices and contracts",
        "Your details and your clients' saved, so you type them once",
        "Invoice numbers that increment themselves",
        "Contracts that remember the terms you always use",
        "An email before every advance-tax due date",
        "Everything as PDF",
      ],
    },
    {
      id: "yearly",
      name: "Yearly",
      amountMinor: 249900,
      currency: "INR",
      interval: "year",
      description: "Two months free against the monthly price.",
      features: ["Everything in Monthly"],
      planned: [
        "Financial-year invoice register for your CA",
        "Year-end receipts summary",
      ],
    },
  ],

  faq: [
    {
      question: "Is this tax or legal advice?",
      answer:
        "No. It is a document generator and an arithmetic calculator that shows you every rule and assumption it used. It does not file anything, does not sign anything, and is not a substitute for a CA or a lawyer. For anything with real money in it, have one of them read the output.",
      keywords: ["advice", "legal", "tax", "ca", "lawyer", "chartered accountant"],
    },
    {
      question: "I'm not registered for GST. Can I still use this?",
      answer:
        "Yes, and it will produce a plain invoice with no tax on it. That is the correct document: charging GST without a GSTIN means collecting a tax you have no authority to collect. Registration generally becomes compulsory once turnover crosses ₹20 lakh a year for services, ₹10 lakh in some special-category states. Confirm your own position with a CA.",
      keywords: ["gst", "registration", "gstin", "not registered", "threshold", "20 lakh"],
    },
    {
      question: "How do you decide between CGST plus SGST and IGST?",
      answer:
        "From the state codes in the two GSTINs, which are the first two digits of each. Same state is an intra-state supply, so the tax splits into CGST and SGST at half the rate each. Different states, or no client GSTIN, is inter-state and gets a single IGST at the full rate. The invoice shows which one it applied and why.",
      keywords: ["cgst", "sgst", "igst", "intra", "inter", "state", "place of supply"],
    },
    {
      question: "What is section 44ADA and why does it change my dates?",
      answer:
        "It is presumptive taxation for professionals: half your gross receipts are deemed to be profit, up to ₹75 lakh of receipts, and you do not maintain detailed books. It also changes when advance tax is due — the whole amount in one instalment by 15 March, instead of four instalments starting in June. Most calculators miss this and show the four-date schedule anyway.",
      keywords: ["44ada", "presumptive", "advance tax", "instalment", "15 march", "june"],
    },
    {
      question: "Is the contract enforceable?",
      answer:
        "We don't claim it is. It is a template filled in with your details, written to be readable rather than to be clever. It has not been reviewed by a lawyer for your situation, and no template can be. It gets you to a first draft far faster than a blank page — read every clause before you send it.",
      keywords: ["contract", "enforceable", "legal", "template", "lawyer", "valid"],
    },
    {
      question: "Where are my details and my clients stored?",
      answer:
        "In your browser, not on our servers. Your name, GSTIN, PAN, address, your saved clients and your usual contract terms are held in local storage on the device you are using, so we never receive them. The trade-off is that they do not follow you to another browser or device, and clearing site data loses them. There is a 'forget everything now' link under the invoice form.",
      keywords: ["privacy", "store", "data", "client", "delete", "secure", "saved", "remember", "localstorage"],
    },
    {
      question: "What about the documents themselves?",
      answer:
        "The generated documents are stored so you can download them again. An anonymised copy of the structure is kept to improve the templates — names, addresses, emails, phone numbers, PAN and GSTIN are replaced with meaningless tokens before anything is written down.",
      keywords: ["document", "pdf", "retain", "anonymised", "corpus"],
    },
    {
      question: "Which financial year are the tax rules from?",
      answer:
        "FY 2025-26, assessment year 2026-27. The slabs, the rebate, the surcharge bands and the 44ADA limits are all in one file with the year attached, and the result page tells you which year it used. When the Budget changes them, that file changes.",
      keywords: ["year", "fy", "2025", "2026", "slab", "budget", "updated"],
    },
    {
      question: "What does it cost?",
      answer:
        "Your first invoice, first contract and first tax estimate are free and complete, with the PDFs. After that it is ₹299 a month or ₹2,499 a year. No trial that turns into a subscription.",
      keywords: ["price", "cost", "free", "trial", "subscription", "pricing"],
    },
  ],

  disclaimer:
    "Freelance Desk provides document drafting and calculation assistance, not tax, legal or accounting advice. Invoices are generated from the details you enter against the particulars the CGST Rules require; tax figures are estimates computed from published FY 2025-26 rules, with every assumption listed. Contracts are templates and have not been reviewed by a lawyer for your circumstances. Nothing here is filed, submitted or signed on your behalf. Have a chartered accountant check anything you intend to file and a lawyer check anything you intend to sign.",
};
