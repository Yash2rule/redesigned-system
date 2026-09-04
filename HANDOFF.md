# HANDOFF.md

Everything that needs you. In order. Nothing else was left for you — design,
copy, schema, naming, pricing, sample data and tests are all done and
committed.

**Push status: blocked — see item 0 first.**

**Deployment status: not deployed.** No Vercel, Supabase or Neon credentials
existed in the build environment, so there are no preview URLs to record. The
repo is deploy-ready and item 3 below is a 15-minute job.

Before anything else, prove it runs on your machine:

```bash
pnpm install
pnpm build          # 5 apps, ~60s cold
pnpm test           # 268 tests, ~3s
cd apps/offer-decoder && pnpm dev     # then open http://localhost:3000
```

It will work with a completely empty `.env`. That is deliberate: every probe
produces its full, real result with zero credentials. Each item below turns on
one more thing.

---

## 0. BLOCKED: push access to this repository

**This is the only item that was blocked rather than deferred, and it is why
you are reading this in a local clone rather than on GitHub.**

All the work is committed to the branch
`claude/validation-probes-overnight-uok5hp`, but the push was refused:

```
remote: Claude doesn't have GitHub access to Yash2rule/redesigned-system
        for your organization.
fatal: unable to access '...': The requested URL returned error: 403
```

This is an app-installation permission, not a credential problem. I tested
every route available to this session so you do not have to:

| Route | Result |
| --- | --- |
| `git push` | 403 from the git proxy |
| `git fetch origin main` | works — reads are fine |
| GitHub API with the session's `GITHUB_TOKEN` | authenticates as `Yash2rule`, but every repo-scoped call returns "GitHub access is not enabled for this session" |
| `GET /repos/.../git/refs` with that token | 403 |
| GitHub MCP read (`list_branches`) | works — shows `main` only, so nothing of mine reached the remote |
| GitHub MCP write (`create_branch`) | 403 "Resource not accessible by integration" |

Reads work through one path; every write is refused at the integration level.
There is no route around it from inside this session.

**Fix, either one:**

- Install or re-scope the Claude GitHub App for the organisation:
  https://github.com/apps/claude/installations/select_target
- Or reconnect GitHub from your own account settings:
  https://claude.ai/customize/connectors?auth_start=github&auth_start_force=1

**Then push it yourself** — the commits are already made and the branch already
exists locally:

```bash
git -C <this-repo> push -u origin claude/validation-probes-overnight-uok5hp
```

Fifteen commits, each self-contained, in the order the work was done.
`git log --oneline` reads as a build log.

### If this session's container is gone before you get to it

The container is ephemeral, so I also wrote a git bundle — a single file
containing every commit and all history — and sent it to you in the
conversation. It is also at `validation-probes.bundle` in the home directory
of this session.

Restoring from it loses nothing:

```bash
git clone validation-probes.bundle redesigned-system   -b claude/validation-probes-overnight-uok5hp
cd redesigned-system
git remote set-url origin https://github.com/Yash2rule/redesigned-system
git push -u origin claude/validation-probes-overnight-uok5hp
```

I verified this round-trips: 15 commits, 236 files, identical HEAD.

---

## 1. Database — Supabase or Neon

**Why:** Without `DATABASE_URL` every app writes its funnel data to local JSON
files. On Vercel that means each serverless instance keeps its own copy and a
redeploy loses all of it — which destroys the only thing these probes exist to
produce. It also means the admin dashboard cannot see the apps' data at all,
because they are five separate deployments.

This is the single most important item. Do it before you send anyone a link.

```
https://supabase.com/dashboard  →  new project  →  Settings → Database
  → Connection string → URI  (use the pooled "Transaction" one, port 6543)
```
or
```
https://console.neon.tech  →  new project  →  copy the pooled connection string
```

Set the **same** `DATABASE_URL` on all five Vercel projects. Tables create
themselves on first request — there is no migration step to run.

Verify: open `<any-app>/api/health` and check `"database": true`.

---

## 2. Admin password

**Why:** The dashboard refuses to serve anything until `ADMIN_PASSWORD` is set,
and it should — the funnel data includes the email address of every person who
asked to be told when payments open.

```bash
openssl rand -base64 24
```

Set it as `ADMIN_PASSWORD` on the `admin` project only. Minimum 8 characters.

---

## 3. Vercel projects

**Why:** Nothing is deployed. Five projects, one per app, each independently
deployable from this monorepo.

```bash
npm i -g vercel && vercel login
pnpm deploy:all          # preview URLs
pnpm deploy:all -- --prod
```

The script prompts once per app to link a project — give each a distinct name.
Each app already has a `vercel.json` with the right build command and region
(Mumbai for the three rupee-priced probes, US East for the dollar-priced one).

After deploying, set `DATABASE_URL` (item 1) on every project and
`ADMIN_PASSWORD` (item 2) on admin, then redeploy.

**Record the URLs here when you have them:**

