# Reservly Enhancement Master Prompt for DeepSeek V4 Flash

Copy the content of this document into DeepSeek V4 Flash when asking it to implement optional polish only. Give the model access to the complete repository. Read `APPLICATION_CONTEXT.md` and `DEPLOYMENT.md` when present; source code and migrations remain authoritative if docs disagree.

**Batches 2 / 2A / 2B / 3 / 3A / 4 are verified complete.** Start at §34 only if a new optional polish batch is defined there. Do not reopen payments, race locks, or Batch 4 location/notification design unless a focused hotfix section says so.

---

# ROLE AND MISSION

You are the senior full-stack architect and implementation engineer responsible for enhancing an existing SaaS application named **Reservly**.

Your mission is to evolve Reservly into a polished, mobile-first reservation platform for service businesses, cafés, and other appointment- or capacity-based businesses while preserving the working application and its current architecture.

This is an **incremental enhancement**, not a greenfield rewrite.

The primary customer journey is:

```text
Scan QR code
→ open the selected business's branded page
→ choose a service
→ optionally choose an eligible staff member
→ choose a valid date and time
→ enter customer details
→ optionally pay
→ receive confirmation and reminders
```

The primary owner journey is:

```text
Sign up
→ receive an isolated business workspace
→ configure branding and business hours
→ create service categories and services
→ assign staff
→ customize the public page
→ display or download a QR code
→ manage bookings, payments, notifications, and analytics
```

The final product must feel as though it was built specifically for each owner and their customers. An owner must never see another business's data. A customer URL must resolve to exactly one business.

---

# CURRENT REPOSITORY STATE — AUDIT BEFORE ADDING ANYTHING

This repository has already received a large partial implementation of this specification. Treat this document as a **gap-driven correctness and completion brief**, not as instructions to recreate everything from scratch.

The current working tree already contains, among other changes:

- Prisma migration `20260814000000_v4_enhancement`.
- `ServiceCategory`, `Service`, `StaffService`, service/staff working hours, `PageSection`, booking snapshots, `BookingSource`, and `BookingReminder`.
- `Business.publicCode`, timezone, branding, slot granularity, and reminder settings.
- `BusinessResolver`, `PricingService`, `TimeService`, `ReminderService`, and a rewritten `AvailabilityService`.
- Public signup at `POST /api/signup`.
- Owner category routes under `/api/owner/categories`.
- Owner service, service-hour, staff-hour, PageSection, QR, and media-signature routes.
- Frontend Services, Page Builder, QR Code, service-selection, signup, and expanded settings UI.
- Backend tests executed by `pnpm --filter backend test`.

These implementation changes are currently uncommitted. They are intentional work-in-progress. Do not reset, discard, overwrite, or assume they can be recovered from `HEAD`. Inspect and improve them in place.

Verified baseline as of 2026-08-15 (post Batches 1A–1E, Batch 2 / 2A / 2B, Batch 3 / 3A, and Batch 4):

```text
pnpm --filter backend test
→ 98 tests passed (0 failed)

pnpm test:frontend
→ 2/2 (UPI display + geolocation helper)

pnpm build
→ exit 0 (backend tsc + frontend tsc/vite)

pnpm --filter backend exec prisma migrate status
→ 11/11 migrations applied; database schema up to date
```

## Completed work — DO NOT REIMPLEMENT

Treat these as **Exists** unless source inspection proves a regression:

- Reminder offset uniqueness + durable reminder processing.
- `PaymentAttempt` 10-minute capacity holds; initiate/verify are server-authoritative.
- Customer management tokens + optional OTP; **customer manage UI is cancel-only** (reschedule PUT returns 405).
- Recurring timezone purity; durable waitlist `expiresAt`.
- Tenant-isolation suite; route mounting order fixed (owner/internal before public).
- Auto-assign staff when multi-staff selection is off / “Any Available”.
- Form contact mapping by field type/label (not hardcoded `formData.name`).
- Manage page route param fixed (`slug`, not `identifier`).
- Calendar hides cancelled bookings and refreshes after cancel.
- Legacy business fields `parallelSeats`, `slotDurationMinutes`, `servicePrice` removed from schema/UI; capacity/price/duration are per-service.
- `APPLICATION_CONTEXT.md` and `DEPLOYMENT.md` exist.
- **Batch 2 + 2A + 2B (verified, payment track complete)**: durable `PaymentRefund` + `idempotencyKey`, atomic `cancelBookingWithRefundIntent`, `X-Refund-Idempotency`, notes as `{ reservly_idempotency_key }` (legacy `slotbook_idempotency_key` still matched on read), only explicit `processed` → PROCESSED (absent/unknown stays PROCESSING), reconciliation cron, legacy public booking-ID routes → 410, owner cancel/manual refund through durable pipeline, UPI-first Checkout, paid `formData`, deduplicated notifications, deposit/dashboard consistency. Do not reopen §12.8 or §12.9.
- **Batch 3 + 3A (verified, race track complete)**: day-scoped shared advisory locks — POOLED `serviceDayLockKey` = `slot:{businessId}:{serviceId}:{date}`; STAFF_BASED `staffDayLockKey` = `staff:{businessId}:{staffId}:{date}`. Booking create and payment-hold initiate share the same keys. Evidence: `BookingRace.test.ts` B3-1…B3-8. Still advisory-lock based (no DB exclusion). Do not reopen §10.11.
- **Batch 4 (verified, location + confirmation notifications complete)**: migration `20260822000000_business_location` (`address` / `latitude` / `longitude`); `LocationService.directionsUrl`; owner Settings Location card + geolocation helper; public config + confirmation/manage “Get directions”; confirmation email/WhatsApp with address, directions, one-time `managementUrl`, `replyTo = ownerEmail`, `wa.me` contact (platform Twilio From); reminders location-only (no recreated manage token); prerequisite guards on enabling notify flags; `Batch4.test.ts`; frontend **2/2**; backend **98/98**. Do not reopen §18.1 except as regression.

## Active next batch for DeepSeek V4 Flash — none required

**Specified enhancement batches through Batch 4 are verified complete.** There is no mandatory next DeepSeek batch.

Optional leftover (not blocking): `packages/backend/src/routes/owner.ts` registers `GET /owner/settings/status` twice — the Batch 4 readiness handler (first) wins; the older SMTP/SMS-only handler later in the file is dead code and should be removed in a tiny cleanup if touched.

Honest remaining product/ops limitations (documented, not open code defects for a required batch):

- Twilio WhatsApp production needs approved templates + customer opt-in (guards check Twilio config + owner number, not template SID / consent storage).
- Geolocation needs HTTPS + permission.
- Reminders never include manage/cancel links (hash-only token storage by design).
- Advisory locks, not DB exclusion constraints.
- Refund timing / UPI merchant-mobile / reconciliation cron latency.
- Owner mobile app (PWA/Capacitor) is a future product decision, not specified here.

If a new product request arrives, add a new batch section and retarget §34 — do not reopen completed batches.

---

# 1. NON-NEGOTIABLE ENGINEERING RULES

1. Read `APPLICATION_CONTEXT.md` if present. If absent, do not stop; use `README.md`, Prisma schema/migrations, tests, and source code, then recreate it during documentation.
2. Inspect the source code. Source code is authoritative when documentation differs.
3. Enhance the existing application; do not rebuild it.
4. Preserve externally observable working booking, authentication, owner dashboard, availability, blocked-slot, waitlist, recurring-booking, payment, notification, analytics, and embed behavior while correcting documented defects.
5. Do not migrate to Next.js, NestJS, GraphQL, MongoDB, Firebase, Redis, or another framework/database.
6. Continue using:
   - Backend: Node.js, Express, TypeScript, Prisma, PostgreSQL, JWT, bcrypt, Zod, Nodemailer, Twilio integration, Razorpay, RRULE.
   - Frontend: React 18, Vite, TypeScript, Zustand, Tailwind CSS, Framer Motion.
   - Package manager: pnpm.
7. Preserve the monorepo:

```text
packages/backend
packages/frontend
```

8. Reuse existing route, service, API-client, Zustand, styling, feature-guard, and notification patterns.
9. Keep business rules authoritative on the backend.
10. Do not trust client-provided `businessId`, duration, end time, price, discount, capacity, availability, payment amount, or booking source.
11. Use Zod for all new request payloads and query parameters.
12. Make the smallest coherent changes. Do not replace complete files when a focused change is sufficient.
13. Do not declare completion until builds and relevant tests pass.
14. Do not silently skip a requirement. If blocked, state the exact blocker and leave the repository in a working state.
15. Do not commit, push, deploy, or create a pull request unless explicitly asked.

Before implementation:

1. Inspect the repository and current git status.
2. Read at least:
   - `APPLICATION_CONTEXT.md` when present; otherwise `README.md`
   - root and package `package.json` files
   - `packages/backend/prisma/schema.prisma`
   - all Prisma migrations and seed data
   - backend public and owner routes
   - all backend services
   - authentication and feature guards
   - `packages/frontend/src/App.tsx`
   - `packages/frontend/src/lib/api.ts`
   - frontend types and Zustand store
   - `StepRouter` and booking widget components
   - dashboard layout and settings pages
3. Search for every caller before changing an API shape.
4. Produce a concise phase-by-phase plan.
5. Implement one verified phase at a time.

---

# 2. FIXED PRODUCT DECISIONS

These decisions have already been made. Do not ask again or substitute another design.

## 2.1 Initial scale

Design the free deployment for approximately:

- Up to 20 businesses.
- Up to 1,000 bookings per month.
- Modest owner-dashboard traffic.
- Media optimized for free-tier quotas.

Do not introduce infrastructure intended for enterprise scale.

## 2.2 Hosting architecture

Target:

```text
Vercel Hobby
  └── static React/Vite frontend

Free or low-cost Node hosting that may sleep
  └── Express API; scheduled work is triggered externally

Free managed PostgreSQL
  └── Prisma database

Cloudinary free tier
  └── logos, covers, galleries, and service images
```

Suitable providers may include a free Node host and Neon or Supabase PostgreSQL, but provider-specific assumptions must be isolated in deployment documentation and environment variables. Do not assume a free host is always on. An external cron trigger is required for reminders and waitlist expiry when the host cannot guarantee scheduled jobs.

Do not claim the full application can run unchanged on Vercel. The frontend is deployed to Vercel; the Express API and PostgreSQL are external.

Free-tier limits change. Document that hosting is suitable for the stated pilot scale, not guaranteed to remain permanently free. Twilio WhatsApp, SMTP providers, Razorpay, custom domains, and outbound messages may incur third-party costs and must not be falsely described as unlimited free services.

## 2.3 Public business URL

New public booking URLs must use an opaque, immutable, randomly generated business code:

```text
/b/{publicCode}
/b/{publicCode}?src=qr
```

Requirements:

