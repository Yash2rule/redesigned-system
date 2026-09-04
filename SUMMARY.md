# SUMMARY.md

1. **Four paid probes are built end to end and work with an empty environment.**
   Offer Decoder (Indian CTC → real in-hand, clause red flags, side-by-side comparison), Statement to
   Ledger (bank/UPI CSV → categorised ledger + Excel), Client Watch (uptime +
   SSL + domain expiry, white-label status page that re-checks daily, USD), Freelance Desk (GST invoice +
   contract + advance-tax schedule, with due-date reminders and a financial-year
   invoice register).
2. **They share one engine**: `packages/core` (ingestion, LLM abstraction,
   PDF/Excel, Indian tax and statutory tables, PII-redacting corpus, a Store
   with Postgres and file-backed implementations), plus `ui`, `billing`,
   `analytics`, `auth`, `app-kit`.
3. **Every probe produces its complete, real result with zero credentials.**
   That was the selection criterion — a probe that stubs its core until you
   paste an API key measures curiosity, not willingness to pay.
4. **Nothing fakes payment.** With no keys the button says payments open this
   week and records email + plan + timestamp as purchase intent.
5. **Three of the four probes have zero unbuilt claims.** An audit found six
   pricing-page features that existed only in the copy. Rather than delete the
   claims, they were built: the offer comparison, saved client details, category
   corrections you can teach it once, the ledger's financial-year rollup, change
   alerts, the weekly summary, advance-tax reminders, and the invoice register.
   What remains in `planned` — rendered under "Not built yet" — is two uptime
   items that are deployment concerns, a custom domain and hourly crons, not
   missing code. `tests/pricing-claims.test.ts` fails the build if a claim ever
   drifts ahead of the product; it has caught five of my own copy changes.
6. **`apps/admin` compares all four funnels side by side**, counting distinct
   visitors per event, with a persisted kill/keep toggle. It ranks on
   result-to-email, and says on the page why: `paid` reads zero everywhere
   until a rail exists, so it cannot rank anything.
7. **417 tests pass and all five apps build**, on GitHub Actions as well as
   locally — CI runs typecheck, test and build on every push and is green.
   Verified in Chromium at 390px and 1280px: zero console errors, no horizontal
   overflow, forms validate, and both document probes produce real results
   through the actual UI.
8. **Bugs found by running it rather than by reading it**, all fixed: a missing
   form field coercing to 0 (assuming variable pay never pays), "32 LPA"
   parsing as ₹32, phone numbers with an internal space escaping redaction, a
   greedy `gst` keyword, `Dr`/`Cr` suffixes parsing as null, FileStore caching
   so an API-route write was invisible to the page, and treating a 403 as an
   outage. A security pass then found two more, both fixed with tests: the
   uptime checks re-resolved a hostname after vetting it (DNS rebinding walked
   straight past the SSRF guard), and the admin CSV export handed Excel a
   formula written by an anonymous stranger.
9. **Deliberately swapped probe 2 for probe 7** — reasoning in `DECISIONS.md`
   §3, dissent welcome and cheap to reverse.
10. **Your list is `HANDOFF.md`, twelve items — start at item 1.** Item 0 is
   done: all 34 commits are pushed to
   `claude/validation-probes-overnight-uok5hp`, no pull request opened because
   you did not ask for one. What is left is a database, an admin password and a
   deploy. Item 9 names two claims I could not verify from the build machine —
   both are in the uptime probe, and both are flagged in its `LAUNCH.md`
   checklist so you cannot post them by accident.
11. **What I would do next, in your position:** set `DATABASE_URL`, deploy, get
    a CA to check four invoices, then post *one* probe and wait a week. Four
    launches in one week produces four ambiguous signals, which is the one
    outcome this whole architecture exists to avoid.
