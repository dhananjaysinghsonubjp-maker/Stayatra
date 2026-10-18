# StayYatra — Super Admin / Affiliate / White Label Infra Plan

Status: **planning doc, nothing in here is built yet** unless marked ✅ under "Current State".
Scope: the business/distribution layer that sits on top of the existing PMS + Channel Manager product. No hotel-facing PMS/CM behavior changes because of this doc.

---

## 1. The three dashboards (what we're building)

1. **Super Admin** (us) — sees everything: every organization/hotel, every affiliate, every white-label partner, every plan, platform-wide billing.
2. **Affiliate** — a referral partner. Shares a tracking URL; any hotel that signs up through it is theirs. Sees their own referred hotels, their recurring commission, and their own sub-affiliates (if they recruited any).
3. **White Label** — a reseller. Same console shape as Super Admin but scoped to only their own hotels, plus: attaches their own domain, sets their own brand, and sets their own pricing/plans for the hotels they sell to. We still see all of it in the backend — it's our data, just re-skinned and resold.

---

## 2. Current state — what already exists ✅

This is more than a blank slate. Found in `apps/api/prisma/schema.prisma` and `apps/api/src/platform-admin/`:

- **`Organization`** has `referredByAffiliateId` (nullable) — a tenant can already be tagged as "came in via affiliate X."
- **`Affiliate` model already exists** and already does double duty as both affiliate *and* white-label partner in one row:
  - `commissionRate` — tracking field only, **no payout math wired up yet**.
  - `brandName` / `logoUrl` / `primaryColor` — re-skins the affiliate's *own console*, not each hotel's PMS.
  - `organizations: Organization[]` — the hotels this affiliate/partner referred.
- **`AffiliateService`** (`apps/api/src/platform-admin/affiliate.service.ts`) — a working backend, scoped exactly like a mini Super Admin:
  - `login` / session (via the shared `Session` model, which already has an `affiliateId` slot)
  - `listOrganizations` — only orgs this affiliate referred
  - `setModuleEnabled`, `setSuspended` — scoped to owned orgs only (ownership checked server-side every time, never trusts a client-supplied org id)
- **Super Admin dashboard** (`apps/web/src/admin/AdminDashboard.tsx`) already has three tabs: **Orgs**, **Affiliates**, **Plans** — create affiliate, list affiliates, assign an org to an affiliate, see "White-label via X" badge on orgs.
- **`SubscriptionPlan`** / **`Subscription`** — real plan catalog + one-subscription-per-org billing state (`trialing/active/past_due/locked/cancelled`), but the actual payment gateway call is **stubbed** — no Razorpay credentials wired in yet, "buying" a plan just activates it.
- **`PlatformAdmin`** — the Super Admin account type, own login, no self-registration (ops-script-created).

### What's missing to reach the full vision
- No **Affiliate-facing frontend** at all (no `AffiliateLogin.tsx` / `AffiliateApp.tsx` — only the backend exists).
- No **sub-affiliate** hierarchy (no parent/child link between affiliates).
- No **self-service referral link/code generation** — right now "referred by" is only set by a Super Admin manually assigning an org to an affiliate after the fact.
- No **real commission calculation** — `commissionRate` is stored but nothing computes `rate × actual billed amount` or produces a payout ledger.
- No **custom domain** concept anywhere (`Hotel.shortCode` is just the PIN-login property code, unrelated).
- No **white-label-specific pricing** — every org, regardless of partner, still draws from the one shared `SubscriptionPlan` catalog.
- **Razorpay is not connected** — subscriptions activate for free; no real charge, no payout.

**Implication:** this is an extension job, not a rebuild. The schema's own comments already anticipated most of this ("not used for math yet", "tracking only for now") — whoever designed it left the door open on purpose.

---

## 3. Proposed data model changes

Additive only — nothing here breaks the existing shape.