- `publicCode` contains no business name.
- Generate it using cryptographically secure randomness.
- Use a URL-safe value with at least 96 bits of entropy, such as 16 Base64URL characters.
- Store it in `Business.publicCode`.
- Add a unique database constraint and index.
- It is immutable through normal owner settings.
- Never generate it from a name, email, sequential integer, timestamp alone, or short predictable ID.
- Existing slug URLs remain temporarily compatible and redirect to the canonical code URL.
- Preserve query parameters such as `src=qr` during redirects.
- New UI, QR codes, copied links, emails, and embeds use only the code URL.
- Do not return the legacy slug unless an existing client genuinely requires it.

An opaque code is a privacy and enumeration reduction measure, **not authentication**. Strict backend tenant scoping remains mandatory.

## 2.4 Owner onboarding

Implement self-signup. A successful signup atomically creates one isolated business workspace and its owner credentials.

For this version, preserve the existing one-owner-per-`Business` authentication model unless source inspection demonstrates that a separate Owner model is already required. Do not introduce teams or roles.

## 2.5 Resource mode

Every service explicitly chooses exactly one resource mode:

```text
STAFF_BASED
POOLED
```

- `STAFF_BASED`: capacity comes from eligible staff; each staff member is a capacity-one resource.
- `POOLED`: no staff is assigned for scheduling; `Service.capacity` controls concurrent intervals.
- Never combine or double count staff capacity and pooled capacity for one service.

## 2.6 Embedded experience

`embed=true` shows a compact booking-only experience. It does not render full public `PageSection` content.

Preserve existing embed themes and `postMessage` events.

## 2.7 Reminder defaults

New businesses default to customer reminders:

```text
24 hours before
2 hours before
```

Owners may enable/disable and customize reminder offsets.

## 2.8 Media

Use Cloudinary for uploads:

- Backend-signed upload or backend upload flow.
- Never expose Cloudinary API secret.
- Store only required asset metadata/public IDs and delivery URLs.
- Validate MIME type and file size.
- Apply upload presets/folders per environment and business.
- Delete replaced or removed assets when safe.
- Use responsive transformed images and lazy loading.

## 2.9 Payment hold

Razorpay initiation creates a server-side `PaymentAttempt` that holds the selected resource/capacity for **10 minutes**.

- Active, unexpired payment holds count as occupied intervals in availability.
- The hold is tied to one business, service, optional staff member, date, time, validated customer payload, server pricing, and Razorpay order.
- Expired, failed, consumed, or cancelled attempts do not consume capacity.
- Verification consumes the hold and creates the confirmed booking idempotently.
- The browser cannot select the hold duration or alter held booking details.

## 2.9a UPI Intent and settlement (Batch 2 — FIXED)

Product decision (do not deviate):

