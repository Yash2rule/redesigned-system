# Statement to Ledger — launch content

---

## Positioning

**Headline**
Your bank export, categorised, totalled, and in Excel — in about ten seconds.

**Sub-headline**
Upload the CSV your bank or UPI app already gives you. You get every
transaction categorised, monthly totals, a category breakdown, and a shortlist
of payments worth checking invoices against before you file GST. Nothing is
guessed silently: every category shows the keyword that produced it.

**Three benefits**

1. **Reads the format your bank already exports.** HDFC, ICICI, SBI, Axis,
   Kotak and the UPI apps all name their columns differently. We map them by
   name, not by position, and tell you exactly which column we used for what.
2. **Categories you can argue with.** Every row shows the keyword that decided
   its category. When we get one wrong you can see why in one glance, instead
   of wondering what the model was thinking.
3. **GST-ready, honestly framed.** We shortlist the payments that commonly
   carry GST so you know which invoices to chase. We do not invent an input-tax
   credit number, because a bank statement does not contain one.

**Pricing**

| Plan | Price | What it is |
| --- | --- | --- |
| First statement | Free | Complete, Excel export included. |
| One statement | ₹149 | Per statement, no subscription. |
| Monthly | ₹399/mo | Unlimited statements. |
| Yearly | ₹3,990/yr | Two months free. |

**Disclaimer**
Statement to Ledger provides bookkeeping and categorisation assistance, not
tax, accounting or legal advice. Categories are produced by keyword rules and
will sometimes be wrong; every row shows the keyword that decided it so you can
check. The GST section is a shortlist of payments worth reviewing against
invoices — it is not an input tax credit computation, and nothing here is filed
or submitted anywhere. Have a chartered accountant review anything you intend
to file.

---

## Launch post 1 — Reddit

Suggested subreddits: r/IndiaTax, r/IndiaInvestments, r/freelanceindia,
r/smallbusinessindia.

> **Title:** Built a tool that turns a bank/UPI CSV into a categorised ledger with monthly totals and an Excel export. Free for the first statement.
>
> Every quarter I lose an evening to the same job: download the statement,
> stare at four hundred rows of "UPI-SWIGGY-swiggy@ybl-PAYTM-409123456", and
> decide what each one was.
>
> So I automated it. Upload the CSV your bank already exports and you get:
>
> - Every transaction categorised across 28 categories — rent, SaaS, travel,
>   client payments, taxes, investments, and so on.
> - Monthly totals and a category breakdown.
> - A shortlist of payments in categories that commonly carry GST, so you know
>   which invoices to chase before you file.
> - A four-sheet Excel export: the full ledger, by month, by category, and the
>   GST review list with blank columns for the invoice figures.
>
> Two design decisions I'd defend:
>
> **It shows you the keyword that produced each category.** It's a rules
> engine, not a model. If it puts something in the wrong bucket you can see
> exactly why in one glance and fix it, rather than wondering what the model
> was thinking. I'd rather be auditable than clever.
>
> **It does not compute an input tax credit figure.** A bank statement shows
> what you paid, never the tax inside it. Anything claiming to compute your ITC
> from a statement alone is guessing. So it gives you the shortlist and blank
> columns, and says so plainly.
>
> It reads column names rather than positions, so column order doesn't matter,
> and it handles the two-column debit/credit layout and the single signed-amount
> layout the UPI apps use. Dates are read day-first, which it tells you,
> because reading 03/09 as March 9th would move transactions into the wrong
> quarter.
>
> It refuses PDF statements. Bank PDF layouts vary enormously and I'd rather
> refuse than silently put your numbers in the wrong columns. Every bank offers
> a CSV.
>
> First statement free, Excel included. Not taking payments yet.
>
> **What I want:** if your bank's export doesn't parse, paste me the header row
> (just the header — no amounts, nothing identifying) and I'll add it. Same for
> merchants it miscategorises.
>
> [link]

---

## Launch post 2 — WhatsApp / Telegram group

For freelancer, CA-client and small-business groups.

> If anyone here is doing the quarterly "what was this UPI payment" ritual —
> I built something for it.
>
> Upload your bank or PhonePe/GPay CSV → categorised ledger, monthly totals,
> and an Excel with four sheets including a GST review list. Ten seconds.
>
> It shows the keyword behind every category, so you can spot the wrong ones
> instead of trusting it blindly. It does NOT compute input tax credit — a
> bank statement doesn't contain the tax component, so anything claiming to is
> guessing. It gives you the list of invoices to chase.
>
> First statement free, no signup.
>
> [link]
>
> If your bank's format doesn't work, send me just the header row and I'll add
> it.

---

## Launch post 3 — Hacker News (Show HN)

HN works here because the interesting part is the parsing problem, not the
Indian tax specifics. Lead with the engineering.

> **Show HN: Statement to Ledger — parsing Indian bank exports without a model**
>
> Indian bank statement exports have no shared format. HDFC calls the columns
> Narration / Withdrawal Amt. / Deposit Amt., ICICI uses Description / Debit /
> Credit, Axis uses PARTICULARS / DR / CR, and the UPI apps export a single
> signed amount with a separate type column. Dates are day-first everywhere.
> Amounts show up as `1,23,456.78`, `(1,234.00)` and `500.00 Dr`.
>
> This maps columns by header name through synonym sets rather than by
> position, so column order doesn't matter, and it reports which column it used
> for what — a statement silently read with debit and credit swapped is worse
> than one that fails outright.
>
> Categorisation is a keyword rules engine over 28 categories, not an LLM. Three
> reasons: it costs nothing to run, it gives the same answer twice, and every
> categorisation can be explained by naming the keyword that produced it. The UI
> shows that keyword on every row. I think auditability beats accuracy here —
> a wrong category you can see and fix beats a slightly better one you can't.
>
> The GST section is deliberately not an input-tax-credit calculation. A bank
> statement shows the amount paid, never the tax component; ITC also depends on
> the supplier having filed. So it produces a shortlist of payments worth
> checking invoices against, with blank columns, and says exactly why it stops
> there.
>
> Written in TypeScript, runs on a free tier, no model calls anywhere in the
> core path. Happy to talk about the parsing edge cases — the fun ones were
> `500.00 Dr` (stripping the suffix after removing spaces leaves no word
> boundary for `\b` to match) and statement footers that look like transactions.
>
> [link]

---

## Before you post

- [ ] **Replace `hello@statementledger.in` with an address you read.**
- [ ] Run all three sample fixtures through the deployed URL first
      (`fixtures/statement-*.csv`), then one of your own real statements.
- [ ] The HN post claims "no model calls in the core path" — that is currently
      true. Keep it true, or change the post.
- [ ] For HN: post Tuesday–Thursday, roughly 8–10am US Eastern, and be in the
      thread. A Show HN with an absent author dies.
- [ ] r/IndiaTax is strict about promotion. Read the rules; consider commenting
      there for a few weeks before posting a tool.
- [ ] Do not ask anyone to send you a real statement. Header row only — say so
      every time, as the posts above do.
