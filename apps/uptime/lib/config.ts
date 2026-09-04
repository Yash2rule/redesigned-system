import type { ProbeConfig } from "@probes/ui";

export const config: ProbeConfig = {
  id: "uptime",
  name: "Client Watch",
  tagline: "Uptime, SSL and domain expiry for every client site, on one branded page.",
  headline: "Find out which client site is about to break — before the client does.",
  subheadline:
    "Paste your client domains. In one pass you get whether each site is up, when its certificate expires, when its domain expires, and which security headers are missing. Then put it on a status page with your name on it, send your client the link, and it re-checks itself every day.",
  ctaLabel: "Check my client sites",
  accent: "#7c3aed",
  accentSoft: "#f5f3ff",
  contactEmail: "hello@clientwatch.dev",

  benefits: [
    {
      title: "The three things that actually break",
      body: "A site going down is loud. An expiring certificate and a lapsing domain are silent right up until they take everything offline on a Saturday. All three, one check.",
    },
    {
      title: "Your name on it, not ours",
      body: "The status page carries your agency's name and colour. Send the link to a client and it reads as your monitoring, because it is.",
    },
    {
      title: "Findings with the fix attached",
      body: "Not a red dot. Each finding says what is wrong, what the client sees, and the exact header or setting that fixes it — so a junior can action it.",
    },
  ],

  plans: [
    {
      id: "studio",
      name: "Studio",
      amountMinor: 2900,
      currency: "USD",
      interval: "month",
      description: "For a small agency with a handful of retainer clients.",
      features: ["Up to 25 monitors", "Branded status page on our domain"],
      planned: ["Weekly email report", "Email alert when something changes"],
    },
    {
      id: "agency",
      name: "Agency",
      amountMinor: 7900,
      currency: "USD",
      interval: "month",
      description: "For agencies billing monitoring as part of a retainer.",
      highlight: true,
      features: [
        "Up to 150 monitors",
        "Per-client status pages",
        "Client-ready PDF report, on demand",
      ],
      planned: [
        "Your logo and your own domain on the status page",
        "Hourly re-checks instead of daily",
        "The weekly report emailed out for you",
      ],
    },
  ],

  faq: [
    {
      question: "How is this different from a normal uptime monitor?",
      answer:
        "Most uptime monitors tell you a site is down after it goes down. The two failures that actually embarrass an agency — an expired certificate and a lapsed domain — are visible weeks in advance, and most tools either charge extra for them or don't check them at all. This checks all three together.",
      keywords: ["different", "uptime", "pingdom", "uptimerobot", "competitor", "why"],
    },
    {
      question: "Does the free check store anything?",
      answer:
        "The domains you check and the results are stored so your status page keeps working and so we can improve the checks. Domains are not personal data, and we do not ask for an account to run a check. We never fetch anything but the page's headers and its certificate.",
      keywords: ["privacy", "store", "data", "account", "signup"],
    },
    {
      question: "Why does domain expiry sometimes say unknown?",
      answer:
        "We use RDAP, the free public registry protocol that replaced WHOIS. Most generic domains publish an expiry date through it. Several country registries — .in is the one Indian agencies hit most — publish thin records or none at all. When that happens we say unknown rather than guessing a date.",
      keywords: ["rdap", "whois", "expiry", "unknown", ".in", "domain", "registry"],
    },
    {
      question: "How often are the checks run?",
      answer:
        "The check runs the moment you press the button, and every monitor set is then re-checked automatically once a day — free ones included. The status page shows the last fortnight of those checks. Paid plans add more monitors, hourly re-checks instead of daily, email alerts, and your own domain. A daily check still does not give you a true uptime percentage, and we don't claim one.",
      keywords: ["frequency", "how often", "schedule", "cron", "interval", "uptime percentage"],
    },
    {
      question: "Can I put it on my own domain?",
      answer:
        "On the Agency plan, yes — status.youragency.com via a CNAME. On Studio the status page lives on our domain but carries your name and colour.",
      keywords: ["white label", "domain", "cname", "brand", "logo", "custom"],
    },
    {
      question: "Do you check anything behind a login?",
      answer:
        "No. We make one unauthenticated request, exactly like a visitor would, and read the response headers and the certificate. We do not log in, submit forms, or crawl.",
      keywords: ["login", "auth", "private", "staging", "password", "crawl"],
    },
    {
      question: "What if a check is wrong?",
      answer:
        "Every result shows the raw evidence — the status code, the redirect chain, the certificate dates, the registry status strings. If our reading disagrees with what you see, the raw data is right there to check it against, and emailing us the domain is the fastest fix.",
      keywords: ["wrong", "false positive", "incorrect", "accuracy", "bug"],
    },
    {
      question: "What does it cost?",
      answer:
        "Checking up to eight domains is free with no account. Paid plans start at $29 a month for scheduled checks, the branded status page and the weekly report. Billing is in US dollars through Lemon Squeezy, who handle sales tax as merchant of record.",
      keywords: ["price", "cost", "free", "plan", "billing", "subscription", "usd"],
    },
  ],

  disclaimer:
    "Client Watch reports what a single unauthenticated request and TLS handshake return at the moment you run them, plus public registry data via RDAP. It is a diagnostic, not a guarantee of uptime, security or compliance, and a passing check is not evidence that a site is secure. Domain expiry is unavailable for registries that do not publish it, and is shown as unknown rather than estimated. We make one ordinary request per site and never attempt to log in or bypass anything.",
};
