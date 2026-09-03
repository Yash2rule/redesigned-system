# DECISIONS.md

Written before any code. Author: autonomous overnight build session, 2026-09-03.
Everything here was decided without human input, per the brief.

---

## 1. Environment facts that drove every decision

I checked the environment before choosing. These are facts, not assumptions:

| Thing | Status |
| --- | --- |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | **absent** |
| `DATABASE_URL` / Supabase / Neon creds | **absent** |
| Vercel token | **absent** |
| Razorpay / Lemon Squeezy keys | **absent** |
| PostHog / Resend keys | **absent** |
| npm registry | reachable |
| Node / pnpm | v22.22.2 / 10.33.0 |

**Consequence:** I cannot deploy tonight, and I cannot rely on an LLM call to
produce a probe's core result. So the single most important selection criterion
became one the brief implies but does not state:

> **Does this probe produce a genuinely real, correct result for a stranger with
> zero credentials configured?**

A probe whose core flow is a stub until the owner pastes an API key is not a
validation probe. It is a landing page. Landing pages measure curiosity, not
willingness to pay. So I weighted "works with no keys" heavily.

---

## 2. Scoring

Scored 1-5 on the brief's four criteria, plus the credential-independence
criterion above (weighted x2 because of section 1).

| # | Probe | (a) build tonight | (b) fewest creds | (c) 5-sec clarity | (d) code sharing | (e) real result, zero keys (x2) | **Total /30** |
|---|---|---|---|---|---|---|---|
| 1 | Offer-letter decoder | 5 | 5 | 5 | 5 | 5 (10) | **30** |
| 3 | UPI/bank statement -> ledger | 5 | 5 | 5 | 5 | 5 (10) | **30** |
| 4 | White-label uptime/SSL/domain monitoring | 4 | 5 | 5 | 3 | 5 (10) | **27** |
| 7 | Freelancer contract+invoice+advance-tax | 4 | 5 | 4 | 5 | 5 (10) | **28** |
| 2 | LLM prompt regression testing | 4 | 3 | 4 | 2 | 3 (6) | **19** |
| 6 | Vernacular document explainer | 3 | 2 | 5 | 5 | 1 (2) | **17** |
| 8 | Tax-notice reply drafter | 2 | 2 | 4 | 5 | 1 (2) | **15** |
| 5 | Property/vehicle due-diligence | 2 | 1 | 5 | 4 | 1 (2) | **14** |

### Why each score, briefly

- **1 Offer-letter decoder.** The hard part is arithmetic, not intelligence.
  Indian CTC -> in-hand is a deterministic calculation: gross, employer PF
  exclusion, employee PF, professional tax by state, income tax under the new
  regime slabs (FY 2025-26), gratuity provisioning, variable pay at realistic
  payout ratios. An LLM is *optional polish* for parsing free-text letters, not
  the engine. Red-flag clause detection is a rule/keyword matcher over the
  letter text, which is honest and auditable in a way an LLM is not. Perfect
  score.
- **3 Statement -> ledger.** Same story. Merchant categorisation is a rules
  engine over payee strings; UPI CSV/statement shapes are well known. Excel
  export and GST-style summaries are deterministic. Perfect score.
- **4 Uptime/SSL/domain.** Genuinely real with zero credentials: an HTTPS fetch
  gives status and latency, a raw TLS socket gives the certificate chain and
  `notAfter`, and **RDAP** (the free, public, IANA-run successor to WHOIS) gives
  domain expiry. No paid API anywhere. Only loses a point on (a) because a
  scheduler is needed for real monitoring (Vercel Hobby cron is once-daily), and
  two on (d) because it shares the UI/billing/analytics packages but not the
  document engine.
- **7 Freelancer bundle.** Scores very well and is the strongest reserve. Loses
  a point on clarity only because it is three products in a trench coat, which
  is exactly the thing a validation probe should avoid.
- **2 Prompt regression testing.** Loses on (b) and (e): without a model key
  there is no output to diff. It also shares the least code — a separate data
  model, a separate payment rail, a separate audience, a separate language of
  marketing. It is the highest-ceiling idea on the list and the worst *probe*.
- **6, 8, 5** are all gated on something I do not have: an LLM key, a CA
  reviewer, or a paid KYC API. Each would ship as a landing page with a
  simulated core. That violates "never fake functionality to visitors".

---

## 3. What I am building, and where I overrode the brief

**Building tonight: probes 1, 3, 4, 7.**

The brief says "prefer probes 1, 2, 3, 4 unless your analysis finds a strong
reason otherwise". I am keeping 1, 3, 4 and **swapping probe 2 for probe 7**.
The reason, stated plainly so you can overrule it in the morning:

> Probe 2 cannot show a stranger a real result tonight. Its entire value is
> "run my prompt against a model and diff the output", and I have no model key.
> I would have to either ship it with a fake/echo model — which the brief
> forbids — or ship it key-gated, so the funnel would measure nothing but
> curiosity and would not be comparable against probes 1, 3 and 4 in the admin
> dashboard. Comparability is the entire point of running probes in parallel.
> Probe 7 scores higher on every criterion I can act on tonight, and it reuses
> the document engine, the INR rail, and the same audience as probes 1 and 3, so
> the four probes together form a coherent "Indian professional money-admin"
> portfolio that can cross-link and share traffic.

**If you disagree**, probe 2 is the cheapest to add later: it needs
`packages/core`'s LLM abstraction (which I am building anyway, tonight) plus a
bring-your-own-key form. I have left a note in HANDOFF.md.

