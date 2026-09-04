# HANDOFF.md

Everything that needs you. In order. Nothing else was left for you — design,
copy, schema, naming, pricing, sample data and tests are all done and
committed.

**Push status: pushed.** The branch is on GitHub — item 0 has the link. No
pull request has been opened; that is your call.

**Deployment status: one of five.** offer-decoder is live on Supabase and
verified; the other four are blocked on a Vercel token that can create
projects, which is the first thing item 3 explains.

Before anything else, prove it runs on your machine:

```bash
pnpm install
pnpm build          # 5 apps, ~60s cold
pnpm test           # 443 tests, ~3s
cd apps/offer-decoder && pnpm dev     # then open http://localhost:3000
```

It will work with a completely empty `.env`. That is deliberate: every probe
produces its full, real result with zero credentials. Each item below turns on
one more thing.

---

## 0. Done: the branch is on GitHub

**This item was blocked for most of the build and is now resolved.** You
reconnected the GitHub App, and everything pushed:

```
https://github.com/Yash2rule/redesigned-system/tree/claude/validation-probes-overnight-uok5hp
```

34 commits, each self-contained, in the order the work was done — `git log
--oneline` reads as a build log. Verified: the remote branch and the local
branch are the same commit, with nothing unpushed.

No pull request has been opened. That is deliberate — you did not ask for one,
and it is your call whether this lands on `main` as a PR or gets merged
directly. To open one:

```bash
gh pr create --base main --head claude/validation-probes-overnight-uok5hp
```

Nothing below this line depends on it any more. Start at item 1.

<details>
<summary>What the block was, for the record</summary>

`git push` returned 403 — "Claude doesn't have GitHub access to
Yash2rule/redesigned-system for your organization" — while reads worked fine.
It was an app-installation permission, not a credential problem:

| Route | Result while blocked |
| --- | --- |
| `git push` | 403 from the git proxy |
| `git fetch origin main` | worked — reads were fine |
| GitHub API with the session's `GITHUB_TOKEN` | authenticated as `Yash2rule`, but every repo-scoped call returned "GitHub access is not enabled for this session" |
| GitHub MCP read (`list_branches`) | worked — showed `main` only |
| GitHub MCP write (`create_branch`) | 403 "Resource not accessible by integration" |

Reinstalling or re-scoping the Claude GitHub App fixed it. Worth knowing if a
future session hits the same wall: there is no route around it from inside the
session, and the fallback was a `git bundle` sent through the conversation,
which round-trips to an identical HEAD with no history lost.

</details>

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

The dashboard is also where you reach the people who left an email: download
the list as CSV, or write them a message. That flow is dry-run by default,
de-duplicates anyone who left their address on several probes, shows the exact
message and the real recipient count first, and only sends when you type SEND.
There is no undo, which is why it asks twice.

---

## 3. Vercel projects

**Why:** Five projects, one per app, each independently deployable from this
monorepo. One of them is live; four are not.

There are three ways in. **Prefer the Git integration** — it needs no token on
any machine but yours, and it redeploys on every push afterwards. Route **c**
is the unattended one, and is where the two credential traps are written down.

### a. Git integration (recommended)

`main` now carries all five apps, so there is nothing to merge first — Vercel
builds the production branch and the production branch is complete.

In the Vercel dashboard, four times — once per app still missing:

```
Add New → Project → import Yash2rule/redesigned-system
  Root Directory        apps/<offer-decoder|ledger|uptime|freelancer-kit|admin>
  Include files outside the Root Directory   ON      ← required
  Framework                                  Next.js (auto-detected)
```

Leave build and install commands alone; each app's `vercel.json` already sets
them. That checkbox is not optional: the build command starts with `cd ../..`
because the install has to happen at the workspace root, and without it Vercel
only uploads the app folder and the build fails on a missing lockfile.

Give each project a distinct name — `probe-offer-decoder`, `probe-ledger`, and
so on. The admin one is worth naming so you recognise it in a hurry.

### b. CLI, if you would rather

```bash
npm i -g vercel && vercel login
pnpm deploy:all          # preview URLs
pnpm deploy:all -- --prod
```

The script prompts once per app to link a project — give each a distinct name.

### c. API, unattended — `pnpm provision`

`scripts/vercel-provision.mjs` does the whole of this item from the REST API
with a token and no prompts: creates each project, sets the root directory and
the outside-files flag, writes `DATABASE_URL` (and `ADMIN_PASSWORD` on admin),
triggers a production deploy from `main`, waits for the build, then checks
`/api/health` actually answers *as the right probe* — a project pointed at the
wrong root directory builds and serves perfectly happily, it just serves
somebody else's app.

```bash
export VERCEL_TOKEN=...            # see the warning below
export VERCEL_TEAM_ID=team_QII22sqhA7Awl93TStAbTxjd
export DATABASE_URL=...            # the same Supabase string all five share
export ADMIN_PASSWORD=...          # item 2
pnpm provision                     # or: --dry-run, --verify-only, --apps=ledger,admin
```

It is idempotent — re-running it against a project that already exists updates
settings and env and redeploys, so it is also the tool for "change the database
string on all five".

**The token has to be an account or team token.** The one in the build
environment starts with `vcp_`, which is a *project-scoped* token: it can read
and deploy the single project it was minted for, and project creation comes
back `403 You don't have permission to create the project`. That is why the
four projects below are still empty. Mint one at
https://vercel.com/account/settings/tokens with its scope set to the owning
team, or create the five projects by hand through the dashboard (route **a**)
and then run `pnpm provision --verify-only`.

