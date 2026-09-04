# SUMMARY.md

1. **Four paid probes are built end to end and work with an empty environment.**
   Offer Decoder (Indian CTC → real in-hand, clause red flags, side-by-side comparison), Statement to
   Ledger (bank/UPI CSV → categorised ledger + Excel), Client Watch (uptime +
   SSL + domain expiry, white-label status page that re-checks daily, USD), Freelance Desk (GST invoice +
   contract + advance-tax schedule).
2. **They share one engine**: `packages/core` (ingestion, LLM abstraction,
   PDF/Excel, Indian tax and statutory tables, PII-redacting corpus, a Store
   with Postgres and file-backed implementations), plus `ui`, `billing`,
   `analytics`, `auth`, `app-kit`.
3. **Every probe produces its complete, real result with zero credentials.**
   That was the selection criterion — a probe that stubs its core until you
   paste an API key measures curiosity, not willingness to pay.
4. **Nothing fakes payment.** With no keys the button says payments open this
   week and records email + plan + timestamp as purchase intent.
5. **Two probes now have zero unbuilt claims.** An audit found six features
   listed on pricing pages that existed only in the copy; four were built (offer
   comparison, saved client details, category corrections, financial-year
   rollup), the rest sit in a `planned` list rendered under "Not built yet", and
   a test fails the build if a claim ever drifts ahead of the product again — it
   has caught three of my own copy changes so far.
6. **`apps/admin` compares all four funnels side by side**, counting distinct
   visitors per event, with a persisted kill/keep toggle. It ranks on
   result-to-email, and says on the page why: `paid` reads zero everywhere
   until a rail exists, so it cannot rank anything.
7. **385 tests pass and all five apps build.** Verified in Chromium at 390px and
   1280px: zero console errors, no horizontal overflow, forms validate, and
   both document probes produce real results through the actual UI.
8. **Bugs found by running it rather than by reading it**, all fixed: a missing
   form field coercing to 0 (assuming variable pay never pays), "32 LPA"
   parsing as ₹32, phone numbers with an internal space escaping redaction, a
   greedy `gst` keyword, `Dr`/`Cr` suffixes parsing as null, FileStore caching
   so an API-route write was invisible to the page, and treating a 403 as an
   outage.
9. **Deliberately swapped probe 2 for probe 7** — reasoning in `DECISIONS.md`
   §3, dissent welcome and cheap to reverse.
10. **Your list is `HANDOFF.md`, twelve items — start at item 0.** The push to
   GitHub was refused (org-level app permission, read works and write does
   not), so the commits are local only until you fix that and push. Nothing is
   lost. After that: a database, an admin password, deploy. Item 9
   names two claims I could not verify from the build machine — both are in the
   uptime probe, and both are flagged in its `LAUNCH.md` checklist so you
   cannot post them by accident.
11. **What I would do next, in your position:** set `DATABASE_URL`, deploy, get
    a CA to check four invoices, then post *one* probe and wait a week. Four
    launches in one week produces four ambiguous signals, which is the one
    outcome this whole architecture exists to avoid.
