# Validation probes

Four small paid products, built in parallel to find out which one strangers
will pay for. One shared engine, one dashboard comparing all four funnels.

Read [`DECISIONS.md`](./DECISIONS.md) for why these four, then
[`HANDOFF.md`](./HANDOFF.md) for what needs a human.

## The probes

| App | What it does | Price | Rail |
| --- | --- | --- | --- |
| [`apps/offer-decoder`](./apps/offer-decoder) | Indian CTC breakup → real monthly in-hand, both tax regimes, red-flag clauses quoted from the letter | ₹199 / ₹499 | Razorpay |
| [`apps/ledger`](./apps/ledger) | Bank or UPI CSV → categorised ledger, monthly totals, GST review list, Excel | ₹149 / ₹399 mo | Razorpay |
| [`apps/uptime`](./apps/uptime) | Uptime + SSL expiry + domain expiry, white-label status page, for agencies | $29 / $79 mo | Lemon Squeezy |
| [`apps/freelancer-kit`](./apps/freelancer-kit) | GST invoice, freelance contract, advance-tax schedule | ₹299 mo | Razorpay |
| [`apps/admin`](./apps/admin) | All four funnels side by side, kill/keep toggle | — | — |

## Quick start

```bash
pnpm install
pnpm build     # all five apps
pnpm test      # 417 tests
pnpm dev       # all five in parallel, on ports 3000-3003 and 3010
```

Everything works with an empty environment. Each app has an `.env.example`
documenting every variable and what degrades without it. The only variable that
is ever required is `ADMIN_PASSWORD`, and only for the dashboard.

To look at the dashboard with realistic numbers before you have traffic:

```bash
DATA_DIR=./.data-demo pnpm seed
cd apps/admin && DATA_DIR=../../.data-demo ADMIN_PASSWORD=changeme pnpm dev
# then http://localhost:3010
```

## Packages

| Package | What it holds |
| --- | --- |
| `packages/core` | Ingestion (PDF/CSV), LLM provider abstraction, structured output, PDF and Excel rendering, Indian tax and statutory tables, PII-redacting corpus, the Store |
| `packages/ui` | Landing template, upload widget, pricing block, result view, support widget |
| `packages/billing` | `createCheckout()` over Razorpay and Lemon Squeezy, with honest intent capture when no keys exist |
| `packages/analytics` | One `track()` helper, store-first with a PostHog mirror |
| `packages/auth` | Optional magic-link auth |
| `packages/app-kit` | Shared route factories and the upload → extract → reason → store pipeline |

## Three rules the code holds to

**Nothing is faked to a visitor.** No payment keys means the button says so and
records intent. No OCR means we say we can't read images rather than guessing at
someone's salary. Fewer than eight contributed offers means the benchmark says
"not enough data" instead of showing one.

**Anything tax- or legal-adjacent is framed as drafting and explanation
assistance**, lists every assumption it used, refuses to invent a statutory
citation, and never files anything.

**Results are auditable, not just accurate.** Categorisation shows the keyword
that produced it. Clause flags quote the sentence they matched. Tax figures show
the slabs, the rebate and the surcharge separately, so a CA can check the
arithmetic in thirty seconds.

## Security invariants worth knowing before you change things

Three things here are load-bearing and each has tests that fail loudly if you
remove them.

**The uptime checker is an SSRF target by design** — it takes a hostname from a
stranger and makes a request to it from our server. `apps/uptime/lib/safe-url.ts`
allows only http/https, only ports 80 and 443, and only publicly routable
addresses, re-checked on every redirect hop. Critically, it also *pins* the
connection to the address it vetted (`pinnedLookup`), because otherwise the
client would resolve the hostname a second time and a nameserver the attacker
controls could answer the two queries differently. That is why `checkHttp` uses
`node:http` rather than `fetch`: `fetch` gives no way to choose the address it
connects to. Response bodies are never read, only drained.

**Anything a stranger typed is escaped for wherever it lands.** The admin CSV
export neutralises leading `=` `+` `-` `@` before quoting, because a spreadsheet
runs those as formulas and the `note` field on a purchase intent is written
exclusively by hand-crafted requests.

**Cron routes fail closed.** No `CRON_SECRET` of at least 16 characters means
they refuse to run rather than running unauthenticated. Same for the admin
dashboard without `ADMIN_PASSWORD`.

No key material lives in the repository. The TLS test certificates are generated
at test time by `tests/certs.ts`, with expiry relative to the moment the suite
runs — so the "nearly expired" case is always nearly expired and the tests never
go red on a date nobody wrote down.

## Deploying

```bash
npm i -g vercel && vercel login
pnpm deploy:all
```

Then set `DATABASE_URL` on all five projects — without it, funnel data does not
survive a redeploy. See `HANDOFF.md` item 1.
