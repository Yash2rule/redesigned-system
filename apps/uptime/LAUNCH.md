# Client Watch — launch content

---

## Positioning

**Headline**
Find out which client site is about to break — before the client does.

**Sub-headline**
Paste your client domains. In one pass you get whether each site is up, when
its certificate expires, when its domain expires, and which security headers
are missing. Then put it on a status page with your name on it and send your
client the link.

**Three benefits**

1. **The three things that actually break.** A site going down is loud. An
   expiring certificate and a lapsing domain are silent right up until they
   take everything offline on a Saturday. All three, one check.
2. **Your name on it, not ours.** The status page carries your agency's name
   and colour. Send the link to a client and it reads as your monitoring,
   because it is.
3. **Findings with the fix attached.** Not a red dot. Each finding says what is
   wrong, what the client sees, and the exact header or setting that fixes it —
   so a junior can action it.

**Pricing**

| Plan | Price | What it is |
| --- | --- | --- |
| Manual check | Free | Up to 8 domains, no account, the full check. |
| Studio | $29/mo | 25 monitors, branded status page, change alerts. |
| Agency | $79/mo | 150 monitors, your logo and your own domain, per-client pages, hourly re-checks. |

Daily re-checks run for every monitor set, free ones included. The paid tiers
add monitor count, hourly instead of daily, alerts, and a custom domain.

Billed in USD through Lemon Squeezy, who act as merchant of record and handle
sales tax.

**Disclaimer**
Client Watch reports what a single unauthenticated request and TLS handshake
return at the moment you run them, plus public registry data via RDAP. It is a
diagnostic, not a guarantee of uptime, security or compliance, and a passing
check is not evidence that a site is secure. Domain expiry is unavailable for
registries that do not publish it, and is shown as unknown rather than
estimated. We make one ordinary request per site and never attempt to log in or
bypass anything.

---

## Launch post 1 — Reddit

Suggested subreddits: r/webdev, r/agency, r/web_design, r/ExperiencedDevs
(and r/msp, where this problem is felt hardest).

> **Title:** Free check: uptime + SSL expiry + domain expiry for up to 8 client sites at once, no signup
>
> Two failures have burned every agency I know, and neither is the one uptime
> monitors are built for:
>
> 1. A certificate expires on a Saturday. Auto-renewal had been silently
>    failing for three months. Every visitor sees a full-page security warning.
> 2. A domain lapses because it was registered on a card that expired, under an
>    email nobody reads. The site and the client's email both stop.
>
> Both are visible weeks ahead if anyone looks. Nobody looks, because it's not
> anybody's job.
>
> So: paste up to eight client domains, no account, and get for each one —
> whether it responds and how fast, the certificate's issuer and days
> remaining, the domain's registrar and expiry from RDAP, and which security
> headers are missing. Then a status page with your agency's name and colour on
> it, and a PDF you can send a client.
>
> Some things I did deliberately:
>
> - **A 403 is not "down".** It's a server that's up and correctly refusing
>   anonymous access, which is right for a staging site. A 404 is a wrong
>   address. Reporting either as DOWN in a client report is a false alarm that
>   costs you credibility, so they're reported as what they are.
> - **Every finding carries the fix.** Not "missing HSTS" but the header to
>   add, so you can hand it to whoever's on it.
> - **Domain expiry says "unknown" when it is.** It uses RDAP, the free public
>   protocol that replaced WHOIS. Several country registries — `.in` is the one
>   Indian agencies hit — publish thin records or none. It says unknown rather
>   than guessing a date.
> - **The status page re-checks daily, not on page load.** A burst of live
>   requests to your clients' servers on every visitor would be a DoS you'd be
>   running against your own clients. It refreshes once a day on a schedule and
>   keeps the last fortnight, so the link you sent a client stays current. It
>   stops re-checking after 30 days with nobody looking.
>
> Free check is genuinely the full check, not a teaser. Not taking payments
> yet.
>
> [link]

---

## Launch post 2 — Slack / Discord / WhatsApp group

For agency-owner and freelance-dev communities. Keep it to the pain.