| App | Preview URL | Production URL |
| --- | --- | --- |
| offer-decoder | | |
| ledger | | |
| uptime | | |
| freelancer-kit | | |
| admin | | |

---

## 4. Payment keys

**Why:** Until these exist, every buy button records purchase intent and tells
the visitor plainly that payments are not open. That is honest and it still
measures something — but `paid` will read zero on the dashboard for every
probe, so it cannot rank anything.

Do this **after** you know which probe is winning, not before. One rail is
enough to start.

**Razorpay (INR — offer-decoder, ledger, freelancer-kit)**
```
https://dashboard.razorpay.com/app/website-app-settings/api-keys
```
Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Start with the `rzp_test_`
keys. No code change needed — the button switches itself the moment the keys
are present.

**Lemon Squeezy (USD — uptime)**
```
API key:  https://app.lemonsqueezy.com/settings/api
Store ID: https://app.lemonsqueezy.com/settings/stores
```
Set `LEMONSQUEEZY_API_KEY` and `LEMONSQUEEZY_STORE_ID`. You must **also** create
a product variant per plan and paste each numeric variant id into the
`providerRef` field of the matching plan in `apps/uptime/lib/config.ts`. Without
it checkout returns a clear error instead of a broken payment page.

Lemon Squeezy is the USD rail specifically because they act as merchant of
record and handle US/EU sales tax, which you cannot register for.

---

## 5. Domains and DNS

**Why:** Four probes on `*.vercel.app` look like four side projects. On their
own domains they look like four products, and the difference shows up in the
conversion numbers you are trying to read.

Suggested names, all currently placeholders in the code:

| Probe | Placeholder domain | Where it appears |
| --- | --- | --- |
| offer-decoder | `offerdecoder.in` | `apps/offer-decoder/lib/config.ts` (`contactEmail`) |
| ledger | `statementledger.in` | `apps/ledger/lib/config.ts` |
| uptime | `clientwatch.dev` | `apps/uptime/lib/config.ts` |
| freelancer-kit | `freelancedesk.in` | `apps/freelancer-kit/lib/config.ts` |

Buy at any registrar, add to the Vercel project, follow Vercel's DNS
instructions. Then set `APP_BASE_URL` per project.

**Do not skip the email addresses.** They are in every footer, every FAQ, and
in the support widget's "I don't know, email us" fallback. An unread address
there is the one dishonest thing in an otherwise honest product.

---

## 6. AI key (optional)

**Why:** Genuinely optional. Every probe produces its complete result with no
model. The LLM is an enrichment layer over deterministic logic, never the
engine. With a key, the support widget rephrases FAQ answers instead of
returning them verbatim — that is the whole difference today.

```
https://console.anthropic.com/settings/keys
```
Set `ANTHROPIC_API_KEY`. `OPENAI_API_KEY` and `GEMINI_API_KEY` work too; the
provider abstraction picks the first key it finds unless `LLM_PROVIDER` says
otherwise.

Leave it unset until a probe is winning. It is a running cost with no
validation value.

---

## 7. Analytics and email (optional)

**PostHog** — `POSTHOG_KEY` from https://app.posthog.com/settings/project.
Events go to your database regardless; PostHog is a mirror, not the source of
truth. The admin dashboard reads the database. Add it if you want funnels and
session replay you did not have to build.

**a. `CRON_SECRET` (uptime probe only)** — needed for scheduled re-checks. Set
it and the daily cron in `apps/uptime/vercel.json` starts refreshing every live
monitor set, which is what makes a status page you sent a client stay current.

```bash
openssl rand -base64 24
```

Without it `/api/cron/check` refuses every request, including Vercel's own —
deliberately, because that endpoint makes outbound requests to arbitrary
third-party domains and an open version of it is a request amplifier pointed at
other people's servers. Nothing else breaks; status pages just go stale.

**Resend** — `RESEND_API_KEY` from https://resend.com/api-keys, plus
`AUTH_FROM_EMAIL` and an `AUTH_SECRET` of at least 16 characters. Only needed
for magic-link sign-in, which is optional by design: every probe produces its
first result with no account at all. You will need it eventually to email the
people who left an address.

---

## 8. A chartered accountant, for the freelancer kit

**Why:** `apps/freelancer-kit` generates GST invoices. The rules are
implemented from the particulars Rule 46 requires and are covered by 36 tests —
but tested is not the same as reviewed, and this is the one probe where being
wrong costs a user real money and real credibility with their client's accounts
team.

Have a CA check one invoice of each of these four shapes before you describe it
publicly as GST-compliant:

1. Intra-state (supplier and client in the same state → CGST + SGST)
2. Inter-state (different states → single IGST)
3. Unregistered supplier (no GSTIN → no tax at all, plain invoice)
4. Export of services under LUT (zero-rated)

Generate all four from the deployed app and send the PDFs. It is one hour of
someone's time.

**Also worth one lawyer-hour:** the contract template in
`apps/freelancer-kit/lib/contract.ts`. It says on its face that it has not been
reviewed, which is honest. One review would let you soften that to "reviewed
once, not for your situation" — more useful, and still true.