**`DATABASE_URL` cannot be copied off the offer-decoder project.** It was
written there as a `sensitive` variable, and Vercel never returns the value of
one of those — not to the dashboard, not to `vercel env pull`, not to the API,
which answers `"decrypted": false` and an empty string. Paste it again from the
Supabase connection-string page. `pnpm provision` writes it as `encrypted`
instead, which is Vercel's default and still encrypted at rest, so the next
person can read it back rather than hitting this same wall.

### Two things that may bite on the Hobby plan

**Region.** Each `vercel.json` pins a region — Mumbai (`bom1`) for the three
rupee-priced probes, US East (`iad1`) for the dollar-priced one — because
latency from India matters for the first three. If Vercel refuses the region on
your plan, delete the `regions` line. It affects speed, never correctness.

**Commercial use.** Vercel's Hobby plan is for non-commercial projects, and
these are products you intend to charge for. Free is fine while the buttons
only record purchase intent. Read their current fair-use terms before you turn
a real payment rail on, and budget for Pro if that is what it says.

After deploying, set `DATABASE_URL` (item 1) on every project and
`ADMIN_PASSWORD` (item 2) on admin, then redeploy.

**Deployed and verified:** offer-decoder is live on Supabase — a real letter
decoded end to end, six tables created on first request. `/api/health` reports
`"database": true`, but note that only means `DATABASE_URL` is set and non-empty;
it never opens a connection. Doing one real decode is what proves the string.

It was redeployed from `main` through `pnpm provision` to prove that path
works: build READY, `/api/health` still `"database": true`, homepage 200. Worth
knowing from that run — the `bom1` region in `vercel.json` was accepted, so the
Hobby-plan region warning above did not bite.

**The other four are not created yet, and it is a permissions wall, not a
to-do.** Both halves of it are described under route **c**: the token in the
environment cannot create projects, and the database string cannot be read back
off the project that has it. Give `pnpm provision` a team-scoped token and the
Supabase string and it finishes this item in one command.

**Record the URLs here when you have them:**

| App | Production URL |
| --- | --- |
| offer-decoder | https://redesigned-system-offer-decoder.vercel.app |
| ledger | |
| uptime | |
| freelancer-kit | |
| admin | |

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

**a. `RESEND_API_KEY` + `EMAIL_FROM`** — needed for advance-tax reminders on
the freelancer kit and change alerts and the weekly summary on the
uptime probe, which are built and tested but send nothing without them. When
someone enters an alert address and email is not configured, the result page
tells them plainly that nothing will be sent rather than letting them assume
they are covered. `EMAIL_FROM` must be on a domain verified with Resend, and
`APP_BASE_URL` should be set too or the status-page link inside the email is
relative and useless.

**b. `CRON_SECRET` (uptime probe and freelancer kit)** — needed for scheduled
re-checks and for the daily advance-tax reminder run. Set
it and the daily cron in `apps/uptime/vercel.json` starts refreshing every live
monitor set, which is what makes a status page you sent a client stay current.

```bash
openssl rand -base64 24
```

Without it `/api/cron/check` refuses every request, including Vercel's own —
deliberately, because that endpoint makes outbound requests to arbitrary
third-party domains and an open version of it is a request amplifier pointed at
other people's servers. Nothing else breaks; status pages just go stale.

Setting `RESEND_API_KEY` and `EMAIL_FROM` is also what lets you message the
intent list from the dashboard (item 2). Until they are set, the compose screen
previews the message and reports plainly that nothing can be sent.

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
working (`/api/cron/check`, wired to a daily cron in `apps/uptime/vercel.json`,
gated on `CRON_SECRET` — see item 7b). The Agency plan describes *hourly*, which
Vercel Hobby cannot do: it allows one cron per day.

The mechanism is written for you: `.github/workflows/scheduled-checks.yml`
pings the same endpoint on GitHub's schedule, which costs nothing. It skips
quietly until three repository secrets exist, so it is not sitting there red in
the meantime. To switch it on, add under Settings → Secrets and variables →
Actions:

| Secret | Value |
| --- | --- |
| `CRON_SECRET` | the same value you set in the Vercel projects |
| `UPTIME_URL` | the deployed uptime app, e.g. `https://uptime.vercel.app` |
| `FREELANCER_URL` | the deployed freelancer app |

Then run it once by hand (Actions → Scheduled checks → Run workflow) to confirm
a 200 before trusting the schedule. The endpoints are idempotent and both are
authenticated by the same bearer token Vercel's own cron sends, so running the
Vercel daily cron and the GitHub hourly one together is harmless.

**It runs daily, not hourly, and that is on purpose.** Every visitor is told a
free monitor set is re-checked once a day, and hourly is sold as an Agency-plan
feature the pricing page lists as not built. Running it hourly would have made
that copy false for everybody, sent twenty-four times the promised traffic to
domains belonging to other people, and quietly turned "the status page shows the
last fortnight" into fourteen hours, because `MAX_HISTORY` counts checks rather
than days.

When you do want hourly, do it in this order: change the first cron to
`7 * * * *`, raise `MAX_HISTORY` in `apps/uptime/lib/schedule.ts` so a fortnight
is still a fortnight, and only then move the hourly line out of `planned` in
`apps/uptime/lib/config.ts`. The claim goes last, after the thing is true —
`tests/pricing-claims.test.ts` will hold you to that.

**Every paid plan separates what works from what does not, and most of it now
works.** Of the six unbuilt claims the audit found, all six were built rather
than deleted, as were the per-client summary and the agency logo. What is left
in `planned` is two uptime items — a custom domain and hourly re-checks — and
neither is code: one needs DNS and a certificate per customer, the other needs a
cron tier Vercel Hobby does not offer. Both are covered in items 5 and 11.

**The original audit note, for context.** An audit
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