1. **Each salon owner uses their own Razorpay merchant credentials** (`razorpayKeyId` + write-only `razorpayKeySecret`). Funds settle to the bank account linked in that owner's Razorpay dashboard.
2. On mobile, Checkout must preferentially open **installed UPI apps** (Google Pay, PhonePe, Paytm, and other apps via Razorpay's `any` intent). This is Razorpay UPI Intent — **not** a raw `upi://pay?pa=...` deep link to an owner VPA.
3. **Do not add a free-text “receiver UPI ID” field.** A raw VPA cannot be reliably verified server-side and cannot support automatic source refunds.
4. Checkout must show the **server-confirmed payable amount** and the **salon business name** as the receiver branding before opening Razorpay.
5. Preserve full and deposit modes. Deposit refunds return only `Booking.paymentAmount` (what was actually collected).

## 2.9b Cancellation refunds (Batch 2 — FIXED)

When a customer cancels a **paid** booking via the management link:

1. Cancel the booking and free capacity **immediately**.
2. Automatically initiate a **full source refund** of the amount paid (`Booking.paymentAmount`) through Razorpay with speed `optimum` (instant when supported; otherwise normal banking timeline).
3. Persist a durable `PaymentRefund` row (unique per booking) so retries are idempotent.
4. Customer message (accurate timing — do **not** promise 1–2 days):  
   “Refund initiated to your original payment method. It may be instant; otherwise allow 5–7 working days.”
5. Notify the owner that a paid booking was cancelled, including amount and refund status.
6. If Razorpay refund initiation fails: booking stays cancelled, refund marked `FAILED`, owner notified for manual action; customer sees that automatic refund needs owner action. Never claim success falsely.
7. Unpaid bookings: cancel only; no refund record.

## 2.10 Customer booking management security

Every new booking receives a separate cryptographically random customer management token.

- Store only a strong hash of the token.
- Return the plaintext token once in the confirmation/management URL.
- Booking ID alone is never sufficient for public view or cancellation.
- Customer management UI/API is **cancel-only** for now: `PUT .../manage` must remain disabled (405). Do not re-add customer reschedule in Batch 2.
- Owner JWT routes remain unchanged and do not need the customer token.

Owners can optionally require OTP verification for customer booking management:

```text
bookingManagementOtpEnabled = false by default
bookingManagementOtpChannel = EMAIL | SMS | EITHER
```

- When OTP is off, a valid management token is sufficient.
- When OTP is on, require both a valid management token and a valid OTP before exposing or changing the booking.
- Email OTP uses configured SMTP.
- Phone OTP uses configured Twilio SMS credentials; it is not WhatsApp unless a future explicit WhatsApp OTP channel is added.
- If the selected OTP provider is unconfigured, show the owner a configuration error and do not enable that channel.
- OTP delivery and SMS are not guaranteed free and may incur third-party charges.

---

# 3. PRODUCT SCOPE AND TERMINOLOGY

Reservly serves appointment- and capacity-based businesses such as salons, clinics, studios, cafés, and restaurants:

- Hair, beauty, nail, barber, spa, massage, skin-care, wellness, tattoo/piercing, and similar businesses.
- Do not hard-code domain language that prevents other appointment businesses from using the system.

Use these exact names:

## `ServiceCategory`

A grouping of bookable services, such as Hair, Nails, Spa, Facial, or Massage.

## `PageSection`

A configurable visual/content section of the public business page, such as Hero, Offers, Gallery, About, Services, Business Hours, Testimonials, Contact, or Custom Text.

Never use “section” ambiguously in model names, routes, types, or documentation.

---

# 4. MULTI-TENANCY AND DATA ISOLATION

Tenant isolation is a release-blocking requirement.

Every tenant-owned query must be scoped to the authenticated or resolved business:

- Public requests resolve `Business` from `publicCode` or a validated legacy slug.
- Owner requests derive `businessId` exclusively from the verified JWT.
- Never trust a request body, query, path, or browser state for owner `businessId`.
- Child records must be verified as belonging to that same business before read/update/delete or relation assignment.
- IDs are not sufficient authorization.

Examples:

```ts
where: {
  id: requestedServiceId,
  businessId: req.owner.businessId,
}
```

For staff-service assignments, verify both the staff and service belong to the authenticated business.

For bookings:

- A service must belong to the resolved business.
- A selected staff member must belong to that business and be assigned to that service.
- A category must belong to that business.
- Page sections and media must belong to that business.

Public booking records must not expose unnecessary customer PII. Existing public booking-by-ID behavior should be reviewed and hardened with a non-guessable customer-facing reference/token if it exposes PII. Do not break existing flows without providing a compatibility path.

Add automated cross-tenant negative tests:

- Business A cannot read/update/delete Business B category.
- Business A cannot read/update/delete Business B service.
- Business A cannot assign Business B staff.
- Business A cannot access Business B page section.
- Business A cannot access Business B booking.
- A public code never resolves records from another business.

The public code must not be treated as an owner credential.

---

# 5. DATABASE DESIGN

Inspect the existing Prisma schema before editing. Preserve old fields for compatibility.

The exact Prisma syntax may be adapted to current conventions, but the resulting domain must support the following.

## 5.1 New enums

```text
ServiceResourceMode:
  STAFF_BASED
  POOLED

DiscountType:
  PERCENTAGE
  FLAT

BookingSource:
  DIRECT
  QR
  EMBED
  WIDGET

PageSectionType:
  HERO
  OFFERS
  GALLERY
  ABOUT
  SERVICES
  BUSINESS_HOURS
  WHY_CHOOSE_US
  TESTIMONIALS
  CONTACT
  CUSTOM_TEXT
```

Use database enums where compatible with existing migration conventions. Ensure API values are stable and documented.

## 5.2 Extend `Business`

Add fields conceptually equivalent to:

```text
publicCode              String   unique, immutable, required after backfill
timezone                String   default "Asia/Kolkata"
description             String?
logoUrl                 String?
logoPublicId            String?
coverImageUrl           String?
coverImagePublicId      String?
primaryColor            String   default existing primary color
secondaryColor          String?
accentColor             String?
slotGranularityMinutes  Int      default 15
reminderOffsetsMinutes  Int[]    default [1440, 120]
remindersEnabled        Boolean  default true
bookingManagementOtpEnabled Boolean default false
bookingManagementOtpChannel String?  // EMAIL | SMS | EITHER
```

Use a safe expand/backfill/contract migration for `publicCode`:

1. Add nullable unique field.
2. Backfill every existing business with a secure unique code.
3. Make it required if the migration system safely supports it.
4. Keep `slug` for legacy resolution, but stop using names in canonical URLs.

Keep existing:

- `slotDurationMinutes` as a legacy/default duration fallback.
- `servicePrice` as a legacy/default price fallback.
- Existing feature flags and owner authentication fields.

If `ownerEmail` is not unique, address signup ambiguity safely. First check for duplicate data before adding a unique constraint.

## 5.3 `ServiceCategory`

Required behavior:

```text
id
businessId
name
description?
imageUrl?
imagePublicId?
displayOrder
isActive
createdAt
updatedAt
```

Constraints/indexes:

- Index `(businessId, isActive, displayOrder)`.
- Prevent accidental category access across businesses.
- Decide whether names are unique per business only if existing UX requires it; do not impose global uniqueness.

## 5.4 `Service`

Required behavior:

```text
id
businessId
categoryId
name
description?
durationMinutes
bufferMinutes        default 0
price
resourceMode
capacity             default 1, meaningful only for POOLED
isActive
displayOrder
imageUrl?
imagePublicId?

discountType?
discountValue?
discountLabel?
discountValidFrom?
discountValidUntil?
discountActive       default false

createdAt
updatedAt
```

Rules:

- Duration is positive and reasonably bounded.
- Buffer is nonnegative and bounded.
- Price is nonnegative.
- Capacity is at least one.
- `STAFF_BASED` requires at least one eligible active staff member before the service can be publicly bookable.
- `POOLED` ignores staff assignments for scheduling and uses capacity.
- Category and service must belong to the same business.

Indexes:

- `(businessId, categoryId, isActive, displayOrder)`.
- Other indexes only where justified by actual queries.

## 5.5 Staff-service many-to-many relation

Use an explicit join model so tenant validation and future metadata remain possible:

```text
StaffService
  staffId
  serviceId
  businessId
  createdAt
```

Use a composite unique constraint on `(staffId, serviceId)`.

Although `businessId` is derivable, keeping it may make isolation and queries explicit. If omitted, every relation operation must still verify both parents have the same business.

## 5.6 Service-specific hours

Add `ServiceWorkingHour`:

```text
id
businessId
serviceId
dayOfWeek
openTime
closeTime
isOpen
```

Rules:

- Optional.
- When no service hours are configured for the relevant day, use business hours.
- When configured, effective periods are the intersection of business and service periods.
- Support closed days.
- Validate `HH:mm`, day range, and `openTime < closeTime`.

If multiple periods per day are needed by the current code structure, support them without forcing a unique `(serviceId, dayOfWeek)` constraint. Otherwise document the one-period limitation.

## 5.7 Staff-specific hours

The availability definition includes staff availability. Add optional `StaffWorkingHour` or extend an existing equivalent:

```text
id
businessId
staffId
dayOfWeek
openTime
closeTime
isOpen
```

Fallback behavior:

- No staff-specific schedule: use effective business/service hours.
- Configured schedule: intersect business, service, and staff periods.

Existing `BlockedSlot` remains the mechanism for one-off staff/global unavailability.

## 5.8 `PageSection`

Required behavior:

```text
id
businessId
type
title?
content?
configuration Json
displayOrder
isVisible
createdAt
updatedAt
```

Use structured JSON for section-specific data, validated by section type. Do not store executable HTML or JavaScript.

Examples:

- HERO: subtitle, CTA label, optional selected image.
- OFFERS: selected service IDs or offer cards.
- GALLERY: Cloudinary image items.
- TESTIMONIALS: author, text, optional rating.
- CONTACT: public contact details and map URL.
- CUSTOM_TEXT: sanitized limited rich text or safe structured text.

Index `(businessId, isVisible, displayOrder)`.

## 5.9 Extend `Booking`

Add:

```text
serviceId          nullable for legacy rows
originalPrice      nullable for legacy rows
discountAmount     nullable for legacy rows
finalPrice         nullable for legacy rows
source             BookingSource default DIRECT
serviceNameSnapshot?
durationMinutesSnapshot?
bufferMinutesSnapshot?
currency           default "INR"
managementTokenHash String?
```

Requirements:

- New bookings require a valid `serviceId` at the application layer.
- Existing bookings remain valid and visible.
- Historical booking display and analytics use snapshots, not the current service price/name/duration.
- `endTime` is calculated by the server from the booked duration; buffer affects resource occupancy, not the customer-visible end time.
- Generate a random management token with at least 128 bits of entropy for every new booking and store only its hash.
- Add indexes appropriate to actual service/date/status/source analytics queries.

## 5.10 Extend `WaitlistEntry`

Where safe, add nullable:

```text
serviceId
staffId (already exists if present)
durationMinutesSnapshot?
source?
```

Keep existing waitlist records and behavior compatible.

## 5.11 Payment attempts and capacity holds

Add a persisted model equivalent to:

```text
PaymentAttempt
  id
  razorpayOrderId?
  businessId
  serviceId
  staffId?
  date
  startTime
  endTime
  occupiedEndTime
  customerData Json
  formData Json
  originalPrice
  discountAmount
  finalPrice
  payableMinor
  paymentMode
  currency
  status
  holdExpiresAt
  consumedAt?
  bookingId?
  createdAt
  updatedAt
```

Use a stable status enum or validated values such as:

```text
INITIATING
PENDING
VERIFIED
CONSUMED
EXPIRED
FAILED
CANCELLED
REFUNDED
```

Requirements:

- Default hold duration is 10 minutes, calculated by the server.
- An active hold is `PENDING`, unconsumed, and `holdExpiresAt > now`.
- Add indexes for business/resource/date/status/expiry queries.
- Make Razorpay order ID unique when present.
- Link the consumed attempt to its booking.
- Avoid storing unnecessary payment secrets.
- Treat customer/form snapshots as sensitive PII.

## 5.12 Customer management tokens and OTP challenges

Add a nullable `Booking.managementTokenHash` for compatibility with old rows.

Add a short-lived OTP challenge model equivalent to:

```text
BookingManagementOtp
  id
  businessId
  bookingId
  channel
  destinationHash
  codeHash
  expiresAt
  attempts
  maxAttempts
  consumedAt?
  createdAt
```

Requirements:

- Never store plaintext management tokens or OTP codes.
- OTP expires after a short documented period, default 10 minutes.
- Single use; invalidate older active challenges when issuing a new one.
- Limit verification attempts, resend frequency, and challenges per booking/IP.
- Return generic responses that do not reveal whether an email/phone exists.
- Do not put OTP codes in logs.
- Delete or expire old challenges through scheduled cleanup.

## 5.13 Durable reminder records

For reliable restart-safe reminders, add a small database-backed model such as:

```text
BookingReminder
  id
  businessId
  bookingId
  channel
  reminderType
  offsetMinutes
  scheduledFor
  status
  attempts
  lastError?
  sentAt?
  createdAt
  updatedAt
```

Use a unique constraint on `(bookingId, channel, reminderType, offsetMinutes)` or an equivalent key that permits both the 1,440-minute and 120-minute reminders while preventing duplicates. The current `(bookingId, channel, reminderType)` key is defective because the second offset is rejected as a duplicate. Add a new migration and a test proving that both defaults are scheduled for every enabled channel.

Do not use a 24-hour `setTimeout`. A database-backed schedule survives process restarts and free-host sleeping.

## 5.14 Migration safety

1. Never edit already-applied migrations.
2. Create new migrations.
3. Preserve old columns and existing rows.
4. Backfill secure public codes.
5. Keep new booking service fields nullable in the database initially.
6. Test migration against a database containing existing seed data.
7. Run Prisma generation after schema changes.
8. Document any manual production migration step.

---

# 6. PUBLIC IDENTITY AND ROUTING

## 6.1 Canonical resolution

Preserve and use the existing `BusinessResolver` as the one backend resolver for public business identity. Audit all public routes, feature guards, waitlist, recurring, booking, and payment code so they use it consistently.

Canonical route:

```text
/b/:publicCode
```

Preserve the existing public route shape and pass the opaque code as `:identifier`:

```text
/api/:identifier/config
/api/:identifier/availability
/api/:identifier/bookings
```

`BusinessResolver` checks `publicCode` first and falls back to the legacy slug. Do not add a second `/api/public/...` route family or duplicate handlers. Instead:

- New frontend calls use the public code.
- Canonical generated links use the public code.
- Do not duplicate route business logic.
- Place public-code/legacy resolution in a shared middleware/service.
- Avoid ambiguous collisions by checking public code first and validating formats.

## 6.2 Legacy redirects

Existing:

```text
/b/demo-salon
/demo-salon
```

should resolve the legacy slug and redirect to:

```text
/b/{publicCode}
```

Preserve safe query parameters. Do not create redirect loops.

## 6.3 Source attribution

Normalize only:

```text
qr      → QR
embed   → EMBED
widget  → WIDGET
direct or missing → DIRECT
```

Unknown values become `DIRECT`; never store arbitrary source strings.

The backend derives source from an allowed request value and context. The frontend may carry the normalized source through the wizard, but it is not authoritative.

`QR` is selected only when `src=qr` or `source=qr` is explicitly present. Merely visiting `/b/{publicCode}` is `DIRECT`, not QR. Apply embed detection before path heuristics. Fix any code that marks every `/b/...` path as QR.

---

# 7. OWNER SELF-SIGNUP

Preserve and audit the existing public signup endpoint:

```text
POST /api/signup
```

Input:

```text
name
ownerEmail
ownerPassword
timezone? default Asia/Kolkata
ownerWhatsapp?
```

Behavior:

1. Validate with Zod.
2. Normalize email.
3. Enforce strong minimum password requirements without unnecessary complexity.
4. Hash with existing bcrypt conventions.
5. Generate secure `publicCode`.
6. Generate a non-public internal/legacy slug safely if the existing schema requires it. Do not use it in customer URLs.
7. In one transaction create:
   - Business.
   - Default working hours.
   - Default booking/form settings needed by current code.
   - Default visible PageSections.
   - Default reminders `[1440, 120]`.
8. Return the existing login-compatible JWT and a safe business summary.
9. Never return password hashes or secrets.
10. Handle duplicate email and public-code collision safely.

The responsive signup page and login link already exist; verify rather than recreate them. Ensure signup creates default visible PageSections in the same transaction if that is still missing.

Do not create a public list of businesses or allow owners to switch into other businesses.

---

# 8. PRICING SERVICE

Create one authoritative backend `PricingService`.

Input:

```text
service
business-local date/time at which pricing is evaluated
```

Output:

```ts
{
  originalPrice: number
  discountAmount: number
  finalPrice: number
  discountLabel: string | null
  discountType: 'PERCENTAGE' | 'FLAT' | null
}
```

Rules:

1. Inactive or missing discount: zero discount.
2. Before `discountValidFrom`: zero discount.
3. After `discountValidUntil`: zero discount.
4. Percentage must be 0–100.
5. Flat discount must be nonnegative.
6. Clamp discount to original price.
7. `finalPrice = max(0, originalPrice - discountAmount)`.
8. Use consistent currency precision. Avoid unsafe floating-point behavior for payment amounts; convert to minor currency units at the payment boundary.
9. Evaluate dates in the business timezone.
10. The server uses this output for:
    - public config display,
    - booking snapshots,
    - Razorpay order amount,
    - confirmation messages,
    - payment verification,
    - analytics.

Never accept a browser-supplied price or discount as authoritative.

Tests:

- No discount.
- Valid percentage.
- Valid flat amount.
- Future discount.
- Expired discount.
- Discount equal to price.
- Discount greater than price clamps to zero final price.
- Boundary dates.

---

# 9. TIMEZONE AND TIME UTILITIES

Default business timezone:

```text
Asia/Kolkata
```

Requirements:

- Validate timezone as an IANA timezone.
- Centralize date/time conversion in a backend utility.
- Do not depend on the host server timezone.
- Interpret requested local booking dates and `HH:mm` in the business timezone.
- Store absolute timestamps in UTC-compatible database fields where appropriate.
- Format public and notification times in the business timezone.
- Calculate reminder timestamps from business-local appointments correctly.
- Define date-only comparisons consistently.
- Do not scatter `new Date("YYYY-MM-DD")`, `setHours`, or server-local conversions through services.
- Never derive a business-local scheduling date with `toISOString().split('T')[0]` or parse `new Date('YYYY-MM-DD')` directly.
- Preserve the current representation: `Booking.date` is UTC midnight corresponding to the business-local `YYYY-MM-DD`; `startTime` and `endTime` are business-local `HH:mm` strings.
- Use the existing `TimeService` methods (`toDateStr`, `dateToUtcMidnight`, `dayRangeUtc`, and `toUtc`) consistently, including in recurring and waitlist paths.

Preserve existing `date` plus `startTime/endTime` representation if a full timestamp migration would be disruptive, but centralize safe conversions and document the representation.

Add tests around day boundaries and at least one non-default timezone.

---

# 10. DURATION-AWARE AVAILABILITY ENGINE

This is the most important backend change.

Refactor `AvailabilityService`; do not create competing availability implementations.

## 10.1 Input

```text
publicCode/business resolver
date (business-local YYYY-MM-DD)
serviceId (required for new flow)
staffId? (only for STAFF_BASED)
```

## 10.2 Slot granularity

Use:

```text
Business.slotGranularityMinutes
default 15
```

Do not use service duration as candidate-start granularity.
Do not hard-code 15 throughout the code.

## 10.3 Effective periods

For the requested date:

```text
business working periods
INTERSECT service periods when configured
INTERSECT staff periods for a selected/eligible staff member when configured
MINUS applicable blocked intervals
```

If service hours are absent, use business hours.
If staff hours are absent, use the business/service intersection.

## 10.4 Customer interval and occupancy interval

```text
visibleStart = candidate start
visibleEnd = visibleStart + durationMinutes
occupiedEnd = visibleEnd + bufferMinutes
```

- The complete visible interval must fit business/service/staff working hours.
- The occupied interval, including buffer, must not overlap another booking/resource occupancy.
- Decide and document whether a final buffer may extend past closing. Default requirement: it may not extend past closing because the resource is still occupied.
- Existing bookings use their snapshots when available; use safe legacy fallbacks otherwise.

## 10.5 Interval overlap

Use half-open intervals:

```text
[start, end)
```

Two intervals overlap when:

```text
candidateStart < existingOccupiedEnd
AND
existingStart < candidateOccupiedEnd
```

Therefore a booking may begin exactly when a previous occupied interval ends.

## 10.6 `STAFF_BASED`

- Load only active staff assigned to the selected service and business.
- If `staffId` is supplied, verify eligibility and evaluate only that staff member.
- If no staff is selected, evaluate every eligible staff member independently.
- A staff member is capacity one.
- For the current release, a `STAFF_BASED` booking requires an explicit eligible `staffId`. If multi-staff selection is disabled and exactly one eligible staff member exists, the server may select that one member deterministically. If zero or multiple eligible staff exist, do not create an unassigned booking; require a staff choice or report the service unavailable.
- A booking for Staff A does not block Staff B.
- Global blocks affect all staff.
- Staff blocks affect only matching staff.
- Active, unexpired `PaymentAttempt` holds for the same staff member count exactly like occupied bookings until consumed or expired.
- Return each slot with eligible staff IDs or staff-specific rows using one documented stable response.

Recommended response:

```json
{
  "date": "2026-08-15",
  "serviceId": "service-id",
  "durationMinutes": 60,
  "bufferMinutes": 15,
  "timezone": "Asia/Kolkata",
  "slots": [
    {
      "startTime": "10:00",
      "endTime": "11:00",
      "eligibleStaffIds": ["staff-a", "staff-b"],
      "availableCapacity": 2
    }
  ],
  "nextAvailable": null
}
```

If a `staffId` was requested, `eligibleStaffIds` contains only that staff member.

## 10.7 `POOLED`

- Staff is not used.
- Count confirmed bookings and active, unexpired `PaymentAttempt` holds whose occupied intervals overlap the candidate occupied interval.
- A candidate is available when the combined overlapping booking-and-hold count is less than `Service.capacity`.
- Count the complete candidate interval, not only identical start times.

Example capacity 3:

```text
10:00–11:00
10:15–11:15
10:30–11:30
```

are valid. A fourth overlapping interval is unavailable.

## 10.8 Exact closing

A visible service end and required buffer may end exactly at closing.
Neither may extend beyond the effective closing time under the default rule.

## 10.9 Next available

Implement a bounded next-available search:

- Search from the requested date through the business booking window.
- Use the same authoritative availability function.
- Return the first candidate whose complete occupied interval is valid.
- Do not assume the end of an existing booking is valid without testing the full requested duration and buffer.
- Put a clear upper bound on dates and query work.

## 10.10 Legacy fallback

Old flows or historical records without a service use:

- `Business.slotDurationMinutes`.
- Existing `Business.parallelSeats`.
- Existing behavior as closely as possible.

New customer bookings require a service.

## 10.11 Race-condition policy

Immediately before insertion:

1. Reload authoritative service/resource data.
2. Re-run availability for the exact interval.
3. Insert only if still available.

### Batch 3 — VERIFIED (2026-08-15) — same-startTime races closed

**Exists / verified:** unpaid/free/recurring booking creates and payment-hold initiate originally shared a per-`startTime` key; B3-1…B3-5 covered identical-slot / unpaid-vs-hold / HTTP conflict. Superseded by Batch 3A day-scoped keys — keep B3-1…B3-5 as regressions only.

### Batch 3A — VERIFIED COMPLETE (2026-08-15) — overlapping / cross-service races closed

**Exists / verified:** day-scoped shared advisory locks used by **both** `BookingService.createBooking` and `PaymentFlowService.initiate`:

- POOLED → `serviceDayLockKey` = `slot:{businessId}:{serviceId}:{date}`
- STAFF_BASED → `staffDayLockKey` = `staff:{businessId}:{staffId}:{date}` (auto-assign probe-resolves staff, then locks staff-day, then authoritative re-check)

Inside the lock: availability re-check → insert only if still available; loser gets clean `Slot is no longer available`. Evidence: `BookingRace.test.ts` B3-6 (overlapping starts), B3-7 (shared staff across services), B3-8 (non-overlapping both succeed), plus B3-1…B3-5 regressions; backend **92/92**. No migration (code-only). Still advisory-lock based — out-of-band SQL bypasses; no DB exclusion constraint.

Do not reopen this lock design. Do not implement location/notifications here — that is Batch 4 (§18.1).

## 10.12 Required tests

At minimum:

1. 30-minute service: 09:00 and 09:30 occupied; next is 10:00.
2. Two-hour service is not offered in a 45-minute gap.
3. Pool capacity three permits three overlapping bookings and rejects the fourth.
4. Staff A occupied while Staff B remains eligible.
5. Service 11:00–16:00 under business 09:00–20:00 returns only service-period slots.
6. Service buffer prevents the next overlap.
7. Service ending exactly at closing is valid.
8. Service extending one granularity beyond closing is invalid.
9. Global blocked slot.
10. Staff-only blocked slot.
11. Existing interval that starts inside candidate interval.
12. Existing interval that surrounds candidate interval.
13. No eligible staff.
14. Timezone day boundary.

---

# 11. BOOKING SERVICE AND API

New booking request:

```json
{
  "serviceId": "required",
  "staffId": "optional",
  "date": "YYYY-MM-DD",
  "startTime": "HH:mm",
  "customerName": "required",
  "customerPhone": "required",
  "customerEmail": "optional",
  "formData": {},
  "source": "qr|direct|embed|widget",
  "recurring": {}
}
```

The server must:

1. Resolve business from the public code.
2. Validate the service belongs to the business and is active.
3. Validate resource mode.
4. Validate staff assignment when staff-based.
5. Derive duration, buffer, end time, and occupied end.
6. Derive normalized source.
7. Calculate pricing via `PricingService`.
8. Re-check availability immediately before insertion.
9. Store service and price snapshots.
10. Create payment order from server-calculated final price where enabled.
11. Preserve recurring/waitlist/notification behavior.
12. Return safe booking details.

Ignore or reject browser-provided `endTime`, price, discount, duration, or business ID.

Existing historical bookings without `serviceId` continue to render with legacy labels and values.

Rescheduling must run the same service-aware availability rules while excluding the booking being moved.

Add an explicit availability option such as `excludeBookingId`. Public and owner rescheduling must use it, recalculate end time and snapshots when applicable, reject invalid staff/service combinations, cancel old pending reminders, and schedule new reminders only after a successful move.

Cancellation must preserve waitlist behavior and notification behavior.

## 11.1 Public customer booking management

Do not authorize customer operations with `bookingId` alone.

Recommended URLs:

```text
/booking/manage/{bookingId}?token={plaintextManagementToken}
```

The token may be accepted in an authorization header or request body after initial page loading so it is not repeatedly leaked through logs/referrers. Do not store it in analytics.

Public API behavior:

```text
POST /api/:identifier/bookings/:id/manage/session
POST /api/:identifier/bookings/:id/manage/otp/request
POST /api/:identifier/bookings/:id/manage/otp/verify
GET  /api/:identifier/bookings/:id/manage
PUT  /api/:identifier/bookings/:id/manage
DELETE /api/:identifier/bookings/:id/manage
```

Exact paths may follow existing conventions, but all management operations must share one authorization service.

Authorization:

1. Resolve the business from `:identifier`.
2. Load the booking scoped to that business.
3. Hash and constant-time compare the supplied management token.
4. If owner OTP is disabled, authorize after a valid token.
5. If owner OTP is enabled, issue/verify the configured email or SMS OTP and then create a short-lived, booking-scoped management session.
6. The management session may view/reschedule/cancel only that booking.
7. Return the minimum customer-facing fields.

Owner settings must support:

- OTP disabled.
- Email OTP.
- SMS OTP.
- Either channel, allowing the customer to choose only among configured destinations.

Do not expose the full stored email/phone when offering a channel; show masked destinations. If no configured provider/destination is available, fail safely with a useful customer message and do not bypass OTP automatically.

Legacy `GET/PUT/DELETE /:identifier/bookings/:id` behavior must be audited and deprecated. Do not abruptly break existing confirmation links without a migration/compatibility plan. New links and bookings always use management tokens.

---

# 12. PAYMENTS

Preserve Razorpay. **PaymentAttempt hold + authoritative verify already exist** — do not rebuild them. Extend them for UPI-first checkout and refunds.

## 12.1 Existing correct flow (keep)

```text
load service
→ PricingService calculates final price
→ PaymentFlowService.initiate creates PaymentAttempt hold (10 min) + Razorpay order
→ customer pays
→ PaymentFlowService.verify (signature + idempotent consume)
→ booking stores pricing snapshots and payment IDs
→ confirmation / reminders
```

Still required:

- Never accept the browser amount / payment mode.
- Integer minor units (paise).
- Test mode mock orders (`order_test_...`) and auto-verify.
- Free `finalPrice = 0` bypasses Razorpay.
- Expire stale holds via authenticated cron.

## 12.2 Batch 2 — Mobile UPI Intent checkout

Files:

- `packages/frontend/src/widget/steps/PaymentStep.tsx`
- optionally `packages/frontend/src/dashboard/pages/Settings.tsx`
- `packages/backend/src/routes/owner.ts` (validation only)

Requirements:

1. Replace decorative UPI app buttons that all call the same handler with a **truthful** primary CTA: “Pay with UPI apps” (or equivalent), plus optional “More payment options”.
2. Open Razorpay Checkout with a `display` configuration that prioritizes UPI Intent instruments, e.g. `gpay`, `phonepe`, `paytm`, and `any`, so installed mobile UPI apps appear. Keep a clear desktop/unsupported fallback.
3. Prefill/display:
   - server payable amount (`order.payable` / `order.amount`)
   - receiver branding = business name (`order.name` / config business name)
4. Continue using owner `razorpayKeyId` as Checkout `key`.
5. **Forbidden:** storing or collecting a raw owner UPI VPA for payment.
6. Owner Settings copy must explain: “UPI payments via your Razorpay account — connect Key ID/Secret; customers pay with installed UPI apps; money settles to your Razorpay-linked bank account.”
7. Live mode + payments enabled requires usable credentials (Key ID + secret configured). Refuse enabling live paid checkout without them.

## 12.3 Batch 2 — Durable PaymentRefund model

Add a forward-only Prisma migration (do **not** edit older migrations), e.g. `20260820000000_payment_refund`.

Suggested shape:

```text
PaymentRefund
  id
  businessId          (indexed, tenant-scoped)
  bookingId           @unique  (one refund pipeline per booking)
  razorpayPaymentId
  razorpayRefundId?
  amountMinor         Int   // paise; equals paid amount
  currency            default INR
  status              PENDING | PROCESSING | PROCESSED | FAILED
  failureReason?
  initiatedAt?
  processedAt?
  createdAt / updatedAt
```

Also extend booking `paymentStatus` usage to include `refunded` / `refund_pending` / `refund_failed` as appropriate without breaking existing `paid` / `partial` / `pending` values.

## 12.4 Batch 2 — Automatic refund on customer cancel

Primary route: `DELETE /:identifier/bookings/:id/manage` in `packages/backend/src/routes/public.ts` (cancel-only; PUT manage already returns 405).

Implement preferably via a dedicated service method (e.g. `PaymentFlowService.refundForCancelledBooking` or `RefundService`) called after successful cancel:

1. If booking has no paid Razorpay payment / `paymentAmount` is null/0 → skip refund.
2. Else, in a DB transaction:
   - Upsert/create `PaymentRefund` unique on `bookingId` (idempotent).
   - If already `PROCESSED` or `PROCESSING` with refund id → return existing status.
   - Mark refund `PROCESSING`, set booking paymentStatus to refund-pending.
3. Outside or carefully after commit: call `PaymentService.initiateRefund(paymentId, amount, businessId)` with Razorpay speed **`optimum`**. Enhance `initiateRefund` if needed to send `{ amount, speed: 'optimum' }`. Keep test-mode mocks (`pay_test_` / business test mode).
4. On Razorpay success: mark refund `PROCESSED`, store `razorpayRefundId`, set booking `paymentStatus = refunded`.
5. On failure: mark refund `FAILED` + `failureReason`; booking remains cancelled; notify owner for manual action.
6. Always free calendar capacity (cancel already sets `CANCELLED`; availability only counts `CONFIRMED`).
7. Notify owner + customer (see 12.5).

Refund amount = `Booking.paymentAmount` converted to paise (or store minor units at book time if cleaner). Deposit bookings refund deposit only.

## 12.5 Batch 2 — UX and notifications

Customer manage page (`ManageBookingPage.tsx`) after cancel:

- Unpaid: “Booking cancelled.”
- Refund initiated/processed: “Refund initiated to your original payment method. It may be instant; otherwise allow 5–7 working days.”
- Refund failed: “Booking cancelled, but the automatic refund needs the salon to complete it. We have notified the salon.”

Owner:

- Email/WhatsApp (respect existing notification flags): paid booking cancelled by customer; include booking id, customer, amount, refund status.
- Dashboard Payments page shows refund status for paid bookings.

API cancel response should include `{ booking, refund: { status, amount, message } | null }` so the UI does not invent state.

## 12.6 Batch 2 — Required tests

Add/extend backend tests (tsx `--test`):

1. Paid full cancel → refund PROCESSED in test mode; booking CANCELLED; slot free again.
2. Paid deposit cancel → refunds deposit amount only.
3. Unpaid cancel → no PaymentRefund row.
4. Double cancel / double refund call → one PaymentRefund; no second Razorpay call when already processed.
5. Simulated refund API failure → refund FAILED; booking still CANCELLED; owner notification path invoked (mock-friendly).
6. Cross-tenant: Business A cannot refund/cancel Business B booking via manage session.
7. Live-credential validation: enabling live payments without secret fails.

Frontend: ensure PaymentStep builds; no raw VPA field.

## 12.7 Batch 2 — Explicit non-goals

- Marketplace/linked-account Razorpay Route.
- Raw UPI VPA payment or manual “I paid” confirmation.
- Customer reschedule (already disabled).
- Automatic refund of unpaid/cash bookings.
- Promising a 1–2 business day refund SLA (use 5–7 working days language).

## 12.8 Batch 2A — VERIFIED COMPLETE (2026-08-15)

Source inspection after the first Batch 2 implementation found the defects below. **They are now fixed and verified** — do not reimplement. Evidence: migration `20260821000000_payment_refund_idempotency`, `RefundService.cancelBookingWithRefundIntent`, `PaymentService.initiateRefund` + `X-Refund-Idempotency`, `Batch2A.test.ts` A1–A8, frontend `razorpayDisplay.test.ts`, backend **82/82**, migrate status **10/10**.

Historical findings (resolved — kept for audit trail only):

### P0. Refund creation is not safely idempotent — RESOLVED

Was: advisory lock released before Razorpay; concurrent cancel could double-refund; sequential-only test.

Fixed: stable `PaymentRefund.idempotencyKey` (UUID, `@unique`) → `X-Refund-Idempotency` on every attempt; byte-identical body; `PROCESSING` without refund id never re-initiated from a request path (reconciliation cron only); 409 → reconcile; A1 `Promise.all` concurrency test.

### P0. Cancellation and durable refund intent are not atomic — RESOLVED

Was: cancel committed, then separate refund transaction.

Fixed: `cancelBookingWithRefundIntent` — lock → tenant re-read → idempotent CANCELLED + `cancelledAt` → reminders → refund intent in one transaction before Razorpay I/O.

### P0. Existing routes bypass the refund pipeline — RESOLVED

Was: legacy public GET/PUT/DELETE by booking ID; owner DELETE without refund; manual refund bypassed `PaymentRefund`.

Fixed: legacy public routes → **410**; owner PUT(CANCELLED)/DELETE + manual refund through durable pipeline (full amount only); unused frontend legacy callers removed.

### P0. Razorpay response status is mapped incorrectly — RESOLVED (Batch 2B completed the unknown-status polish)

Was: every successful HTTP response marked PROCESSED.

Fixed: `processed` → PROCESSED/`refunded`; `pending` → PROCESSING/`refund_pending`; `failed` → FAILED/`refund_failed`; durable `process-refund-reconciliation` cron. Batch 2B: absent/unknown stays PROCESSING — see §12.9.

### P1. UPI Checkout is not explicitly UPI-first — RESOLVED

Fixed: `sequence: ['block.upi','block.other']`, `show_default_blocks: false`, two-step initiate → confirm → open, `formData` forwarded, no fake per-method buttons.

### P1. Notifications are duplicated — RESOLVED

Fixed: one customer + one owner message branching on refund state.

### P1. Configuration and status consistency — RESOLVED

Fixed: `refundPolicy` informational-only; deposit exactly one of amount/%; “Collected” nets refunds; singular `paymentRefund` on Booking.

### Batch 2A acceptance tests — ALL PASSING

1–9 covered by `Batch2A.test.ts` + `razorpayDisplay.test.ts`; prior suites still green (82 total).

## 12.9 Batch 2B — VERIFIED COMPLETE (2026-08-15)

Post–Batch 2A live-mode gaps are **fixed and verified**. Do not reopen. Evidence: `PaymentService.initiateRefund` notes object, `RefundService.mapRazorpayRefund` conservatism, `Batch2B.test.ts` B1–B2, A2 body capture updated, backend **84/84**, frontend 1/1, `pnpm build` exit 0. No Prisma migration (code-only).

### P0. Refund `notes` must be a Razorpay JSON object — RESOLVED

Was: `notes: [{ key, value }]`.

Fixed: `notes: { reservly_idempotency_key: <idempotencyKey> }` on live + test-mode paths; byte-identical retries; `X-Refund-Idempotency` unchanged; `notesMatch` reads object (and still tolerates legacy array / `slotbook_idempotency_key`).

### P1. Unknown / absent status must not become PROCESSED — RESOLVED

Was: absent/unknown treated as PROCESSED.

Fixed: only explicit `processed` → PROCESSED; absent/unknown → PROCESSING / `refund_pending` until reconciliation.

### Batch 2B acceptance tests — ALL PASSING

B1 notes object + byte-identical retry; B2 unknown status → PROCESSING then reconcile to PROCESSED; prior suite green (84 total).

---

# 13. WAITLIST AND RECURRING BOOKINGS

## Waitlist

- Associate new waitlist entries with `serviceId`.
- Preserve optional `staffId`.
- A released slot must be evaluated against the waiting service's duration, buffer, resource mode, and capacity.
- Preserve existing queue order and notification behavior.
- Add database `expiresAt` and replace the existing 30-minute `setTimeout` with the same authenticated scheduled-processing mechanism used for reminders.
- Before notifying or cascading, run authoritative availability for the waitlisted `serviceId` and optional `staffId`.
- Until the durable migration and processor are complete, explicitly mark waitlist expiry as not restart-safe; do not call the deployment complete.

## Recurring

- Each occurrence must pass service-aware availability.
- Store the same service and pricing snapshot policy for each occurrence.
- Calculate and store pricing at creation time for each occurrence.
- Generate and compare dates through `TimeService` in the business timezone, never through host-local dates or `toISOString().split('T')[0]`.
- Re-check availability immediately before each insert and return explicit conflicts. Do not silently create a partial series without documenting transaction/partial-success behavior.
- Return conflict details without creating silent overlaps.

---

# 14. SERVICES, CATEGORIES, STAFF, AND HOURS OWNER APIs

Use existing JWT middleware. Derive business from JWT only.

Implement:

```text
GET    /api/owner/categories
POST   /api/owner/categories
PUT    /api/owner/categories/:id
DELETE /api/owner/categories/:id

GET    /api/owner/services
POST   /api/owner/services
GET    /api/owner/services/:id
PUT    /api/owner/services/:id
DELETE /api/owner/services/:id

GET/PUT /api/owner/services/:id/hours
GET/PUT /api/owner/staff/:id/hours
```

These routes already exist. Audit and complete them; do not add parallel `/service-categories` endpoints. Preserve the current `displayOrder` update pattern. Add a bulk reorder endpoint only if the existing owner UI requires it, and have it update all scoped records transactionally.

Extend staff payloads with:

```text
serviceIds[]
```

Validation:

- Names required and length-limited.
- Duration positive and reasonably bounded.
- Buffer nonnegative and bounded.
- Price nonnegative.
- Capacity at least one.
- Percentage 0–100.
- Flat discount nonnegative.
- Valid discount dates and ordering.
- Category belongs to current business.
- Every staff ID belongs to current business.
- Every assigned service belongs to current business.
- Allowed resource mode only.
- Valid time and timezone formats.

Deletion behavior:

- Prefer archive/deactivate when records are referenced by bookings.
- Do not cascade-delete historical bookings.
- Category deletion must fail or require services to be reassigned/deactivated.
- Explain conflicts to the owner.

---

# 15. PAGE SECTIONS AND PUBLIC PAGE

Owner endpoints:

```text
GET    /api/owner/page-sections
POST   /api/owner/page-sections
PUT    /api/owner/page-sections/:id
DELETE /api/owner/page-sections/:id
PUT    /api/owner/page-sections/reorder
```

Public config returns only visible sections in display order.

Page builder requirements:

- Add section from allowed types.
- Edit validated section-specific content.
- Show/hide.
- Delete.
- Reorder using up/down controls unless a lightweight existing dependency already supports accessible drag-and-drop.
- Do not introduce a large dependency just for reordering.
- Prevent arbitrary HTML/JS injection.

Public page:

- Logo and business name.
- Concise description.
- Cover/hero and booking CTA.
- Service-category chips/tabs.
- Service cards with image, description, duration, original/final price, and truthful discount badge.
- Owner-configured visible sections.
- Business hours and contact information when configured.
- Booking CTA remains easy to reach.

Embed mode:

- Booking flow only.
- No full PageSections.
- Preserve theme injection and `postMessage`.

---

# 16. QR BOOKING

Each business uses:

```text
{FRONTEND_PUBLIC_URL}/b/{publicCode}?src=qr
```

Owner dashboard QR page must provide:

- QR preview.
- Canonical URL display.
- Copy URL.
- Download PNG.
- Print-friendly layout.

Generate the QR dynamically; do not add a QR database table.

The owner QR endpoint may return URL/configuration, but never another business's public code.

The frontend can generate the QR using the existing `qrcode` dependency.

Tests:

- Correct frontend origin.
- Correct opaque public code.
- `src=qr` present.
- No business name or slug in new QR URL.
- Booking source persists as `QR`.

---

# 17. MEDIA AND CLOUDINARY

Preserve the existing `/api/owner/media/signature` endpoint and extract its reusable logic into a small backend media service rather than adding a competing upload route.

Environment variables:

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
CLOUDINARY_FOLDER_PREFIX
```

Requirements:

- API secret stays backend-only.
- Validate authenticated business before creating upload signatures.
- Scope asset folders by environment and opaque business ID/code.
- Restrict resource types, MIME types, dimensions, and maximum bytes.
- Store `publicId` so assets can be replaced/deleted.
- Do not trust a client URL as proof of ownership.
- Use optimized delivery formats (`f_auto`, `q_auto`) where appropriate.
- Use lazy loading and responsive image sizes.
- Provide graceful placeholders when media is absent.
- Enforce MIME type, byte-size, and transformation restrictions in the Cloudinary upload preset/signature and validate persisted asset metadata.
- Add authenticated deletion by an owned `publicId` when a logo, cover, service image, or gallery item is replaced or removed. Never permit deletion outside the authenticated business folder.

Do not block basic business onboarding when Cloudinary is unconfigured. The signature endpoint should return a clear 503 configuration error while text-based configuration remains usable.

---

# 18. NOTIFICATIONS AND REMINDERS

Continue using `NotificationService`.

Message types:

```text
BOOKING_CONFIRMATION
BOOKING_REMINDER
BOOKING_CANCELLED
BOOKING_MANAGEMENT_OTP
```

Template data:

- Business name.
- Customer name.
- Service snapshot name.
- Business-local date and time.
- Duration.
- Final price/currency.
- Booking reference.

WhatsApp:

- Continue existing Twilio integration.
- Keep templates structured for eventual approved WhatsApp Business templates.
- Do not claim arbitrary free-form messages are production-approved.
- Missing Twilio credentials or delivery failure must not normally roll back a valid booking.
- Log safe error information without secrets or unnecessary customer PII.

Booking management OTP:

- Email OTP uses the existing SMTP transport.
- SMS OTP uses Twilio SMS and a dedicated `TWILIO_SMS_FROM`.
- Do not silently send SMS from `TWILIO_WHATSAPP_FROM`.
- OTP delivery failure does not change the booking, but management access remains unverified.
- The owner UI must prevent enabling a channel whose required provider settings are absent.

Reminders:

- Default offsets: 1,440 and 120 minutes.
- Owner can enable/disable and configure validated offsets.
- Store scheduled reminders in PostgreSQL.
- Process due reminders through the persistent API worker or an authenticated scheduled endpoint.
- Make processing idempotent and retry-limited.
- On cancellation/reschedule, cancel or rebuild pending reminders.
- Do not rely on long `setTimeout` calls.

For a free hosting setup that sleeps, document an external free cron option calling:

```text
POST /api/internal/jobs/process-reminders
```

Protect it using a strong `CRON_SECRET`, use constant-time comparison where appropriate, and never expose it in the frontend.

## 18.1 Batch 4 — VERIFIED COMPLETE (2026-08-15)

**Exists / verified.** Migration `20260822000000_business_location`; `LocationService`; Settings Location card + geolocation helper; public config + confirmation/manage Get directions; confirmation email/WhatsApp with address, directions, `managementUrl`, `replyTo = ownerEmail`, `wa.me` contact; reminders location-only; prerequisite guards; `Batch4.test.ts`; backend **98/98**, frontend **2/2**, migrate **11/11**. Do not reimplement.

Historical specification (resolved — kept for audit):

### Fixed product decisions

1. **Salon location on `Business`** (migration required):
   - `address String?` — trimmed, max length ~500.
   - `latitude Float?` / `longitude Float?` — optional pair; if either is set both must be set; lat ∈ [-90,90], lng ∈ [-180,180].
2. **No Google Maps API key / Places / geocoding**. Browser geolocation fills editable lat/lng when the owner is at the salon. Directions URL is generated server-side and/or via a shared helper:
   - Prefer `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}`
   - Else `...&destination={encodeURIComponent(address)}`
   - Never accept a client-supplied maps URL as authoritative storage.
3. **Owner Settings** — Location card: address textarea; editable lat/lng; **Use my current location** (`navigator.geolocation`); clear permission/HTTPS/timeout/unsupported errors; map-preview link; clear/edit support.
4. **Customer surfaces** — Confirmation screen and authenticated manage page show address + **Get directions** when location exists.
5. **Booking confirmation email + WhatsApp** (respect notify flags) include:
   - Salon address
   - Directions link
   - One-time `managementUrl` labelled **View or cancel booking** (customer reschedule remains 405 / disabled)
6. **Reminders** include address + directions only. They must **not** recreate the manage/cancel token (only `managementTokenHash` is stored). Document this honestly.
7. **Sender model (platform SMTP/Twilio)**:
   - Authenticated `From` remains platform SMTP / Twilio WhatsApp sender.
   - Customer emails set `replyTo` to salon `ownerEmail`.
   - WhatsApp bodies include salon `ownerWhatsapp` as contact / `wa.me` link; **never** use the salon's personal WhatsApp number as Twilio `From`.
   - Do **not** store per-salon SMTP or Twilio secrets on `Business`.

### Hard prerequisites before a channel is “active / valid”

Document these in Settings readiness UI, `APPLICATION_CONTEXT.md`, and owner-facing copy. Refuse enabling a channel when its prerequisites fail (same pattern as OTP channel guards).

**App / links**

- `FRONTEND_PUBLIC_URL` (or `FRONTEND_URL`) must be a valid absolute HTTPS URL in production so `managementUrl` is usable.
- Browser geolocation requires a secure context (HTTPS or localhost) and explicit user permission.

**Email (platform SMTP)**

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` configured.
- Platform From address/`SMTP_FROM_NAME` usable; verified sender/domain recommended (SPF/DKIM/DMARC).
- Salon `ownerEmail` present and valid when `replyTo` is used.
- Customer has a valid email when `notifyCustomerEmail` is on.
- Owner cannot enable customer email notifications when SMTP is unconfigured.