> Built a free thing that might save someone here a Saturday.
>
> Paste up to 8 client domains → for each one you get uptime, SSL expiry days,
> domain expiry days, and missing security headers. No signup, no card.
>
> The SSL and domain ones are the point. Nobody notices those until the
> certificate expires on a weekend or the domain lapses on a dead credit card
> and the client's email stops working too.
>
> Also gives you a status page with your agency name and colour on it — it
> re-checks itself daily so the link stays current — and a PDF you can forward
> to a client without editing.
>
> [link]
>
> Genuinely free for the manual check, and it's the full check. Would like to
> know which of your clients' TLDs it can't get expiry for — `.in` and a few
> ccTLDs don't publish it and I want to know how big that gap is.

---

## Launch post 3 — Hacker News (Show HN)

> **Show HN: Client Watch — uptime, SSL and domain expiry in one check, no paid APIs**
>
> An agency's two most embarrassing failures are an expired certificate and a
> lapsed domain. Both are visible weeks in advance and most monitoring either
> charges extra for them or skips them.
>
> All three checks here are free to run, which is the whole reason this can
> exist as a one-person product:
>
> - **Reachability**: one fetch, redirect chain tracked, timing recorded.
> - **Certificate**: a raw TLS handshake, reading `notAfter` and the SANs off
>   the peer certificate. Deliberately with `rejectUnauthorized: false` — an
>   expired or mismatched certificate is exactly what the tool exists to
>   notice, so the handshake has to complete either way and report, rather than
>   refuse to look.
> - **Domain expiry**: RDAP, the IANA-run JSON successor to WHOIS. Free,
>   public, no key. Coverage is genuinely incomplete for some ccTLDs, and it
>   reports "unknown" rather than guessing.
>
> The part I spent the most care on is SSRF protection, since the whole product
> is "a stranger gives us a hostname and we request it from our server":
> http/https only, ports 80 and 443 only, every resolved address must be
> publicly routable, and that check is re-run on each redirect hop because a
> public host can redirect to a private one. Blocks loopback, RFC1918, CGNAT,
> link-local (169.254.169.254 in particular) and the IPv4-mapped IPv6 forms of
> all of them. The tests run against real local servers with generated
> certificates — valid, near-expiry and wrong-hostname — rather than mocks.
>
> One modelling thing I got wrong first time and fixed: I treated every non-2xx
> as an outage. A 401/403 is a server that's up and correctly refusing
> anonymous access, which is right for staging. Showing that as DOWN in a
> client-facing report is a false alarm.
>
> [link]

---

## Before you post

- [ ] **Replace `hello@clientwatch.dev` with an address you read.**
- [ ] **Verify RDAP works from your deployment.** It could not be verified from
      the machine this was built on — outbound requests there go through a
      filtering proxy that returns 403 for rdap.org. The parsing is tested
      against recorded payloads, but you must confirm one live lookup before
      posting, or the domain-expiry claim is unverified. See HANDOFF.md item 9.
- [ ] Run the check against three real client domains, including one `.in`, and
      confirm the output reads sensibly to someone who is not you.
- [ ] For HN: the SSRF section is the interesting part to that audience. Expect
      to be tested on it — someone will try `http://[::ffff:127.0.0.1]/`. It is
      covered, and there is a test named after it.
- [ ] r/webdev removes most self-promotion. Check whether they have a
      showcase thread and use it.
- [ ] **Set `RESEND_API_KEY` and `EMAIL_FROM` before posting**, if you mention
      alerts. They are built and tested, but without those variables nothing is
      sent — the UI says so honestly, which is fine for a visitor and
      embarrassing in a launch post.
- [ ] **Set `CRON_SECRET` before posting.** Daily re-checks are built and the
      copy above says they happen. Without that variable the cron endpoint
      refuses every request and status pages silently go stale, which would
      make the claim false. See HANDOFF item 7a.
- [ ] Do not describe **hourly** checks as available. Vercel Hobby allows one
      cron a day; hourly needs Pro or an external pinger. The Agency plan lists
      it as what that tier adds, which is a promise about the tier, not a claim
      about today.