```prisma
// Affiliate gets: self-referential hierarchy, a partner-type split, and
// self-service referral codes. Still one model — see §4 for why.
model Affiliate {
  // ...existing fields...
  parentAffiliateId String?      @map("parent_affiliate_id") // set once, never changed — see §6
  partnerType        PartnerType @default(affiliate) @map("partner_type")
  customDomain       String?     @unique @map("custom_domain") // white_label only
  domainVerifiedAt   DateTime?   @map("domain_verified_at")

  parent   Affiliate?  @relation("AffiliateHierarchy", fields: [parentAffiliateId], references: [id])
  children Affiliate[] @relation("AffiliateHierarchy")

  referralLinks AffiliateLink[]
  planOverrides AffiliatePlan[]   // white_label only — their own pricing
}

enum PartnerType {
  affiliate
  white_label
}

// A generated tracking link/code — an affiliate can have several
// (different campaigns), each independently attributable.
model AffiliateLink {
  id          String   @id @default(cuid())
  affiliateId String   @map("affiliate_id")
  code        String   @unique // short slug, e.g. "skymax-insta"
  label       String?  // affiliate's own note, "Instagram bio link" etc.
  createdAt   DateTime @default(now()) @map("created_at")

  affiliate Affiliate @relation(fields: [affiliateId], references: [id], onDelete: Cascade)
}

// White-label partner's own plan catalog — only meaningful when
// partnerType = white_label. Lets them set their own price for a given
// module bundle without touching our own SubscriptionPlan rows.
model AffiliatePlan {
  id             String  @id @default(cuid())
  affiliateId    String  @map("affiliate_id")
  basePlanId     String  @map("base_plan_id") // which of OUR plans this resells (same `modules` grant)
  name           String  // partner's own name for it, shown to their hotels
  priceMonthly   Decimal @map("price_monthly") @db.Decimal(10, 2)

  affiliate Affiliate        @relation(fields: [affiliateId], references: [id], onDelete: Cascade)
  basePlan  SubscriptionPlan @relation(fields: [basePlanId], references: [id])
}

// Append-only commission ledger — never updated in place, only appended to
// or reversed (see §5 for why).
model Commission {
  id           String           @id @default(cuid())
  affiliateId  String           @map("affiliate_id")
  organizationId String         @map("organization_id")
  subscriptionPaymentId String   @map("subscription_payment_id") @unique // idempotency key from the gateway
  amountMinor  Int              @map("amount_minor") // paise, never a float
  status       CommissionStatus @default(pending)
  createdAt    DateTime         @default(now()) @map("created_at")

  affiliate    Affiliate    @relation(fields: [affiliateId], references: [id])
  organization Organization @relation(fields: [organizationId], references: [id])
}

enum CommissionStatus {
  pending
  approved
  paid
  reversed
}
```