**WhatsApp (platform Twilio)**

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` configured.
- Approved WhatsApp Business sender (not a random personal number).
- Approved Content Template SID(s) for business-initiated confirmation/reminder (free-form sandbox messages are **development-only**).
- Salon `ownerWhatsapp` and customer phone in E.164 when WhatsApp notify is on.
- Explicit customer WhatsApp opt-in before sending (collect/store consent flag or equivalent; do not spam).
- Production Twilio account enabled for live traffic; sandbox is not “production ready.”
- Owner cannot enable customer WhatsApp notifications when Twilio WhatsApp prerequisites fail.

**Test send / readiness**

- Extend owner readiness/status (existing OTP status pattern) to report SMTP configured, Twilio WhatsApp configured, template readiness, and location completeness.
- Test-send must surface real success/failure (current `NotificationService` helpers often swallow errors — fix for Batch 4 readiness paths).

### Security / non-goals

- Do not put manage tokens on public config.
- Do not expose `ownerPassword`, Razorpay secrets, SMTP/Twilio secrets.
- Public DTO may include address + lat/lng intentionally (owner-consented salon location).
- Escape HTML interpolations in email templates.
- No customer reschedule. No per-salon provider credentials. No Google billing API.
- Do not reopen §10.11 lock design or §12.2–§12.9 payments.

### Batch 4 acceptance tests — ALL PASSING

Historical list (covered by `Batch4.test.ts` + geolocation frontend test):

1. Schema/migration + `PUT /owner/config` validation for address and lat/lng pairs.
2. Maps URL helper prefers coords, falls back to address, returns null when empty.
3. Public `GET /:identifier/config` includes location fields; secrets absent.
4. Owner Settings geolocation helper handles denied/unsupported/insecure contexts without crashing.
5. Unpaid + paid confirmation notifications include address, directions, and `managementUrl` when present; email `replyTo === ownerEmail`.
6. Reminder path includes location/directions and does **not** invent a manage token.
7. Enabling customer email/WhatsApp without prerequisites is rejected with a clear error.
8. Existing suites (Batch 2/2A/2B, 3/3A including B3-1…B3-8, tenant isolation, manage cancel-only) continue to pass.

### Batch 4 report must include

Files changed; migration name; prerequisite matrix (what blocks email vs WhatsApp); confirmation template samples; exact test/build results; remaining limitations (Twilio template approval, geolocation permission, reminder without cancel link).

---

# 19. ANALYTICS

Extend the existing `AnalyticsService`; do not redesign it.

Add, where practical:

- Bookings by service snapshot.
- Revenue by service.
- Bookings by category.
- Bookings by source.
- QR booking count/rate.
- Discount usage.
- Popular services.
- Average booking value.

Requirements:

- Scope every query to owner business ID.
- Historical values use booking snapshots.
- Legacy bookings appear under a clear “Legacy/Unassigned” group.
- Avoid loading all records into memory when SQL/Prisma aggregation is practical.

---

# 20. PUBLIC CONFIG API

Extend the public business config response safely:

```json
{
  "business": {
    "name": "Demo Salon & Spa",
    "publicCode": "opaque-code",
    "timezone": "Asia/Kolkata",
    "description": "...",
    "branding": {
      "logoUrl": "...",
      "coverImageUrl": "...",
      "primaryColor": "#...",
      "secondaryColor": "#...",
      "accentColor": "#..."
    }
  },
  "serviceCategories": [],
  "services": [],
  "pageSections": [],
  "workingHours": [],
  "staff": [],
  "featureFlags": {}
}
```

Public service pricing:

```json
{
  "originalPrice": 500,
  "discountAmount": 100,
  "finalPrice": 400,
  "discountLabel": "Festive Offer"
}
```

Never expose:

- Owner password/hash.
- Owner-only email unless explicitly configured as public contact.
- Razorpay secret.
- Twilio credentials.
- SMTP credentials.
- Cloudinary secret.
- Internal tenant IDs when not required.
- Hidden PageSections.
- Inactive services/categories.

Avoid returning duplicate secrets currently present in broad Prisma objects. Use explicit `select`/DTO mapping.

---

# 21. FRONTEND STATE AND API CLIENT

All frontend API calls go through:

```text
packages/frontend/src/lib/api.ts
```

Do not scatter raw `fetch` calls.

Update:

```text
packages/frontend/src/types/index.ts
```

for every API shape.

Extend Zustand booking state:

```text
selectedCategoryId
selectedServiceId
selectedStaffId
selectedDate
selectedTime
source
displayedPricing
```

Rules:

- Backend remains authoritative.
- Reset dependent selections when a parent changes:
  - service change resets staff/date/time/payment state;
  - staff change resets time;
  - date change resets time.
- Do not persist payment secrets or sensitive data.
- Normalize source once from URL/embed context.
- Preserve existing local-storage owner JWT behavior unless security work explicitly changes it.

---

# 22. CUSTOMER BOOKING FLOW

Update `StepRouter` using existing patterns:

```text
1. Service category and service
2. Staff, only when service.resourceMode = STAFF_BASED and staff choice is applicable
3. Date and time
4. Customer details
5. Payment, only when enabled and final price requires it
6. Confirmation
```

Behavior:

- Do not show staff selection for pooled services.
- Do not show staff selection when multi-staff is disabled.
- If staff-based and no eligible staff exists, service is unavailable with a clear message.
- If product behavior allows “Any available,” availability returns eligible staff and the backend assigns/validates one deterministically at booking time. Do not create an unassigned staff-based booking.
- Fetch availability only after service and date are known.
- Prevent duplicate submissions.
- Confirmation displays service, staff if applicable, date, time, duration, final amount, source-independent reference, and notification status where useful.

Service cards show:

- Name.
- Short description.
- Duration.
- Original price only when discounted.
- Final price.
- Real discount badge/label only when active.

Never show a fake or expired discount.

Empty states:

- No active services.
- No eligible staff.
- No slots on selected date.
- Booking window closed.
- Payment unavailable.
- Business unavailable.

Each gives a useful next action.

---

# 23. OWNER DASHBOARD

Add or extend navigation and pages:

- Services and categories.
- Staff assignments and optional hours.
- Public Page Builder.
- QR Code.
- Branding/business settings.
- Timezone and slot granularity.
- Reminder configuration.

Preserve existing pages:

- Home.
- Bookings.
- Calendar.
- Blocked slots.
- Waitlist.
- Staff.
- Payments.
- Analytics.
- Form builder.
- Notifications.
- Settings.

Responsive behavior:

- Desktop sidebar.
- Mobile header plus accessible drawer or compact navigation.
- Convert dense tables to cards on small screens or use controlled horizontal scrolling only when necessary.
- Keep actions reachable without hover.
- Confirm destructive actions.
- Use consistent loading, empty, error, and success states.

---

# 24. BRANDING AND OWNER-SPECIFIC EXPERIENCE

Each business can configure:

- Business name.
- Description.
- Logo.
- Cover.
- Primary color.
- Secondary color.
- Accent color.
- Public contact details where existing schema allows.
- Business timezone.

Use validated CSS variables rather than hard-coded per-business classes:

```text
--color-primary
--color-secondary
--color-accent
```

The existing application already uses `--color-primary`; preserve that convention and extend it consistently. Validate colors as safe color values. Apply accessible contrast and fallbacks.

The owner dashboard must show only the authenticated business identity and data. Do not create “all salons,” tenant switcher, global directory, or cross-business analytics.

The customer page necessarily displays the selected business's public brand/name, but the URL must contain only the opaque code.

---

# 25. MOBILE-FIRST DESIGN AND ACCESSIBILITY

Design priority:

```text
mobile → tablet → desktop
```

Must work on small Android phones, large phones, iPhones, tablets, and desktop.

Requirements:

- No unintended horizontal scrolling.
- Comfortable touch targets.
- Responsive cards and typography.
- Compact hero on mobile.
- Reachable/sticky booking CTA where useful.
- Horizontally scrollable category chips when necessary.
- Thumb-friendly calendar/time slots.
- Correct mobile input types.
- No modal overflow.
- Clear focus states.
- Keyboard navigation.
- Semantic landmarks/headings.
- Labels and errors connected to inputs.
- Accessible dialogs.
- Sufficient contrast.
- Do not use color alone for status.
- Respect reduced-motion preference.

Use Framer Motion sparingly. Avoid excessive gradients, glassmorphism, animation, or decorative content that slows booking.

Every async operation requires a loading/error state:

- Loading services.
- Loading availability.
- Saving settings.
- Uploading media.
- Booking.
- Processing payment.

Use skeletons only where they improve perceived performance.

---

# 26. VALIDATION AND SECURITY

Use Zod schemas for:

- Signup/login additions.
- Public-code path/query values.
- Category CRUD.
- Service CRUD.
- Staff assignments.
- Working hours.
- Page sections by type.
- Reorder payloads.
- Availability queries.
- Booking payloads.
- Reminder settings.
- Booking-management token/session and OTP requests.
- Media signatures/uploads.

Security requirements:

- Keep JWT middleware on every owner endpoint except signup/login.
- Use JWT business ID only for owner scoping.
- Scope every owner read/update/delete with both record ID and `req.owner.businessId`, including categories, services, StaffService rows, hours, PageSections, media folders, bookings, recurring groups, waitlists, and payments.
- Route all public identifier resolution through `BusinessResolver`; do not use inconsistent ad hoc `OR` lookups.
- Hash passwords with existing bcrypt conventions.
- Set strong production `JWT_SECRET`; remove or reject insecure fallback in production.
- Do not leak secrets through public config or logs.
- Sanitize or structurally restrict rich text.
- Validate URL protocols.
- Validate and limit upload types/sizes.
- Use safe error responses.
- Rate-limit signup, login, public booking, payment initiation, and media signing using a lightweight strategy compatible with deployment. Do not add Redis solely for rate limiting.
- Maintain CORS allowlist for the Vercel frontend and configured embed origins.
- Embed origin behavior must honor existing business configuration.
- Avoid logging passwords, tokens, payment signatures, or customer form data.
- Audit public `GET/PUT/DELETE /:identifier/bookings/:id`. A random booking ID is not customer authorization. Prefer a separate non-guessable customer access token or signed management token, return only the minimum safe fields, and preserve old clients through a documented deprecation path.

---

# 27. FREE DEPLOYMENT DELIVERABLES

Add deployment documentation and configuration for:

## Frontend on Vercel

- Root directory or build settings for `packages/frontend`.
- pnpm install.
- Vite build output `dist`.
- SPA fallback rewrites.
- Environment variable:

```text
VITE_API_BASE_URL=https://api-host.example
```

Refactor frontend `API_BASE` to use the environment variable with a development same-origin fallback.

## External Node API

- Build command for backend and Prisma generation.
- Start command.
- Health endpoint.
- Production CORS:

```text
FRONTEND_URL=https://frontend.vercel.app
```

- Graceful operation when optional Twilio/SMTP/Cloudinary credentials are absent.
- Do not rely on backend serving frontend files in split deployment, but preserve existing single-service static serving compatibility if inexpensive.

## Managed PostgreSQL

- `DATABASE_URL`.
- SSL/pooling guidance appropriate to selected provider.
- Production migration command.
- Seed must never overwrite production data.

## Scheduler

- Database-backed reminder jobs.
- Protected cron endpoint.
- Documentation for a free external cron service if host scheduling is unavailable.

## Required environment template

Create/update `.env.example` with placeholders only:

```text
DATABASE_URL
JWT_SECRET
JWT_EXPIRES_IN
FRONTEND_URL
FRONTEND_PUBLIC_URL
PORT
NODE_ENV

SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
SMTP_FROM_NAME

TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_WHATSAPP_FROM
TWILIO_SMS_FROM

RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET

CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
CLOUDINARY_FOLDER_PREFIX

CRON_SECRET
```

Use actual variable names consistently in code and docs. Never put real values in the repository.

State clearly:

- Frontend hosting can fit Vercel Hobby at pilot scale.
- API/DB/media use separate free tiers.
- Hosts may sleep and cold-start.
- WhatsApp/email/payment providers have their own policies and potential charges.

---

# 28. SEED DATA

Update `packages/backend/prisma/seed.ts` idempotently.

Business:

```text
Demo Salon & Spa
timezone Asia/Kolkata
opaque publicCode
realistic branding
```

Categories:

```text
Hair
Nails
Spa
```

Services:

```text
Haircut             30 min    ₹500
Hair Coloring       60 min    ₹1,500
Keratin Treatment  120 min    ₹3,000
Manicure            45 min    ₹700
Pedicure            60 min    ₹900
Head Massage        30 min    ₹500
Full Body Massage  120 min    ₹2,500
```

Include:

- Staff-based services.
- At least one pooled service with capacity 3.
- Multiple eligible staff assignments.
- Service-specific hours.
- A nonzero buffer.
- A percentage discount.
- A flat discount.
- Active and inactive service.
- PageSections.
- Branding.
- Reminder defaults.

Preserve demo login compatibility unless changing it is explicitly documented. Flag demo credentials as non-production.

---

# 29. TESTING STRATEGY

The backend already uses the Node test runner through `tsx --test` and has `AvailabilityService.test.ts`. Extend that test setup instead of introducing Vitest solely for backend tests. Add a frontend test framework only when frontend behavior cannot be adequately verified through build/type checks and focused manual tests.

Separate pure domain calculations from Prisma I/O where practical so pricing, interval overlap, period intersection, and source normalization can be tested deterministically.

Required test groups:

## Availability

- Variable duration.
- Candidate granularity.
- Staff eligibility.
- Staff availability.
- Pool capacity.
- Partial overlap in both directions.
- Surrounding intervals.
- Global/staff blocked slots.
- Service and business period intersection.
- Buffer.
- Exact closing.
- Next available.
- Timezone.
- Legacy fallback.

## Pricing

- No/percentage/flat discount.
- Future/expired discount.
- Excess discount.
- Boundary times.
- Payment minor units.

## Booking

- Valid service booking.
- Invalid/inactive/cross-tenant service.
- Invalid staff-service pairing.
- Unavailable interval.
- Client-supplied wrong price ignored/rejected.
- Snapshot fields stored.
- Source normalization.
- Reschedule excludes current booking.
- Plain booking ID cannot authorize public management.
- Correct management token can authorize the correct booking only.
- A token for Business A/Booking A cannot manage another booking or tenant.
- With OTP disabled, token-only management works.
- With OTP enabled, token without verified OTP is rejected.
- OTP expiry, single use, attempt limits, resend limits, and destination masking.

## Payment holds

- Initiation creates one 10-minute hold using server-derived values.
- Active staff hold blocks that staff interval.
- Active pooled hold consumes one unit of pool capacity.
- Expired/failed/consumed hold no longer blocks capacity.
- Client-selected payment mode and amount are ignored/rejected.
- Free service bypasses Razorpay.
- Concurrent verification produces one booking.
- Mismatched, expired, or consumed attempts are rejected or return the existing idempotent result safely.

## Multi-tenancy

- Cross-business CRUD attempts fail for every new owner resource.
- Relation assignment cannot cross businesses.

## PageSections

- CRUD.
- Type validation.
- Ordering.
- Public visibility.
- Unsafe content rejected/sanitized.

## QR/public identity

- Code generation uniqueness/format.
- Canonical URL.
- Legacy redirect.
- Query preservation.
- QR source saved.

## Signup

- Atomic workspace defaults.
- Duplicate email.
- Password hashing.
- No secret fields returned.

## Reminders

- Correct 24-hour and 2-hour scheduling.
- Idempotent send.
- Cancellation/reschedule behavior.
- Missing notification config does not fail booking.

Run and report:

```text
pnpm --filter backend test
pnpm build
```

Also run Prisma validation/generation and migration tests using the repository's actual scripts.

---

# 30. PHASED IMPLEMENTATION ORDER

Do not implement this as one uncontrolled patch. Phase 0 must first classify every phase below as Exists, Partial, Missing, or Broken. Skip completed work and focus on defects. In particular, do not recreate the schema, `BusinessResolver`, `PricingService`, `TimeService`, `ReminderService`, owner CRUD pages, or service-first booking flow when they already exist.

## Phase 0 — Baseline

- Inspect code and git status.
- Install existing dependencies if needed.
- Run current build.
- Record pre-existing failures separately.
- Map current API callers and existing behavior.

Exit criterion: baseline understood and concise plan written.

## Phase 1 — Schema and migration

- Audit the existing enhancement migration and schema.
- Add only corrective schema changes, especially reminder offset uniqueness, durable waitlist expiry, and persisted payment attempts.
- Verify compatibility fields and secure public-code backfill.
- Complete seed data only where gaps remain.
- Prisma validate/generate.
- Migration test with existing seed data.

Exit criterion: old data survives and Prisma compiles.

## Phase 2 — Backend foundations

- Audit existing public business resolver, timezone utilities, PricingService, CRUD, hours, PageSections, and media signature.
- Fix inconsistent identifier resolution and tenant scoping.
- Complete Zod validation, media ownership/deletion, and missing signup defaults.

Exit criterion: backend tests for CRUD, pricing, and isolation pass.

## Phase 3 — Availability and booking

- Audit the existing duration-aware engine, staff/pool modes, buffer, next available, snapshots, and source.
- Fix rescheduling with `excludeBookingId`.
- Correct recurring timezone/partial-success behavior.
- Replace waitlist timers with durable expiry.
- Add persisted server-side payment attempts and authoritative verification.

Exit criterion: required availability, booking, and payment tests pass.

## Phase 4 — Identity, signup, QR, reminders

- Audit existing signup, canonical opaque routes, legacy redirects, QR endpoint/UI, reminder records, and templates.
- Fix `/b/` source misclassification.
- Fix dual-offset reminder uniqueness and verify idempotent processing.

Exit criterion: signup, QR attribution, and reminder tests pass.

## Phase 5 — Owner frontend

- Audit existing Services, staff assignment/hours, Page Builder, QR, branding, timezone, and reminder UI.
- Complete missing API wiring, validation, media upload, loading/error states, accessibility, and responsive behavior.

Exit criterion: owner can configure a complete demo business without direct database edits.

## Phase 6 — Customer frontend

- Audit the existing branded page, PageSections, service-first wizard, staff/pool flow, date/time, payment, and confirmation.
- Fix behavior and complete missing mobile-first, accessibility, empty/loading/error states without rebuilding working components.

Exit criterion: complete scan-to-book flow works on mobile and desktop.

## Phase 7 — Deployment, regression, documentation

- Vercel frontend config.
- External API/DB/Cloudinary docs.
- `.env.example`.
- Build/tests.
- Existing-flow regression.
- Update `APPLICATION_CONTEXT.md`.
- Add `CHANGELOG.md` when appropriate.

Exit criterion: documented pilot deployment and all verification checks complete.

After each phase:

1. Run relevant tests.
2. Run type checking/build where practical.
3. Fix regressions before continuing.
4. Summarize changed files and remaining risks.

---

# 31. DEFINITION OF DONE

Do not claim the project is complete unless all applicable items are verified.

## Data and tenant safety

- Existing data migrates.
- Every new tenant resource is business-scoped.
- Cross-tenant tests pass.
- New URLs contain opaque codes, not salon names.
- Old slug links redirect safely.
- New public booking management requires a hashed management token.
- Owner-enabled OTP requires successful email/SMS verification in addition to the token.

## Backend

- Prisma validates and generates.
- Migration succeeds on seeded existing schema.
- TypeScript compiles.
- API starts and health endpoint works.
- Authentication and signup work.
- Existing routes remain compatible.
- New CRUD APIs work.
- Public DTOs expose no secrets.

## Scheduling

- 30-, 60-, and 120-minute services work.
- 15-minute default candidate granularity works.
- Staff and pool modes do not double count.
- Capacity and partial overlaps work.
- Service/staff/business hours intersect.
- Buffer and exact closing work.
- Server calculates end time and price.
- Active payment holds consume the correct staff/pool capacity and expire after 10 minutes.
- Race limitation remains honestly documented.

## Frontend

- Vite build succeeds.
- Login and signup work.
- Owner sees only their business.
- Services, categories, page builder, QR, branding, and reminders are configurable.
- Public code route works.
- Booking works on phone/tablet/desktop.
- Embed remains compact and postMessage-compatible.

## Payments and notifications

- Razorpay amount comes from PricingService.
- Client payment mode/amount cannot reduce the payable amount.
- Payment verification consumes one server-held attempt and creates at most one booking.
- Free services bypass external payment safely.
- Price snapshots persist.
- Mobile checkout prioritizes UPI Intent through Razorpay (no raw owner VPA).
- Paid customer cancellation initiates an idempotent source refund of `paymentAmount` with durable `PaymentRefund` status.
- Customer and owner receive accurate cancel/refund messaging (5–7 working days language).
- WhatsApp/SMTP failure does not normally invalidate booking/cancel.
- Default reminders are 24 hours and 2 hours.
- Reminder processing is restart-safe and idempotent.

## Deployment

- Frontend can deploy to Vercel as static Vite.
- API can deploy to a free Node host.
- PostgreSQL instructions exist.
- Cloudinary instructions exist.
- Environment template contains no secrets.
- Free-tier limitations are documented honestly.

---

# 32. REQUIRED FINAL REPORT

At the end of the implementation, report:

1. What was completed by phase.
2. Important architectural choices.
3. Prisma models/migrations added.
4. API endpoints added or changed.
5. Backward-compatibility behavior.
6. Tenant-isolation controls and tests.
7. Commands run and their outcomes.
8. Deployment steps and required environment variables.
9. Remaining limitations, including booking race conditions and third-party/free-tier constraints.
10. Any requirements not completed, with exact reasons.

Do not say “all tests pass” without listing the commands actually run.
Do not say “production-ready” while known limitations remain undocumented.

---

# 33. OPERATING PRINCIPLE

When a requirement is explicit, implement it.

When a minor detail is unspecified, choose the simplest safe implementation consistent with the existing code and document it.

Ask only when source inspection reveals a high-impact conflict that this specification does not resolve. Do not repeatedly stop for trivial confirmation.

The outcome must remain:

> **Scan → Choose Service → Choose Staff when applicable → Choose Time → Book → Pay with UPI apps when applicable → Receive confirmation and reminders → Cancel with automatic refund when paid.**

It must be:

- Owner-specific.
- Strictly multi-tenant.
- Mobile-first.
- Service-aware.
- Duration-aware.
- Capacity-aware.
- Timezone-aware.
- QR-friendly.
- Payment-safe.
- UPI-intent friendly on mobile.
- Refund-safe on paid cancel.
- Notification-friendly.
- Deployable at pilot scale using the specified free-tier architecture.
- Compatible with the existing Reservly application.

**Do not rebuild Reservly. Evolve Reservly safely.**

---

# 34. DEEPSEEK V4 FLASH — COPY THIS EXECUTION BRIEF FIRST

**No mandatory batch.** Batches 2 / 2A / 2B / 3 / 3A / 4 are verified complete.

If asked to do optional cleanup only:

1. Remove the dead duplicate `GET /owner/settings/status` handler later in `packages/backend/src/routes/owner.ts` (keep the Batch 4 readiness handler that returns SMTP/WhatsApp/location/frontend flags).
2. Do not reopen payments, race locks, location schema, or notification templates.
3. Run `pnpm --filter backend test`, `pnpm test:frontend`, and `pnpm build`.

For any **new** product request: add a new numbered batch section, retarget this §34, and leave completed batches alone.

## Honest remaining limitations (not open required defects)

- Twilio WhatsApp production: approved templates + customer opt-in (not fully server-enforced).
- Geolocation: HTTPS + permission.
- Reminders: no manage/cancel link (hash-only token by design).
- Concurrency: advisory locks, not DB exclusion.
- Refund timing / UPI merchant-mobile / reconciliation cron.
- Owner native/PWA app: future product decision.
