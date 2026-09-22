# Hotel Platform — Master Project Specification

**Status:** Ready for engineering kickoff — this is the one document to build from.
**Supersedes:** `DEVELOPER_SPEC.md` and `PMS_SPEC.md` are folded into this file; keep them only as historical detail if useful, this is the single source of truth going forward.
**Audience:** the engineering team starting the build.

One product, sold in three increasingly capable packages, built on one centralized database serving a website, an Android app, and an iOS app identically. Where a decision is still open, it's marked **OPEN** — don't guess, ask.

---

## 1. What we're building

A hotel operations platform for independent Indian hotels — channel manager, property management, and theft/revenue-leakage protection — sold as three packages that build on each other:

| Package | Modules | Who it's for |
|---|---|---|
| **Channel Manager** | Channel Manager only | Hotels that already run their own front desk process and just need OTA distribution |
| **CM + PMS** | Channel Manager + PMS | Hotels that want one system for both distribution and day-to-day front-desk/housekeeping operations |
| **CM + PMS + Theft Protection** | Channel Manager + PMS + Theft Protection | The above, plus room-occupancy reconciliation that catches revenue given away off the books |

Target: 5,000 hotels, unorganized/independent Indian segment, ~10–60 rooms each (revised up from an original 500-hotel target — see §7's Phase 3/4). Channel Manager alone is what gets built first; PMS and Theft Protection are a second track, built after or alongside it, not a fast-follow add-on.

**One codebase, one database, no forks.** A hotel account's `organization_modules` entries determine what it can see. Theft Protection is not sellable on its own — it depends on the PMS module's physical room-board data (§8), so it only makes sense as an add-on once PMS is already enabled; enforce that dependency in the entitlement layer, not just in sales conversations.

**Three clients, one backend:** website, Android app, iOS app. All three talk to the same API and see the same data in real time. There is no client-side business logic that isn't also enforced server-side — every client is a thin presentation layer over one source of truth.

---

## 2. Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Website   │  │ Android App │  │   iOS App   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       └────────────────┼────────────────┘
                         │  HTTPS + JSON, one API contract
                ┌────────▼────────┐
                │   Core API      │  ← auth, RBAC, validation live here,
                │   (monolith)    │    not duplicated per client
                └────────┬────────┘
          ┌──────────────┼──────────────┐
    ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼──────┐
    │ Postgres  │  │ Job queue │  │  Object     │
    │ (single   │  │ (interface│  │  storage    │
    │  source   │  │  swappable│  │  (photos,   │
    │  of truth)│  │  backend) │  │  exports)   │
    └───────────┘  └─────┬─────┘  └─────────────┘
          ┌──────────────┼──────────────┬──────────────┐
    ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
    │ OTA       │  │ Sub. bill-│  │ WhatsApp  │  │ Push      │
    │ adapters  │  │ ing only  │  │ BSP       │  │ notif.    │
    │           │  │ (Razorpay)│  │           │  │ (FCM/APNs)│
    └───────────┘  └───────────┘  └───────────┘  └───────────┘
```
Guest payments are recorded, not processed — there's no payment-gateway box on that side at all (§3).

**Why one monolith, not microservices — but one seam matters.** The core app (auth, grid CRUD, restrictions, RBAC, PMS operations) stays a monolith at a 5,000-hotel target; that volume of rows and requests is still ordinary CRUD load for Postgres, and splitting services now adds coordination overhead with no payoff. **The OTA sync job queue is the one piece to architect as a swappable component from day one.** Rough order-of-magnitude reasoning: sync jobs batch by action (one job per bulk-update call per OTA connection, not per date/cell), so per-hotel volume is maybe 50–150 queued jobs/day across all connectors. At 5,000 hotels that's on the order of 10,000–30,000+ jobs/hour at plausible peak concentration — past what a Postgres-backed queue table comfortably handles (fine to roughly "low thousands/hour"). Implement the job queue behind a small interface (enqueue/dequeue/ack) so swapping the Postgres-backed implementation for Redis/RabbitMQ/SQS later is a backend change, not a rewrite — and plan to actually make that swap in the low-to-mid hundreds of hotels, not deferred to "maybe never."

**Why API-first matters here specifically:** a server-rendered web console with mobile bolted on doesn't work once Android and iOS need the exact same data and the exact same write operations (fill a rate, apply a restriction, check a guest in) that the web client needs. Building the API as the one real product and all three UIs as clients of it means a feature ships once, not three times.

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Database | **Postgres** via **Prisma** (ORM), hosted on **AWS RDS, ap-south-1 (Mumbai)** | RDS's built-in read-replica support directly serves the Phase 4 scaling plan (§7); Prisma gives clean TypeScript + migrations. |
| Backend / API | **Node.js + TypeScript**, framework **NestJS**; API layer is **tRPC**, not REST or GraphQL | NestJS's decorator-based guards map cleanly onto `user_module_roles` permission checks. tRPC gives full end-to-end type safety between backend, web, and mobile since all three are TypeScript — resolves §4's REST-vs-GraphQL question outright. **Tradeoff, stated once:** tRPC only works cleanly with JS/TS clients — if mobile ever goes native (Swift/Kotlin) instead of React Native, this choice would need to be GraphQL or REST instead. |
| Job queue | **pg-boss** (Postgres-native) initially, behind a swappable interface; migrate to **BullMQ + Redis** when the ceiling in §2 is hit | Matches the "Postgres-backed, swappable" design already decided — pg-boss is literally built for exactly this. |
| Web client | **Vite + React** (not Next.js) | This is a logged-in dashboard with no public pages to SEO-optimize — server-side rendering buys nothing here; Vite is the simpler build and faster dev loop. |
| Object storage | **AWS S3**, same Mumbai region | Cleaning-evidence photos (§8.6), calendar/report exports. |
| PDF generation | **Puppeteer** (HTML → PDF) | For guest invoices and reports once built — reuses ordinary HTML/CSS instead of a dedicated PDF layout language. |
| Mobile — **recommended: React Native + Expo** | One codebase for Android + iOS, EAS Build for cloud builds of both (§9.1) — no local Android Studio or Mac needed | **OPEN — confirm or override.** Native (Swift/Kotlin) gives better platform feel and offline/native-API access but doubles mobile headcount for a team building two full products. Go native only if a specific requirement (deep offline-first PMS work) proves it's needed. |
| Auth | Email/password + OTP (JWT) for owners/managers; **Hotel ID + PIN** for PMS front-line staff (§8.1) | AxisRooms already proved OTP works for this market; PIN login removes the need for shared front-desk devices to do an OTP round-trip every shift change. |
| Payments (guest-facing) | **No gateway — recorded, not processed.** Staff enters amount + method (cash/card/UPI) after collecting it through their own means (hotel's own POS, personal UPI QR, etc.); `payments` (§5.2) is a manual ledger entry, not a transaction we route. | Zero PCI/payment-gateway scope for this side at all — not even the reduced burden of "buy an aggregator," since we never touch guest money in transit. |
| Payments (platform subscription) | **Razorpay** (or PayU/Cashfree) Subscriptions — this is the only place we actually process a payment, because it's us charging the hotel, not the hotel charging a guest. | See §5.4. |
| WhatsApp | WhatsApp Business API via a BSP (buy) | Commodity infra; the product value is in when/what we send. |
| Push notifications | Expo push (wraps FCM/APNs) | Needed for sync failure alerts, booking notifications, and Theft Protection alerts (§8.7). |
| Hosting | Single region, India (Mumbai) | OTA API latency + RBI data-residency expectations. |
| Credential vault | Encrypted columns (app-level AES) or a managed secrets store | Never store OTA passwords in a client-readable token — a real competitor audited during research does exactly this; don't repeat it. |

---

## 4. API design

**Decided: tRPC, not REST or GraphQL** (§3) — full end-to-end type safety between the NestJS backend, the Vite/React web client, and the React Native mobile app, since all three are TypeScript. Three heterogeneous clients with different per-screen data needs (a mobile front-desk view needs less than the web rate-grid screen) was the reasoning that would have pointed to GraphQL; tRPC solves the same over/under-fetching problem with far less boilerplate, at the cost of only working cleanly with JS/TS clients. If mobile ever moves to native Swift/Kotlin instead of React Native, revisit this in favor of GraphQL — that's the one condition under which this choice changes.

**Auth:** JWT access + refresh token for owner/manager login (with OTP); a separate PIN-based session token for PMS front-line staff (§8.1) — same underlying session mechanism, two entry paths. Every request carries the token; the server resolves `user_id → organization_id → entitled modules → role per module` on every call — never trust a client-supplied role.

**Versioning:** version from day one. tRPC's type-shared contract makes accidental breaking changes easier to catch at compile time than REST/GraphQL would, but mobile app store review cycles still mean an old app version stays in the wild for weeks after any change ships — treat backward compatibility within a release as a real constraint, not something tRPC's type safety alone guarantees away.

---

## 5. Data model

Every screen in every client reads or writes these tables — no client gets its own storage.

### 5.1 Core grid (Channel Manager)

```sql
hotels(id, name, city, short_code, gst_registration, dpdp_consent_at,
       expected_room_count, expected_staff_count)
-- short_code: a short, unique, human-typeable code minted at onboarding (§8.2) --
-- this hotel's "Hotel ID" for PMS staff PIN login (§8.1)
-- expected_room_count/expected_staff_count: drive the onboarding wizard's
-- "create N of these" steps only, not kept in sync with reality afterward

room_categories(id, hotel_id, name)
rate_plans(id, room_category_id, name, meal_plan, is_derived, base_rate_plan_id, formula)
ota_connections(id, hotel_id, ota_code, status, credential_ref)  -- credential_ref points at the vault, never inline
ota_room_mappings(id, ota_connection_id, room_category_id, ota_room_name)  -- onboarding gate

-- the core grid: every screen reads/writes this
inventory_rates(
  id, rate_plan_id, ota_connection_id, date,
  occupancy_tier,          -- 1..4
  price, extra_adult_price, child_1_price, child_2_price,
  availability,
  is_derived_value,        -- true if computed from a parent rate plan's formula
  source,                  -- 'bulk_update' | 'value_override' | 'ota_push'
  changed_by, changed_at   -- audit trail, not a separate logging system
)

-- restrictions are booleans/values, never a price of zero
-- channel_blocked (inventory-level) and rate_plan_closed (rate-plan-level) are
-- deliberately separate -- two different restriction types at two granularities
restrictions(
  id, rate_plan_id, ota_connection_id, date,
  channel_blocked, rate_plan_closed, closed_to_arrival, closed_to_departure,
  min_los, max_los, bookable_nights, policy_override_id,
  min_los_arrival, max_los_arrival, exact_los_arrival,  -- LOS rules for a specific arrival date
  min_advance_days, max_advance_days,                    -- booking lead-time restrictions
  cap, cutoff_hours, allocation_count                     -- Phase 3 features, columns exist from day one
)

gst_slab(price) -> {0%, 5%_no_itc, 18%_with_itc}   -- computed at read/write time, never stored statically
```

### 5.2 Bookings, payments & guest communication (shared by CM and PMS)

```sql
-- one booking table for the whole platform: an OTA reservation and a walk-in
-- checked in at the front desk are the same row shape -- that's the actual
-- integration point between the Channel Manager and PMS modules
bookings(
  id, hotel_id, ota_connection_id, ota_booking_ref,
  guest_name, guest_phone, room_category_id, room_id, rate_plan_id,
  check_in, check_out, nights, status, source,
  paid_amount,             -- nullable: null = "predates payment tracking", not "unpaid"
  payment_method,          -- first method recorded, headline only
  delay_resolved_at, delay_resolved_by, delay_resolved_note,
  total_amount
)

-- one row per actual payment collection -- the ledger behind paid_amount's running total
payments(
  id, booking_id, amount, method,      -- 'cash' | 'online' | 'card'
  collected_by, collected_at
)

guest_messages(
  id, hotel_id, ota_connection_id, booking_ref,
  guest_name, direction,   -- 'inbound' | 'outbound'
  channel,                 -- 'booking_com' | 'expedia' | 'airbnb' | 'mmt' | 'whatsapp'
  body, sent_at, read_at
)
```

`add_payment` (or its API equivalent) adds to `paid_amount`, refuses to collect more than the outstanding balance, requires a method, and writes a `PAYMENT_RECEIVED` audit row — it touches neither the room nor the booking status. **Collecting a balance can never check a guest out** — those are two different actions with two different permissions and must never be conflated.

### 5.3 PMS: physical rooms, housekeeping, theft protection

```sql
-- physical rooms, distinct from room_categories (the "type": Deluxe Double, etc.)
-- individual numbered rooms with live housekeeping status are a PMS-specific
-- concept the Channel Manager schema never needed on its own
rooms(
  id, hotel_id, room_category_id, room_number,
  status,              -- 'available' | 'occupied' | 'housekeeping'
  current_stay_id,     -- FK to bookings, null unless occupied by an active stay
  status_changed_at,
  active               -- soft-delete
)

cleaning_records(
  id, hotel_id, room_id, stay_id,
  kind,                -- 'checkout' | 'guest_stay'
  primary_housekeeper_id, second_housekeeper_id,
  photos,              -- jsonb array of storage paths
  flagged,             -- true if submitted with no active stay -- a discrepancy
  resolved_at, resolved_by, resolved_note
)

-- central, typed activity log spanning both CM and PMS actions -- richer than
-- inventory_rates' own source/changed_by columns, which stay as-is for that
-- one table; this is the cross-module feed an owner actually reads
audit_log(
  id, hotel_id, event_type,   -- CHECK_IN | PAYMENT_RECEIVED | CLEANING_SUBMITTED |
                                -- CLEANING_FLAGGED | DISCREPANCY_RESOLVED |
                                -- STAY_EDITED | ROOM_CHANGED | GUEST_CLEANING |
                                -- MANUAL_BLOCK | UNRECORDED_OCCUPANCY_FLAGGED
  actor_id, subject_id, detail, created_at
)

sessions, login_attempts   -- token store; login_attempts keyed on (device_id, hotel_short_code) for PMS PIN lockouts
```

### 5.4 Platform subscription & billing (us collecting from the hotel owner)

Distinct from guest payments in §5.2 — this is the hotel paying **us**, not a guest paying the hotel. Billing is web-only; mobile apps never take a card/UPI detail directly (§9).

```sql
billing_settings(key, value)          -- admin-editable: trial_days=7, grace_period_days=3, etc.

subscription_plans(id, name, tier, price, billing_cycle, gst_rate)   -- 'monthly' | 'quarterly' | 'annual'

subscriptions(
  id, organization_id, plan_id,
  status,                          -- 'trialing' | 'active' | 'past_due' | 'locked' | 'cancelled'
  trial_ends_at,                   -- set at signup: now() + billing_settings.trial_days
  current_period_start, current_period_end,
  gateway_subscription_ref         -- the recurring-billing object at Razorpay/PayU, not built in-house
)

platform_invoices(
  id, organization_id, subscription_id, period,
  amount, gst_amount, status,       -- 'paid' | 'unpaid' | 'overdue'
  invoice_pdf_url
)
```

**Trial: 7 days, then every feature is gated on payment — enforced in the API, not per-client.** Every hotel starts `trialing` with full access. Once `trial_ends_at` passes with no active paid subscription, the API rejects any write with `HTTP 402 Payment Required`. All three clients treat 402 identically: show a **Subscribe to continue** prompt, deep-link to the web billing page. This is the reason it belongs in the API and not each client — "ask for payment on any feature" only stays consistent across web/Android/iOS if exactly one place decides it.

**Renewal flow:** `active` → payment fails or period ends → `past_due` (grace period, `billing_settings.grace_period_days`, default 3, full access continues) → grace elapses → `locked` (same 402 gate) → payment clears → `active`. Every client shows a **Renew Subscription** banner throughout `past_due`, reading the same field, so there's no per-client logic to keep in sync. **Web is the only place a subscription changes state — mobile clients must re-check status on app foreground/resume**, not wait for the next unrelated API call, so a payment made on web is reflected the moment the owner switches back to the app.

**Recurring billing is bought, not built.** `gateway_subscription_ref` points at Razorpay/PayU's own recurring-billing object; building a charge-on-schedule/dunning system from scratch reinvents a solved, compliance-sensitive problem. **We issue GST invoices too** — `platform_invoices` reuses the GST-slab logic from §5.1, not a second implementation of it.

**App Store / Play Store:** Apple's guideline **3.1.3(b) "Multiplatform Services"** is the durable basis for the redirect-to-web pattern — an app that's a client for a subscription purchased elsewhere, never offering IAP for the same thing, doesn't need IAP at all. Its text carries no regional restriction and wasn't touched by the 2025 Epic v. Apple update (which specifically modified the US-storefront external-link rules, a separate and complementary allowance). Google Play doesn't require Play Billing or prohibit linking to external payment for this kind of app, with no regional caveat. A final legal sanity check on India-storefront treatment before submission is good practice, not a blocker.

### 5.5 Affiliate / partner program

```sql
organizations(id, name, plan_tier, referred_by_affiliate_id)
organization_modules(organization_id, module, enabled)   -- 'channel_manager' | 'pms' | 'theft_protection'
users(id, organization_id, name, email)
user_module_roles(user_id, module, role)                 -- staff-level role, scoped to modules the org has enabled

commission_rate_defaults(tier, commission_type, rate)     -- admin-editable, Admin Panel > Commission Settings

affiliates(
  id, user_id, tier,                                          -- 'referral' | 'reseller' | 'white_label'
  status, applied_at, approved_at, approved_by,                -- approval-gated, no self-service
  commission_type, commission_rate,                             -- pre-filled from defaults, editable per affiliate
  referral_code, subdomain_slug,                                -- subdomain_slug only for white_label
  logo_url, primary_color                                       -- the whole "theme" -- one partner, one look
)

affiliate_commissions(
  id, affiliate_id, organization_id, period,
  gross_amount, commission_amount, tds_amount,
  status                                                        -- 'pending' | 'paid'
)
```

**Design decisions baked into this schema — don't relitigate:**
- **`source` on `inventory_rates`** stops Bulk Update from silently overwriting a Value Override — a bulk write skips any cell whose most recent write was `value_override` and still inside its date range, unless explicitly told to override.
- **`is_derived_value` + `rate_plans.formula`** is the entirety of derived/BAR pricing. Compute at read time first; a materialization job is real Phase 2/3 work given the 5,000-hotel target, not indefinitely deferred.
- **Increase/decrease bulk pricing and weekday/weekend multipliers need no schema change** — both are write-time computations that write ordinary rows with `source='bulk_update'`.
- **`organization_modules` enforces the tier dependency**: Theft Protection can only be `enabled` if `pms` is also `enabled` for that organization — enforce this as a constraint or application-level check, not just a sales rule.
- **The product looks identical to every hotel owner regardless of acquisition channel.** White-Label swaps `logo_url`/`primary_color` on a subdomain over the identical product underneath — a skin, not a fork.

---

## 6. Unified Ledger Dashboard

One screen answering "where does our money actually go," built entirely from tables that already exist above — no new accounting engine, no double-entry bookkeeping.

**What it combines, per hotel (and rolled up across all hotels for a reseller/white-label partner's console, §5.5):**
- **Guest revenue** — from `bookings.total_amount` / `payments`, regardless of whether the booking came from an OTA or was walk-in via PMS. Same table, same query, one number.
- **OTA commission vs. net** — per channel, from `bookings` joined against each `ota_connections`' known commission rate (the "channel economics" fields already planned — store commission %/cancellation rate per channel even before this screen reads them).
- **What we charged the hotel** — from `platform_invoices` (§5.4): subscription cost, GST on it.
- **Affiliate payouts**, if the hotel came through a Reseller/White-Label partner — from `affiliate_commissions` (§5.5), shown from the partner's side of the console, not the hotel owner's.

**Design rule: this is a read, not a write path.** The ledger dashboard never becomes a place someone enters or adjusts a transaction — every number on it traces back to a row already written by `check_in`, `add_payment`, an OTA sync, or the billing system. If a number looks wrong, the fix is in the table that produced it, not an edit on the ledger screen itself. Keeping it strictly a rollup avoids building a second source of truth that can drift from the first.

**GST/TDS awareness carries through.** Guest revenue is GST-sliced per §5.1; OTA payouts are net of e-commerce TDS (Section 194-O, 0.1%) and commission TDS (Section 393(1), 2%, code 1006); affiliate commissions carry the same TDS obligation. The dashboard surfaces these as already-computed figures from their source tables — it doesn't recompute tax logic a second time.

---

## 7. Feature specification, by phase (Channel Manager)

### Phase 1 — MVP (build this first, ~16 weeks)

1. **Core grid** — room category × rate plan × occupancy tier (1–4) + extra adult + up to 2 children × OTA × date → price + availability.
2. **Bulk Update** — date range + day-of-week mask, plus increase/decrease by %/fixed amount, plus weekday/weekend multipliers.
3. **Value Override** — one-time rate float, a genuinely separate write path (§5.5's `source` design).
4. **Restrictions, full set** — Block Channel, Close/Open Rate Plan, MLOS, Closed to Arrival, Closed to Departure, Bookable Nights, Policy Override, min/max advance booking.
5. **Reservations view** — list + calendar of bookings pulled from every connected channel, plus one-time historical import.
6. **Room/rate mapping onboarding wizard** — the single highest-effort, most important screen in the whole product (§10, usability).
7. **OTA connectors, direct:** MMT+Goibibo (one connector), Agoda, Cleartrip.
8. **OTA connectors, via bought aggregator:** Booking.com, Expedia, Airbnb.
9. **Full Sync** per channel — manual re-push escape hatch.
10. **Sync failure alerts** — push notification when an OTA push exhausts retries.
11. **Instant booking/cancellation notification** — push notification on any new/cancelled booking from any channel.
12. **GST-live pricing** — computed from actual sale price at write time.
13. **OTA credential vault** — encrypted at rest, real access control.
14. **Guest payment recording** — the running-total-plus-ledger model (§5.2) for any guest payment regardless of tier: staff records amount, method, and who collected it after the fact. No payment gateway integration on the guest-facing side at all (see §3) — that's reserved for platform subscription billing only (§5.4).
15. **Calendar export** (CSV/Excel).
16. **Platform subscription billing** (§5.4) — needed before General Availability even if the pilot cohort is invoiced manually first.

### Phase 2 (~100–300 hotels)

- Derived/BAR pricing (needs its own guided onboarding moment, not a menu item — §10).
- TDS/TCS reconciliation view.
- Unified guest inbox — Booking.com/Expedia/Airbnb confirmed via documented messaging APIs; MMT/Goibibo **OPEN** pending their partner API team's confirmation. WhatsApp folded into the same inbox.
- Two-tier RBAC (owner/staff), later generalized into the full `user_module_roles` model once PMS exists.
- Basic reporting, plus commission vs. hotel net by channel (proven real via a third competitor audit, not speculative).
- Audit logs screen — a read over `audit_log`, nearly free given §5.3's design.

### Phase 3 (~300–1,000 hotels)

- Capping, Cut-off, Allocation (inventory-control dimensions).
- OTA promotion push (native campaign types per channel).
- Reseller/multi-property shell + cross-property bulk pricing ("Cluster").
- DPDP compliance formalized — **hard external deadline ~May 2027, independent of hotel count.**
- Rate parity monitoring (buy a data feed) and metasearch/Google Hotel Ads feed (check if the aggregator vendor already supports it).
- Job queue backend swap (§2) and derived-pricing materialization job — both ceilings sit inside this phase at a 5,000-hotel target, not near the end of it.

### Phase 4 (~1,000–5,000 hotels)

- Read replicas for reporting/analytics queries.
- Revisit single-region hosting if latency/DR needs appear.
- Mostly GTM/support-capacity scaling, not new product features — the risk here is support cost outpacing hotel count, not a missing feature.

---

## 8. PMS module

Everything in this section is `hotel_id`-scoped and reads/writes through the same API and database as §5–7 — this is the PMS module of one product, not a separate system.

### 8.1 Roles and auth

| Role | Scope |
|---|---|
| **Front Desk** | Check guests in, take payments, see the room board, view active guests |
| **Housekeeping** | Room board (status only), submit cleanings with photo evidence, personal cleaning history |
| **Owner / Manager** | Everything above, plus reports, discrepancy/theft-alert resolution, staff/room admin, editing bookings |

**Data redaction, not just access denial.** Housekeeping's reads return the same rows Front Desk and Owner see, with guest name, phone, booking source, amount, and any resolution note blanked server-side — one query path serves every role correctly instead of three near-duplicate ones.

**Auth: Hotel ID + PIN for shared devices, alongside JWT+OTP.** Front Desk and Housekeeping log in with two fields: `hotels.short_code` (the "Hotel ID," a short human-typeable code — shown to the owner at onboarding, §8.2 — separate from the internal UUID) and a PIN. No device-pairing step at all: any device can log into any hotel it's told the Hotel ID for, and the same shared tablet works unmodified if a staff member's shift moves them between properties in a small chain. PIN only needs to be unique **within** a hotel once `short_code` resolves it — two different hotels can both have a "1234". Lockout tracks `(device_id, short_code)` pairs; no self-service unlock, same as elsewhere in this spec — clearing one is an admin/support action.

### 8.2 Onboarding flow

Owner-driven — the owner creates every staff account themselves; staff never self-register. Captured in this order:

1. **Hotel Name** — mints `hotels.short_code` here, shown to the owner immediately with a nudge to write it down or print it for staff.
2. **Number of Rooms** — generates that many placeholder `rooms` rows (Room 1…N), which the owner renames and sorts into categories. Starting from N pre-created rows to edit is materially easier than starting from zero — the same friction-reduction principle already applied to the Channel Manager's room/rate mapping wizard.
3. **Staff count** (e.g. 4) — immediately followed by creating that many staff accounts inline: name, role, PIN, for each. This is the moment PIN accounts get created, not a separate admin screen discovered later.

After this, hand off to the Channel Manager's own onboarding (room categories, OTA mapping — §7 Phase 1). A Pro-tier hotel goes through both as one combined wizard, not two flows the owner has to realize are related.

### 8.3 Check-in

- Room picker shows physical rooms (not categories) with live status; occupied rooms aren't selectable.
- Validation: guest name required, phone exactly 10 digits or blank, nights ≥ 1.
- **Idempotency, concretely:** disable submit while in flight (blocks a double-tap landing before re-render, which can otherwise check a guest in twice or read back "room not available" for a guest who *was* just checked in). If the request errors client-side, check whether this exact check-in already succeeded (same guest, same receptionist, within the last few minutes) before reporting failure — covers a lost reply without creating a duplicate. This generalizes directly to the Channel Manager's own OTA push/retry logic (§2) — same underlying problem, same fix: check state before retrying, don't assume failure means nothing happened.

### 8.4 Manual booking entry (reception-only, not public)

Not a public booking engine — no guest-facing website, no SEO, no self-service checkout page. This is Front Desk creating a **future-dated reservation** on behalf of someone who called in, walked in to book ahead, or came through a channel with no OTA presence (a local travel agent, a referral) — distinct from Check-in (§8.3), which is for a guest standing at the desk right now.

- Same `bookings` table, `source = 'direct'`, `status = 'confirmed'` rather than `'checked_in'` — no room occupied yet, no `current_stay_id` set on the room. The guest checks in normally through §8.3 when they actually arrive, at which point the existing reservation is what gets checked into a room, not a new booking created from scratch.
- Same payment model as everywhere else (§5.2) — Front Desk can record a deposit or full payment taken over the phone or in person the same way `add_payment` works for any other booking; no separate payment-collection UI needed.
- Same restriction/availability rules apply as any other channel — a direct booking against a stop-sold or fully-booked date range is rejected the same way an OTA push would be, just surfaced synchronously in the UI instead of failing an API call to a third party.
- Counts in the Reservations view and Rooms Report (§8.8) exactly like any OTA or walk-in booking — "source: Direct" is just another value next to "source: Booking.com," not a separate list to check.

### 8.5 Payments

Modeled in two places on purpose (§5.2): `bookings.paid_amount` (nullable running total) and `payments` (one row per collection). `add_payment` never alters room or booking status — collecting a balance can never check a guest out. Surface "Due" everywhere it'd matter (room-board badge, guest-card ribbon, payment screen); at zero it reads "Paid in full," not "Due ₹0."

### 8.6 Cleaning and photo evidence

- Mint a cleaning id, upload photos **sequentially** (not `Promise.all` — parallel uploads spiked peak memory and OOM-crashed real mid-range Android phones mid-submit, silently losing the cleaning), then submit.
- Storage: insert-only, no update/delete — evidence is write-once, which is what makes the audit trail trustworthy.
- If the submit reply is lost, check whether that cleaning id already has a record before retrying — a blind retry mints a new id and, with the room already freed, gets recorded as a bogus discrepancy.
- Camera only, no gallery. Refusing permission shows a prompt to enable it, never a placeholder-tile fallback that could be submitted as "verified" with no real photos.
- Minimum photo count (start at 3) is enforced server-side in the submit handler, not just a disabled button.

**Guest Cleaning vs. Checkout Cleaning:** Checkout Cleaning closes the stay and frees the room. Guest Cleaning (offered only when the stay is active and length-of-stay meets a minimum, start at 2 nights — **re-checked server-side**, not just hidden in the UI) records a mid-stay clean without closing anything. Every query pairing a stay with "its" cleaning must exclude `kind = 'guest_stay'` records, or an in-house guest reads as checked out.

### 8.7 Delay, discrepancies, and theft protection

- **No-guest discrepancy** — a cleaning submitted against a room with no active stay. Flagged on `cleaning_records`, resolved by an owner with a note.
- **Delayed** — derived state (a room past its cleaning deadline: checkout hour + grace window on the departure day, floored at check-in + grace so a late check-in can't land past its own deadline immediately). Resolving it writes `delay_resolved_*` onto the booking; owner-only, note hidden from housekeeping.
- **Theft protection — room-occupancy reconciliation.** The problem this exists for: a manager hands a walk-in guest a room key, collects cash, and never creates a `bookings` row. The no-guest discrepancy above catches this, but only when housekeeping happens to clean the room — sometimes a day or more later. Elevate this into a named, owner-facing feature by closing the gap three ways:
  1. **Detect faster than "next cleaning."** A periodic reconciliation job (or a check on every room-status read) asks: is every `rooms.status = 'occupied'` row backed by an active booking via `current_stay_id`? Flag the moment a mismatch exists, not the next time someone cleans it.
  2. **Close the loophole at the API level, not just detect it after the fact.** `rooms.status` is never a bare field a client can PATCH directly. The only paths to `occupied` are `check_in` (creates a `bookings` row in the same transaction) or an explicit **Manual Block** with a required reason code (staff room, maintenance, comp) and who authorized it, written to `audit_log`. If every path either creates a booking or requires a logged reason, giving away a room with no record stops being something the UI casually allows.
  3. **A dedicated alert**, not buried in routine housekeeping noise — its own owner-facing view (e.g. "Revenue Protection"), with an instant push notification the moment one fires, reusing the notification infrastructure already built for booking alerts.

  This is why Theft Protection is a PMS-dependent module (§1, §5.5): it needs the physical `rooms` table and live room-board status that only PMS has.

### 8.8 Reports

- **Rooms Report** (date range) — check-ins, cleanings, guest cleanings, automatic checkouts, delays, discrepancies, collections by method, daily breakdown, per-room rows, CSV export.
- **Sale Report** (monthly ledger) — total sale split by Cash/Online/Card/Due, one line per day expanding to room-wise bookings.
- **Revenue counts per booking, on its check-in day — never per night.** A stay spanning a month boundary is counted once, so monthly totals always sum to exactly what was billed.

### 8.9 What not to carry over from the PMS reference

The source for this module was a single-property internal tool; these choices were right there and wrong here: no multi-tenancy (every table here needs `hotel_id`/`organization_id` scoping the source didn't), Supabase-specific mechanics (RLS policies, `SECURITY DEFINER` RPCs — the *principles* transfer, deny-by-default and redact-not-deny, but our stack is Postgres + a custom API, §2–3), iOS PWA-only with no App Store build, no automated tests, debug-keystore signing with a fixed `versionCode`, and unmanaged photo retention (plan a lifecycle policy from the start instead).

---

## 9. Mobile-specific requirements

### 9.1 Build & deployment

**EAS Build** (Expo's cloud build service) for both platforms — the whole point of the React Native + Expo choice (§3) is not needing local Android Studio or a local Mac to produce either build.

- **Android:** `eas build --platform android` produces an **AAB (Android App Bundle)** for Play Store submission — Google's required format since 2021, not a raw APK. EAS can also output a plain APK for internal testing/sideloading. EAS manages a real release keystore and increments `versionCode` per build — this is the deliberate opposite of the debug-keystore, fixed-`versionCode` shortcut flagged as "don't carry over" in §8.9; that was fine for a LAN-only internal tool, wrong for a public Play Store app.
- **iOS:** `eas build --platform ios` also builds in the cloud — no local Mac required. Needs an **Apple Developer Program account** ($99/year); the PMS reference this spec draws from avoided that cost by shipping iOS as a PWA only (§8.9), which we've already decided against since push notifications and real App Store presence matter here. EAS manages provisioning profiles/certificates (`eas credentials`); `eas submit` uploads to App Store Connect. Use TestFlight for beta distribution before the public release.
- **`expo-updates`** gives over-the-air JS updates for bug fixes without a full store review cycle. Native-level changes (new permissions, native modules) still need a real build and a full review — OTA updates don't bypass that.
- **Costs to budget:** Apple Developer Program $99/yr, Google Play Console $25 one-time.

### 9.2 Runtime requirements

- **Offline tolerance for front-desk operations.** Room board, check-in/out, and housekeeping run on-property where wifi is unreliable. **OPEN — decide how much needs to work offline-first (queue writes, sync on reconnect) versus degrading gracefully with a clear "offline" state** before PMS mobile screens are built; retrofitting later is expensive.
- **Push notifications are not optional** — sync failure alerts, booking notifications, and Theft Protection alerts (§8.7) are the reason the mobile apps exist as more than a smaller web view.
- **App store review constraints:** mobile apps never collect a card/UPI detail or process a charge. When a subscription lapses or a trial expires (402, §5.4), the app opens the web billing page in the system browser and stops — never an embedded payment form. See §5.4 for the Apple/Google policy basis.
- **Feature parity is not required at launch.** The rate grid and derived pricing are reasonably web-first; front desk, room board, and notifications are the natural mobile-first ones.

---

## 10. Usability requirements — not optional polish

- **The primary CM screen is the grid + Value Override + Reservations view.** If an owner can run their hotel from just those three, the UI has succeeded.
- **Room/rate mapping is the hardest step in the entire product** (highest importance, worst usability). Guided wizard with inline "click here to fix" links, not a bare form.
- **Restrictions ship in two visual tiers.** Block Channel is the default, prominent toggle. MLOS/CTA/CTD sit one level down with plain-language labels. Everything niche (Bookable Nights, Policy Override, arrival-conditioned LOS, Capping, Cut-off, Allocation) lives behind an "Advanced" panel indefinitely.
- **Derived/BAR pricing gets a guided onboarding moment**, not a menu item — "want this rate plan to follow your main rate automatically?" the first time a second rate plan is added.
- **GST, DPDP, TDS, and OTA-connector complexity are invisible to the owner by design.** They should never see tax logic or API retry behavior — only correct numbers and a "connected" toggle.
- **The product looks identical regardless of acquisition channel** (§5.5) — White-Label only re-skins logo/color/subdomain.

---

## 11. Security & compliance requirements

- **DPDP Act, 2023** — every hotel account is a Data Fiduciary; breach penalties run to ₹250 crore. Encrypted credential vault, consent capture at onboarding, documented breach-notification runbook — Phase-1-adjacent even though full formalization is Phase 3 (hard deadline ~May 2027).
- **GST** — 0% under ₹1,000, 5% (no ITC) ₹1,000–7,499, 18% (with ITC) ₹7,500+, computed off the actual sale price at write time. Get this verified by a CA before it ships with real money.
- **TDS/TCS** — OTA payouts net of 0.1% e-commerce TDS (Section 194-O) and 2% commission TDS (Section 393(1), code 1006); TCS past ₹50L/OTA/year. Model this in Phase 2's reconciliation view and the Unified Ledger Dashboard (§6).
- **Credential vault anti-pattern to avoid:** a competitor audited during research embeds an encrypted copy of the account password inside its own session JWT. Never do this.
- **Payments:** the only payment we actually process is platform subscription billing (§5.4), routed through a licensed aggregator (Razorpay) so RBI's payment-data-localization mandate is their compliance surface, not ours. Guest-facing payments are recorded, not processed (§3) — no card/UPI data ever transits our system on that side, so there's no gateway compliance surface to own there at all.

---

## 12. Domain glossary

| Term | Meaning |
|---|---|
| **BAR** | Best Available Rate — the master rate plan other rate plans derive from by formula. |
| **MLOS** | Minimum Length of Stay. |
| **CTA / CTD** | Closed to Arrival / Closed to Departure. |
| **Stop sell** | Blocking a room/rate plan from being sold for given dates. |
| **Rate parity** | Keeping the same price for the same room across all channels. |
| **Derived rate plan** | A rate plan computed as a formula off a parent/BAR rate plan. |
| **Channel / OTA** | An online travel agency — a "channel" in channel manager. |
| **Allocation** | A fixed block of rooms reserved for one channel, distinct from a shared pool. |
| **Cut-off** | A lead-time window before which a room can no longer be booked on a channel. |
| **Full Sync** | A manual, complete re-push of rates/inventory to a channel. |
| **No-guest discrepancy** | A cleaning submitted with no active stay — the raw signal behind Theft Protection. |
| **Unrecorded occupancy** | A room marked occupied with no active booking — the thing Theft Protection exists to catch. |

---

## 13. Open decisions — resolve before or during Phase 1, don't guess

1. **Mobile: React Native + Expo.** Settled in practice — §3 and §9.1's build/deployment plan are both written against it. Revisit only if a specific requirement (deep offline-first PMS work) proves native is actually needed; that would also reopen decision #2 below.
2. ~~API style: REST vs. GraphQL~~ — **resolved:** tRPC (§4), conditional on staying on React Native for mobile (#1).
3. **Offline behavior for PMS mobile screens** (§9.2).
4. **MMT/Goibibo messaging API access** — needs direct confirmation from MMT's partner team before Phase 2's unified inbox can promise that channel.
5. **Whether Reseller/White-Label-managed hotels count toward the 5,000-hotel target** or track separately.
6. **`billing_settings.grace_period_days` default** — 3 days is a placeholder; confirm or leave admin-tunable with no fixed opinion.
7. **Testing strategy** — never written past the original build plan's short list (GST slab boundaries, override precedence, adapter idempotency). Needs a real section before Phase 1 code review starts, not just those three examples.
8. **CI/CD and environments** — staging vs. production, deployment process, how a mobile release goes out without breaking older app versions still in the wild (§4's versioning note depends on this existing).
9. **Backup / disaster recovery policy** — not addressed anywhere; needed before any hotel's real booking and payment data is live.
10. **Language/localization plan** — the target user is explicitly non-technical and Hindi/regional-language matters more here than in most B2B SaaS (§10); currently every screen described in this spec assumes English-only.

---

*This is the single build spec. `DEVELOPER_SPEC.md` and `PMS_SPEC.md` remain on disk with the same detail folded in here — treat this file as current, those as history.*