**Deliberately not modeled yet:** per-payout batching tables (`Payout`/`PayoutItem`) — add those once real money is actually moving through Razorpay Route, not before. Building the ledger now and the payout batching later is the right order (§5's research backs this: payouts should be *derived from* the ledger, never a separately-maintained running total).

---

## 4. Decision: keep Affiliate and White Label as one model

The schema already merged them (`Affiliate` carries both commission fields and branding fields). Recommendation: **keep it merged**, add `partnerType` as a discriminator rather than splitting into two tables.

**Why:** both are fundamentally "a party that refers organizations to us and gets paid for it" — a white-label partner *is* an affiliate with extra privileges (own domain, own pricing, console re-skin), not a different kind of entity. Splitting them would duplicate the "which orgs does this partner own" relationship and the auth/session plumbing across two tables for no real gain. `partnerType` lets the UI/API gate white-label-only features (`customDomain`, `AffiliatePlan`) cleanly.

**If you'd rather keep them conceptually separate** (e.g. because the business terms really are different enough — white-label is a resale contract, affiliate is a referral bonus), say so and this gets split into `Affiliate` + `WhiteLabelPartner` before anything is built. Cheap to change now, expensive after data exists.

---

## 5. Commission & payout design (research-informed)

No off-the-shelf source documents an actual schema for this — the design above is informed by the *mechanics* every SaaS affiliate guide agrees on:

- **Each renewal triggers a new commission**, not just the first sale. Calculate from the amount actually charged on that invoice/payment, not the plan's list price — handles upgrades/downgrades/discounts for free.
- **Idempotency**: `subscriptionPaymentId` unique constraint means a retried/replayed payment webhook can never double-pay.
- **Append-only, never mutate**: a refund or chargeback adds a `reversed`-status row or a new negative-amount row — the original row is never edited. Running totals (affiliate's "balance") are always *derived* by summing the ledger, never stored as a separately-maintained number that can drift out of sync.
- **Snapshot the commission rate at referral time**, not read live from the affiliate's current rate — otherwise changing an affiliate's % retroactively rewrites history for everyone referred earlier.

### Sub-affiliate payouts — the legal guardrail
This is the one place to be careful. Research on multi-tier referral programs is consistent: the legal line between a legitimate multi-tier affiliate structure and an illegal pyramid scheme is **what you pay for, not how many tiers exist**.

- ✅ Legitimate: a sub-affiliate's parent earns an override because *the sub-affiliate's referred hotels are paying real, recurring subscription money*. The override is a % of real revenue, always traceable to an actual hotel's actual payment.
- ❌ Illegal pyramid pattern: paying a bonus just for *recruiting* another affiliate, independent of whether that new affiliate ever produces real hotel revenue. Never do this — no "sign-up bonus" for bringing in a sub-affiliate.
- Also avoid: requiring an affiliate to pay a fee or buy something to "activate" their ability to earn — that's the other classic pyramid-scheme tell.

**Practical rule for this build:** every `Commission` row traces back to one real `subscriptionPaymentId`. A parent affiliate's override on a sub-affiliate's referral is just another `Commission` row at a lower rate, same constraint. No row is ever created for the act of recruiting someone.

---

## 6. Sub-affiliate hierarchy — engineering notes

- `parentAffiliateId` is set **once, at creation, and never changed** — don't build an "reassign parent" feature; it breaks historical commission attribution and invites gaming the tree.
- Store/compute the full ancestor chain when calculating overrides (even if you only pay 1 level up initially, the chain needs to exist so a future "pay 2 levels up" change doesn't require a data migration).
- Block circular references at creation (`parentAffiliateId` can't be a descendant of the affiliate being created) — straightforward recursive check before insert.
- Cap depth explicitly (recommend depth ≤ 2: affiliate → sub-affiliate, not deeper) until there's a real reason to go further. Deeper trees are both a support burden and move you closer to the pyramid-scheme pattern research above warns about.

---

## 7. Custom domain + white-label branding

**Scope confirmed by user:** one shared server, one shared database, one shared codebase — **everything stays ours**. A white-label partner's custom domain only changes what their hotels *see* (name, logo, colors), never where the data lives or which infra runs it. This rules out "dedicated instance per partner" entirely — it's per-request branding resolution on top of the single shared app, which is also the cheaper and easier option of the two in the table below.

This is genuinely separate infrastructure work from the dashboard UI — budget it as its own chunk, not a side-effect of "add a text field for domain."

**Two real options, both documented and production-proven:**

| | Cloudflare for SaaS | Manual (Let's Encrypt + your own reverse proxy) |
|---|---|---|
| How it works | Cloudflare issues/renews a cert per customer hostname automatically; you own one zone, customer domains get validated against it, no action needed from the customer beyond one CNAME | You run something like Caddy (auto-SSL built in) or your own ACME client in front of the Nest API |
| Setup cost | Low — it's a documented product, add a zone, call their API per custom hostname | Medium — you own the renewal, rate-limit, and failure-handling logic |
| Scale | Documented to handle thousands of custom hostnames per zone | Scales with how much ops time you want to spend |
| Recommendation | **Preferred** for a solo build — offloads the hardest part (cert lifecycle) to Cloudflare | Fallback if Cloudflare's free tier doesn't fit (dispatch-namespace-style per-tenant routing needs a paid tier) |

**Flow (same shape GoHighLevel uses for their SaaS Mode, which is the closest real-world analogue to this exact ask):**
1. White-label partner enters `app.theirbrand.com` in their dashboard.
2. We show them the CNAME target to add at their DNS provider.
3. Partner adds the record (their side, ~15–60 min propagation).
4. Our backend/Cloudflare validates the hostname and issues the cert — no manual step on our end.
5. Incoming requests get the tenant resolved **from the hostname itself** (not from a path or subdomain pattern) — this needs a small piece of middleware in the Nest app: look up `Affiliate.customDomain` matching the request's `Host` header, attach that affiliate's branding to the request context, and the **web app** needs to read that same branding on every page a hotel staff member sees (logo, name, color — not just the partner's own console), since the hotel should never see "StayYatra" anywhere.

**Confirmed: both.** White-label branding (`brandName`/`logoUrl`/`primaryColor`) re-skins the partner's own console (their Super-Admin-lite view) — that part's a day's work. But the custom domain requirement goes further: a hotel that signs up *through* the partner's domain should see the partner's brand everywhere it logs in and works — not just on the partner's own management console, but the hotel staff's day-to-day PMS/CM screens too, since the whole point is the hotel never sees "StayYatra" at all, only the partner's name. That means the Host-header → branding resolution in step 5 below has to apply **app-wide** (every page, not just login/signup), which is the real infra project — budget it as such.

---

## 8. White-label marketing website (per-partner, template-based)

**New requirement (user):** when we onboard a white-label partner, they also get their own **marketing/sales website** — the public-facing site that sells the product to hotel owners (home page, features, pricing, contact/demo-request) — not just a rebranded login to the app itself. Every partner's site shares the **same structure/layout**; only **color, theme, and content** differ per partner.

This is a third, separate surface from the other two already covered:
- the **app itself** (PMS/CM, rebranded per §7 — what hotel staff use day to day)
- the partner's **management console** (their Affiliate/White Label dashboard — what the partner uses to run their business)
- **this** — the partner's **public marketing site** (what a prospective hotel owner sees before ever signing up), which doesn't exist as a concept anywhere yet.

### Recommended approach: fixed structure, every section's content editable — not a page builder
**Confirmed by user:** the partner should be able to edit *all* the content on their site from their own panel — not just a hero headline and a few blurbs. That still doesn't mean a drag-and-drop page builder (expensive, slow, overkill for a solo build, and it would break "same structure for every partner" since builders let people rearrange things). The right shape: the **section list and their order stay fixed** in code (shared by every partner), but **every section's content is editable**, modeled as one content record per section rather than a handful of hardcoded columns — that way "edit everything" doesn't mean a schema migration every time, and doesn't risk quietly missing some field no one thought to expose.

```prisma
// One marketing site per white-label partner.
model AffiliateSite {
  affiliateId  String  @id @map("affiliate_id") // one site per partner, 1:1
  themeColor   String  @map("theme_color") // reuses Affiliate.primaryColor if already set, override allowed here
  contactEmail String? @map("contact_email")

  affiliate Affiliate              @relation(fields: [affiliateId], references: [id], onDelete: Cascade)
  sections  AffiliateSiteSection[]
}

// One row per section on the page (hero, features, testimonials, footer, ...).
// `sectionType` picks which fixed React component renders it — that's what
// keeps every partner's site the same *structure*. `content` is a JSON blob
// whose shape depends on sectionType (e.g. hero → {headline, subtext,
// imageUrl}, features → {items: [{title, body, icon}]}) — the White Label
// dashboard renders a form per sectionType, generated from that shape, so
// adding a new editable field later is a form-schema change, not a
// migration. `order` controls vertical position within the fixed section
// list (reordering within bounds, not adding/removing section types).
model AffiliateSiteSection {
  id          String  @id @default(cuid())
  affiliateSiteId String @map("affiliate_site_id")
  sectionType String  @map("section_type") // 'hero' | 'features' | 'testimonials' | 'cta' | 'footer' | ...
  order       Int
  content     Json    // shape depends on sectionType — see comment above

  affiliateSite AffiliateSite @relation(fields: [affiliateSiteId], references: [id], onDelete: Cascade)

  @@unique([affiliateSiteId, sectionType])
}
```

- **Structure is still fixed and shared** — the list of valid `sectionType`s, and which React component each one renders as, lives in code. A partner can't invent a new section or change what a "features" block looks like structurally; they can only fill in its content. This is what keeps every partner's site looking like the same product family, which was the original ask.
- **Content is fully editable, section by section** — every visible field (headline, body text, images, testimonial quotes, footer links, CTA button labels, everything) lives in the `content` JSON for its section, with no hardcoded, non-editable text anywhere on the page. The White Label dashboard builds one form per section from a small per-`sectionType` field schema (own code, not stored data) — so it's a real editor, not a raw JSON textbox.
- **Theme** reuses the same `primaryColor`/`logoUrl` already on `Affiliate` — one color, applied via a CSS variable the template reads, same mechanism §7's app-wide rebranding already needs.
- **Pricing section is the one exception, deliberately** — it still renders live from `AffiliatePlan` (§3) rather than from a content blob, so a partner changing their price in one place (their dashboard's pricing tab) updates it everywhere it's shown — the checkout flow *and* the marketing site — with no separate edit step and no risk of the marketing site quoting a stale price.

### Where it lives — ✅ confirmed by user
`domain.com` (the partner's apex/root domain) → marketing website. `app.domain.com` (subdomain) → the actual PMS/CM product. Same Host-header-based resolution middleware from §7 handles both — it checks "is this the apex domain or the `app.` subdomain" and serves the matching surface. This also sets the DNS instructions shown to the partner in step 2 of §7's flow: one CNAME (or A record) for the apex pointing at the marketing site, one CNAME for `app.` pointing at the product — both verified/certificated the same way.

### Build sequencing note
This slots in naturally **after** §7's domain/SSL infra exists (no point building a per-partner site with nowhere real to put it) and **after** `AffiliatePlan` exists (so pricing has something real to render from) — so it belongs after step 6 and alongside/after step 7 in §10's build order below.

---

## 9. Payment gateway — Razorpay

Two distinct integration needs, don't conflate them:

1. **Subscription billing** (hotel → us, or hotel → white-label partner → us): standard Razorpay Subscriptions/Orders API. Replaces the current stub in `Subscription.gatewayReference`.
2. **Affiliate/partner payouts** (us → affiliate): **Razorpay Route** is the documented product for this — built for one-to-many payment splitting. Model: each affiliate becomes a **Linked Account**; on an approved commission batch, transfer that amount to their Linked Account. Route also supports **deferred settlement** (hold a transfer before it actually settles) — useful if you want a cooling-off window before a commission payout is final (e.g. in case of refund/chargeback in the first few days).
3. Confirm with Razorpay support directly whether Route explicitly supports an "affiliate commission" use case or whether you model affiliates as generic linked vendors — the research didn't find a source that names affiliate payouts specifically, only the general marketplace split-payment pattern (closest documented analogue: a homestay marketplace automating host settlements via Route).
4. KYC: each affiliate/white-label partner being a Linked Account means **they go through Razorpay's KYC** before they can receive a payout — budget time for this in affiliate onboarding, not just a UI form.

---

## 10. Suggested build order

Given this is a solo build layered on top of an already-functioning PMS/CM product:

1. **Affiliate frontend** (`AffiliateLogin.tsx`, `AffiliateApp.tsx`) — the backend already exists; this is the fastest visible win and tests the scoping logic (`assertOwnsOrg`) actually holds up in the UI.
2. **Self-service referral links** (`AffiliateLink` model + a "Generate URL" button + the signup flow reading a `?ref=code` param and setting `referredByAffiliateId`).
3. **Real Razorpay subscription billing** — unblocks everything commission-related, since there's no real money to calculate a commission *from* until this exists.
4. **Commission ledger** (`Commission` model + webhook handler computing it off real Razorpay payment events).
5. **Sub-affiliates** (`parentAffiliateId` + override commission rows) — only after the above is solid; it's additive on top of a working single-tier system.
6. **White-label pricing** (`AffiliatePlan`) — needed before white-label partners can meaningfully resell at their own price.
7. **Custom domain** — the biggest standalone infra chunk; do this before step 8, since the marketing site needs a real domain to live on.
8. **White-label marketing website** (`AffiliateSite`, §8) — slots in right after domain infra exists and pricing (step 6) has something real to render.
9. **Razorpay Route payouts** — last, since it needs a working commission ledger (step 4) and real affiliate KYC to exist first.

This order is a recommendation, not a constraint — your earlier priority (pilot hotel + MMT/Goibibo first) still comes before step 1 starts, per our last conversation.

---

## 11. Open decisions — need your call before building

1. **Affiliate/white-label commission rate** — one flat % Super Admin sets for everyone, or configurable per affiliate / per plan?
2. **Sub-affiliate override** — does the parent's override come *out of* the sub-affiliate's commission (split), or is it an *additional* % on top that we absorb? This changes the ledger math in §5.
3. **White-label economics** — do they pay us a flat monthly fee per hotel, a revenue share of what they charge their hotels, or a flat platform license fee regardless of their pricing? This decides what `AffiliatePlan` needs to track beyond just their resale price.
4. **Keep Affiliate + White Label as one model with a `partnerType` flag (§4's recommendation), or split into two separate tables?**
5. ~~**Custom domain scope**~~ — ✅ **answered**: full scope, app-wide. Shared server/database/codebase throughout (everything stays ours); the custom domain only changes what the hotel sees — brand name, logo, colors — never where the data lives. See §7.
6. **Data isolation appetite** — current shared-schema-with-tenant-id model (cheap, what we already have) is fine for this scale; flagging only because retrofitting a different isolation model later is expensive if requirements change (e.g. a partner demanding a dedicated database for compliance reasons).
7. ~~**Marketing website scope**~~ — ✅ **answered, fully resolved**: same fixed section structure/template for *every* white-label partner, no exceptions. `domain.com` (apex) = marketing website, `app.domain.com` (subdomain) = the actual PMS/CM product. Content is fully editable by the partner from their own panel, section by section (§8's `AffiliateSiteSection` model) — not limited to a few fixed fields.

---

## Sources

- [White label multi-tenant SaaS: build & cost 2026](https://kolonell.com/en/blog/white-label-multi-tenant-saas-build-cost-2026)
- [Build a white label SaaS app with Bubble](https://www.lowcode.agency/blog/build-white-label-saas-app-with-bubble)
- [White labelling SaaS: what it is and how to launch yours](https://callin.io/white-labelling-saas-what-it-is-and-how-to-launch-yours/)
- [GoHighLevel SaaS Mode explained](https://www.webdew.com/blog/gohighlevel-saas-mode)
- [How to white-label GoHighLevel to build a scalable SaaS business](https://ghlexperts.com/agency-saas/how-to-white-label-ghl)
- [GoHighLevel white-label SaaS: complete guide](https://ecosire.com/blog/gohighlevel-white-label-saas-complete-guide)
- [Understanding recurring commissions — why SaaS affiliate programs pay more](https://getreditus.com/help/understanding-recurring-commissions-why-saas-affiliate-programs-pay-more)
- [How do SaaS affiliate commissions work: recurring vs one-time](https://getreditus.com/help/how-do-saas-affiliate-commissions-work-recurring-vs-one-time)
- [The complete guide to starting an affiliate program for your SaaS](https://www.promotekit.com/blog/complete-guide-to-starting-an-affiliate-program)
- [Razorpay Route](https://razorpay.com/route/)
- [Razorpay Route docs](https://razorpay.com/docs/payments/settlements/direct/route)
- [Case study: ExploreLife — payment splitting with Razorpay Route](https://www.casestudies.com/company/razorpay/case-study/easy-splitting-of-payments-with-razorpay-route-ensures-smooth-ride-for-explorelifetraveling)
- [Cloudflare for SaaS — custom domains](https://developers.cloudflare.com/use-cases/saas/custom-domains/)
- [Cloudflare for SaaS overview](https://developers.cloudflare.com/use-cases/saas/)
- [Multi-tier & MLM affiliate software for regulated verticals](https://track360.io/blog/mlm-multi-tier-affiliate-software-regulated-verticals-2026)
- [Is affiliate marketing a pyramid scheme — Shopify](https://www.shopify.com/uk/blog/is-affiliate-marketing-a-pyramid-scheme)
- [Referral chain — track360 glossary](https://track360.io/glossary/referral-chain)