---

## 9. Two claims I could not verify from this machine

Both are in the code and both are tested against recorded or local data. Neither
could be confirmed against the live internet, because outbound requests from the
build environment go through a filtering proxy that returns 403 for most hosts
and terminates TLS with its own certificate.

**a. RDAP domain expiry (`apps/uptime`).** `https://rdap.org` returned 403 from
here. The parsing is tested against realistic RDAP payloads, and the failure
path (registry does not publish expiry → report "unknown") is tested. But
**before you post the uptime launch content, run one live check against a real
domain and confirm a real expiry date comes back.** The launch post claims this
works. If it does not, the fix is likely a different RDAP base — set
`RDAP_BASE_URL` to a registry endpoint directly.

**b. Live TLS against real hosts.** Certificate reading is tested against local
HTTPS servers with three generated certificates (valid, near-expiry,
wrong-hostname), and a raw handshake to a real host worked from a plain node
process. Inside the app the proxy substituted its own certificate, so the
end-to-end path against the public internet is unproven. Run one check against
a domain whose expiry date you know.

Neither is a suspected bug. Both are unverified, and I would rather say so.

---

## 10. Posting the launch content

Each probe has a `LAUNCH.md` with three ready-to-post pieces and a
"before you post" checklist. In order of what I would actually do:

1. **freelancer-kit** — but only after item 8. Sharpest hook (the 44ADA
   single-instalment rule), most defensible claim, clearest audience.
2. **offer-decoder** — biggest audience, easiest to explain in five seconds.
   Post to r/developersIndia when you can sit with the thread for two hours.
3. **ledger** — the Show HN is the strongest piece of writing of the eight,
   because the parsing problem is genuinely interesting to that audience.
4. **uptime** — after item 9a.

Do not post all four in one week. You will not be able to tell which signal came
from which product, which is the entire point of running them in parallel.

---

## 11. Things I did not finish, and exactly where I stopped

**Hourly re-checks for the uptime probe.** Daily re-checks are built and
working (`/api/cron/check`, wired to a daily cron in
`apps/uptime/vercel.json`, gated on `CRON_SECRET` — see item 7a). The Agency
plan promises *hourly*, which Vercel Hobby cannot do: it allows one cron per
day. Either move that project to Pro, or point an external pinger (a GitHub
Actions schedule works and is free) at `/api/cron/check` with the same bearer
token. Until then, do not describe hourly checks as available.

**Every paid plan now separates what works from what does not.** An audit
found six features listed on pricing pages that existed only in the copy —
saved client details, emailed reports, category overrides, a financial-year
rollup, and so on. One of them, the side-by-side offer comparison, was worth
building and is built. The rest moved into a `planned` list that the pricing
block renders under "Not built yet", and `tests/pricing-claims.test.ts` fails
the build if an unbuilt capability is ever listed as working again. When you
build one of them, move the string from `planned` to `features`.

**Probe 2 (LLM prompt regression testing) was not built.** I swapped it for
probe 7; the reasoning is in `DECISIONS.md` §3. Short version: without a model
key it cannot show a stranger a real result, so its funnel would have measured
curiosity and would not have been comparable against the other three. If you
disagree, it is the cheapest one to add — it needs the LLM abstraction in
`packages/core/src/llm` (already built and used) plus a bring-your-own-key form.

**Magic-link auth is built but unused.** `packages/auth` works and is tested by
inspection, not by a test file. No probe calls it, because every probe
deliberately works anonymously for the first result. It is there for when you
need saved history.

**The offer-decoder comparison benchmark shows nothing yet.** By design: it
needs eight real contributed offers before it will show a comparison, and says
so plainly until then. Do not seed it. Seeded benchmark data would be exactly
the kind of lie that is only ever told to oneself.

**`paid` will read zero on the dashboard** until item 4. The dashboard says
this on the page and ranks on result-to-email instead. Switch the ranking to
`paid` once a rail is live — it is one comparator in
`apps/admin/app/page.tsx`.

**Rate limiting is per-instance, not global.** There is a limiter — 10 checks
an hour for the uptime probe, 30 documents an hour for the others, keyed on the
forwarded IP. It lives in process memory, so on a serverless host the budget is
per warm instance rather than shared. That stops the thing that actually
happens at this scale (one person, one script, one loop) and would not stop a
distributed attacker. The 429 response says `x-ratelimit-scope: per-instance`
so nobody builds on it thinking otherwise. If a probe gets real traffic, move
the counter into Postgres — `packages/app-kit/src/rate-limit.ts` is about
eighty lines and the interface would not change.

The SSRF guard is separate and thorough: see `apps/uptime/lib/safe-url.ts` and
its 19 tests.

**Income tax slabs are hardcoded for FY 2025-26.** One file,
`packages/core/src/india/tax.ts`, with the year attached, and every result page
states which year it used. It needs a yearly edit after each Budget. That is
better than a silently wrong answer.