**Deliberately not building:** 5 (paid KYC APIs), 6 and 8 (LLM-gated, and 8
additionally needs a CA sign-off before it can be sold at all).

---

## 4. Architecture summary

pnpm workspaces + Turborepo. Next.js 16 App Router, React 19, TypeScript 5.9,
Tailwind v4 (CSS-first, no JS config), Drizzle ORM against Postgres.

### Packages

- **`packages/core`** — the shared engine.
  - `ingest/` — PDF (via `unpdf`, a serverless-safe pdf.js wrapper), CSV (via
    `papaparse`), plain text, and an OCR interface. OCR is *declared but not
    enabled*: `tesseract.js` pulls tens of MB of WASM at runtime, which breaks
    the near-zero-cost and cold-start constraints. Image uploads therefore route
    to the LLM vision path when a key exists, and otherwise the UI honestly says
    "we can't read images yet — paste the text".
  - `llm/` — provider interface with an Anthropic adapter first, plus OpenAI and
    Gemini adapters behind the same interface. Keys from env only, never from
    the repo, never from the client. **If no key is present, every probe still
    produces its full result** — the LLM is an enrichment layer, never the
    engine.
  - `schema/` — zod-based structured-output helpers with repair-and-retry.
  - `render/` — PDF (`pdfkit`) and Excel (`exceljs`) generation.
  - `store/` — a `Store` interface with two implementations: `PgStore`
    (Drizzle + `postgres`) when `DATABASE_URL` is set, and `FileStore`
    (JSON under `.data/`, gitignored) otherwise. This is what lets every app
    run, be tested, and be demoed tonight with no database. Documented as a
    day-one handoff item.
  - `corpus/` — every anonymised input/output pair, per probe, written on every
    run. PII scrubbing (names, emails, phones, PAN, account numbers) happens
    *before* the write, not after.
- **`packages/ui`** — landing template, pricing block, upload widget, result
  view, pay/early-access button, disclaimer footer. Server components by
  default, client only where interaction demands it.
- **`packages/billing`** — `createCheckout()` over Razorpay (INR) and Lemon
  Squeezy (USD). No keys -> intent capture (email, plan, timestamp, session) and
  the honest "Join early access — payments open this week" message.
- **`packages/analytics`** — one `track()` helper emitting the seven required
  events. PostHog if `POSTHOG_KEY` exists, else straight to the store.
- **`packages/auth`** — magic-link, optional by design. Every probe produces its
  first result fully anonymously. Auth only gates history and saved reports.

### Why packages ship as TypeScript source

Each package's `main`/`exports` point at `src/`, and each Next app lists them in
`transpilePackages`. No build step per package, no stale `dist/`, no dual-format
headaches. Tests import the same source the apps do.

### Apps

`apps/offer-decoder`, `apps/ledger`, `apps/uptime`, `apps/freelancer-kit`,
`apps/admin`. Each is independently deployable; each has a landing page, a
working core flow, a real price, and an AI support widget answering from that
probe's own FAQ (rule-matched against the FAQ file, so it works with no LLM key
and never invents an answer — it says "I don't know, here's the email").

### Pricing defaults I chose (change freely)

| Probe | Price | Reasoning |
| --- | --- | --- |
| Offer-letter decoder | ₹199/report, ₹499 for 5 | Impulse-priced against a decision worth lakhs. |
| Statement -> ledger | ₹149/statement, ₹399/mo | Below a part-time bookkeeper, above free. |
| Uptime (agencies) | $29/mo up to 25 monitors, $79/mo up to 150 + white-label | Anchored under the incumbents' agency tiers. |
| Freelancer kit | ₹299/mo, ₹2,499/yr | One invoice's worth of hassle saved per month. |

### Legal/tax framing (non-negotiable, enforced in code)

Probes 1, 3 and 7 touch tax. Every one of them:
- labels output "drafting and explanation assistance, not tax or legal advice",
- shows the assumptions it used (regime, slabs, state, FY) inline with the
  numbers, so a CA can check the arithmetic,
- refuses to fabricate a statutory citation: the LLM layer is given an
  allowlist of sections and instructed to emit `null` rather than guess, and any
  citation not on the allowlist is stripped before render,
- never files, submits, or transmits anything anywhere.

### Validation instrumentation

One `sessions` + `events` table pair shared by all probes, one `probe` column.
`apps/admin` (password from `ADMIN_PASSWORD`) shows the funnel per probe side by
side with a kill/keep toggle persisted to the store.

---

## 5. Risks I accepted

1. **No database tonight.** FileStore keeps everything working locally, but on
   Vercel it degrades to per-instance memory. Setting `DATABASE_URL` is handoff
   item #1 and must happen before any real traffic, or the validation data — the
   entire point — is lost.
2. **Income-tax slabs are hardcoded for FY 2025-26.** They are in one file with
   an effective-date, and the UI states the FY it used. They will need a yearly
   edit; that is better than a wrong answer with no visible assumption.
3. **Domain expiry via RDAP** is not universal: some ccTLDs (notably `.in`)
   serve thin or rate-limited RDAP. The code degrades to "unknown" and says so
   rather than guessing a date.
4. **No live payment rail**, so "paid" is the one funnel event that will read
   zero until you add keys. Every probe therefore optimises for the strongest
   signal I *can* collect honestly: `price_clicked` -> `email_captured` with a
   plan attached. Treat intent-with-email as the ranking metric in the morning.
