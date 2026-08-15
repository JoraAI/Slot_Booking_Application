# SlotBook — Application Context (source of truth)

This document is generated from the current codebase. Source code is authoritative
when this document differs.

## Architecture & monorepo

- **Monorepo** with pnpm workspaces:
  - `packages/backend` — Node.js + Express + TypeScript + Prisma + PostgreSQL.
  - `packages/frontend` — React 18 + Vite + TypeScript + Zustand + Tailwind CSS + Framer Motion.
- Backend single Express app: `packages/backend/src/index.ts`. Route mounting order
  is intentional: **`/api/owner` and `/api/internal` are mounted before `/api`** so the
  public `/:identifier/...` routes can never shadow the owner/internal namespaces.
- Single Prisma client (`src/lib/prisma.ts`), PostgreSQL provider.
- No Redis, no message broker, no in-memory job scheduler.

## Public identity

- Each business has an opaque, URL-safe **`publicCode`** (base64url of 32 random
  bytes stored at 96+ bits) and a legacy `slug`.
- Customer URLs use the public code: `/b/{publicCode}`. Legacy slug URLs redirect
  to the canonical code URL preserving query params.
- `BusinessResolver` resolves `publicCode` first (format-validated), then falls back
  to `slug` for compatibility. A customer URL resolves to exactly one business.
- Public routes accept `/api/{publicCode}` or `/api/{slug}` as the identifier.

## Services, categories & resource modes

- `ServiceCategory` groups active services.
- `Service` carries `durationMinutes`, `bufferMinutes`, `price`, `resourceMode`,
  `capacity`, discount fields, and optional per-service working hours.
- **Resource modes:**
  - `STAFF_BASED` — each eligible staff member is capacity one; a booking requires
    an assigned staff member (`StaffService`).
  - `POOLED` — capacity is per-service (e.g. `capacity: 3` allows three overlapping
    appointments); legacy rows with a null `serviceId` still consume pool units.
- Staff-service assignments are validated to belong to the same business.

## Duration-aware availability

- `AvailabilityService` (`computeAvailability`) is the single authoritative engine:
  - slot granularity from `Business.slotGranularityMinutes`;
  - effective periods = business hours ∩ service hours ∩ staff hours;
  - visible interval `[start, start+duration)`, occupied interval extends by buffer;
  - half-open overlap checks against CONFIRMED bookings, blocked slots, and
    **active PaymentAttempt holds**;
  - `findNextAvailable` is wired into the public availability response (`nextAvailable`)
    when the requested day has no slots;
  - all dates are business-local: stored as UTC midnight of the business-local date
    and converted via `TimeService` (IANA timezone, DST-aware).

## PaymentAttempt flow (holds)

- `POST /api/:identifier/payments/initiate`:
  - validates via strict Zod (client `amount`/`paymentMode`/`finalPrice`/`duration`/`endTime` rejected);
  - prices with `PricingService` (server-authoritative discounts);
  - payment mode comes from business config only;
  - `finalPrice = 0` bypasses Razorpay and creates a normal booking immediately;
  - otherwise a **10-minute capacity hold** is created in a transaction guarded by a
    per-slot Postgres advisory lock; availability is re-checked inside the transaction
    and active holds consume capacity;
  - a Razorpay order is created outside the DB transaction; failure marks the
    attempt FAILED (releasing capacity).
- `POST /api/:identifier/payments/verify`:
  - loads the `PaymentAttempt` scoped to the business by `razorpayOrderId`;
  - rejects missing/expired/failed/cancelled attempts;
  - verifies the signature; re-checks availability excluding the hold;
  - creates the booking **from server-held attempt data only** (never client `bookingData`);
  - conditional `PENDING → CONSUMED` transition + booking creation in one transaction,
    so repeated/concurrent verifies create at most one booking (idempotent).
- Stale holds are expired by `POST /api/internal/jobs/process-payment-expirations`
  (CRON_SECRET protected).

## Batch 2 — UPI Intent checkout + automatic refunds

- **UPI-first checkout** (`PaymentStep.tsx`): truthful primary CTA "Pay with UPI apps".
  The Razorpay Checkout is opened with a `display.blocks` config that puts a UPI
  block first (`method: 'upi'` → installed UPI apps via Razorpay UPI Intent on mobile)
  and keeps card/net-banking/wallet under "More payment options". The server-confirmed
  payable amount and the salon name (receiver branding) are shown before checkout.
  No raw "receiver UPI ID" field exists anywhere.
- **Live credentials are enforced**: enabling a live (non-test) paid checkout
  (`enablePayments` + `paymentMode !== 'none'` + `razorpayTestMode = false`) requires
  both a Razorpay Key ID and a configured (or newly set) Key Secret; `PUT /owner/config`
  rejects the save otherwise. Test mode keeps working without real keys.
- **Durable `PaymentRefund`** (migration `20260820000000_payment_refund`): one row per
  booking (`bookingId` unique). Fields: `businessId`, `razorpayPaymentId`,
  `razorpayRefundId?`, `amountMinor` (paise), `currency`, `status`
  (PENDING | PROCESSING | PROCESSED | FAILED), `failureReason?`, `initiatedAt?`,
  `processedAt?`.
- **Automatic source refund on customer cancel** (`DELETE /api/:identifier/bookings/:id/manage`):
  1. The booking is cancelled immediately (capacity freed — availability only counts
     CONFIRMED) and reminders/waitlist are processed as before.
  2. `RefundService.refundForCancelledBooking` runs only when the booking has a paid
     Razorpay payment (`razorpayPaymentId` + `paymentAmount > 0`). It is idempotent:
     an advisory lock serializes concurrent cancels, the unique `bookingId` guarantees
     one row, and a PROCESSED (or PROCESSING-with-refund-id) row short-circuits before
     any Razorpay call. FAILED/PENDING rows retry.
  3. `PaymentService.initiateRefund` now sends `{ amount, speed: 'optimum' }` — instant
     where the payment network supports it, otherwise normal banking timeline.
  4. Success → refund PROCESSED + `razorpayRefundId`, booking `paymentStatus = refunded`.
     Failure → refund FAILED + `failureReason`, booking stays CANCELLED with
     `paymentStatus = refund_failed`; the owner is notified for manual action.
  5. Deposit bookings refund only `Booking.paymentAmount` (what was collected).
  6. The cancel response is `{ success, booking, refund: { status, amount, amountMinor,
     razorpayRefundId, message } | null }` so the UI never invents state.
- **Messaging (accurate, no fixed SLA)**: customer sees "Refund initiated to your
  original payment method. It may be instant; otherwise allow 5–7 working days." on
  success, or "…the automatic refund needs the salon to complete it…" on failure.
  Owner is emailed (and WhatsApp when configured) the amount + durable refund status,
  including a manual-action alert on failure. `sendPaymentRefundConfirmation` /
  `sendPaymentRefundFailed` respect the existing notification flags.
- **Owner Payments dashboard** shows `refunded` / `refund_pending` / `refund_failed`
  statuses and the durable refund row (`paymentRefund` singular, included in
  `/owner/payments`).

## Batch 2A — verification hotfix (idempotent refunds, atomic cancel, UPI-first)

- **Idempotent refund creation**: every `PaymentRefund` owns a stable
  `idempotencyKey` (UUID, `@unique`, migration `20260821000000_payment_refund_idempotency`)
  sent as Razorpay `X-Refund-Idempotency` with a byte-identical body
  (`{ amount, speed: 'optimum', notes: { slotbook_idempotency_key: key } }`).
  Retries (network timeout, reconciliation) can never duplicate a refund; a
  Razorpay `409` is reconciled instead of re-created.
- **Atomic cancel + refund intent**: `RefundService.cancelBookingWithRefundIntent`
  cancels the booking (advisory-locked, tenant-scoped, idempotent, `cancelledAt`),
  cancels pending reminders, and creates/returns the unique `PaymentRefund` row
  in ONE DB transaction that commits BEFORE the Razorpay network call. A crash
  can never leave a paid booking cancelled with no durable refund row.
- **Every cancellation route** now uses the same orchestration: customer manage
  `DELETE`, owner `PUT /bookings/:id` with `status=CANCELLED`, and owner
  `DELETE /bookings/:id`.
- **Owner manual refund** (`POST /owner/payments/:id/refund`) goes through the
  durable pipeline too — full paid amount only, rejects any other `amount`
  (integer minor units must equal the full paid amount), and cannot duplicate an
  existing auto-refund. A `PROCESSING` row without a refund id is never
  re-initiated from a request path (only the reconciliation cron retries it with
  the same key).
- **Razorpay status mapping**: `processed` → PROCESSED / `refunded` /
  `processedAt`; `pending` → PROCESSING / `refund_pending`; `failed` → FAILED /
  `refund_failed` + `failureReason`; **absent/unknown status stays PROCESSING**
  (never claimed done — reconciliation resolves it). Durable reconciliation:
  `POST /api/internal/jobs/process-refund-reconciliation` (CRON_SECRET protected)
  fetches `/v1/payments/:id/refunds`, matches by refund id or the idempotency
  note, and retries missing refunds with the original key.
- **Legacy public booking-ID routes** (`GET/PUT/DELETE /:identifier/bookings/:id`)
  now return 410 Gone — a booking ID alone never exposes or mutates a booking.
  Frontend legacy callers were removed.
- **Notifications deduplicated**: one customer message and one owner message per
  cancellation, branching on the durable refund state (initiated / needs salon
  action); refund-failure alerts are folded into the single owner message.
- **UPI Checkout** is explicitly UPI-first: `display.sequence =
  ['block.upi','block.other']` and `preferences.show_default_blocks = false`
  (`frontend/src/widget/razorpayDisplay.ts`). The single `upi` instrument covers
  every installed app via Razorpay UPI Intent. The two-step flow shows the
  server-confirmed amount + salon name before Checkout opens, and
  `bookingData.formData` is forwarded to payment initiation so paid bookings
  keep the same custom fields as unpaid ones. No fake per-method buttons.
- **Consistency**: deposit config now requires exactly one of a fixed amount or
  a percentage (positive, % ≤ 100); the Payments dashboard "Collected" nets
  refunded/refund-pending/refund-failed transactions; `refundPolicy` is
  informational-only and cannot override the automatic full refund.

## Batch 2B — live Razorpay notes + status conservatism (§12.9, code-only)

- **Notes are a JSON object** on every live and test-mode create/retry:
  `notes: { slotbook_idempotency_key: <idempotencyKey> }` (the official Razorpay
  format). `X-Refund-Idempotency` remains the primary dedupe mechanism; the body
  stays byte-identical for a repeated key. `notesMatch` reads the object form and
  still tolerates the legacy array form.
- **Unknown/absent Razorpay status never becomes PROCESSED**: only an explicit
  `processed` maps to PROCESSED; `pending` → PROCESSING, `failed` → FAILED, and
  absent/unknown stays PROCESSING with `booking.paymentStatus = refund_pending`
  until the reconciliation cron observes the real status.

## Batch 3 / 3A — unpaid booking race serialization (§10.11)

- Every capacity-consuming slot insert runs in ONE DB transaction that acquires a
  **day-scoped resource lock** shared by unpaid/free/recurring booking creates AND
  payment-hold creation (`BookingService`):
  - POOLED services lock the **service-day**: `slot:{businessId}:{serviceId}:{date}`.
  - STAFF_BASED services lock the **staff-day**: `staff:{businessId}:{staffId}:{date}`
    (auto-assign resolves the staff via a first availability pass, then locks, then
    re-checks authoritatively).
- Inside the lock the path re-loads authoritative data, re-runs availability for the
  exact interval, and inserts only if still available — a losing request fails with a
  clean `Slot is no longer available` conflict and no partial write.
- Widening the lock from the per-`startTime` key (Batch 3) to day-scoped resource
  keys (Batch 3A) closes two remaining races:
  - **Overlapping starts**: creates at 10:00 and 10:15 for a 30-minute service now
    serialize (they previously used different keys and could both pass).
  - **Shared staff**: creates for the same staff member across two services on the
    same day now serialize on the staff-day key.
- The payment-hold path uses the same keys, so an unpaid booking and a hold for the
  same service-day/staff-day can never both pass their re-checks.
- Acceptance tests: concurrent same-slot creates (pooled capacity 1 and staff),
  overlapping-start creates, shared-staff creates across services, and an unpaid
  create vs payment-hold initiate all produce exactly one success + one clean
  conflict; non-overlapping creates both succeed; the HTTP layer surfaces one
  201 + one 400.

## Batch 4 — salon location + confirmation notifications (§18.1) — COMPLETE

- **Salon location** on `Business` (`address` ≤ 500, optional `latitude`/`longitude`
  pair with bounds; migration `20260822000000_business_location`). Validated on
  `PUT /owner/config`. No Maps API key/Places/geocoding.
- **Directions links** are generated server-side by `LocationService.directionsUrl`:
  coordinates preferred (`https://www.google.com/maps/dir/?api=1&destination={lat},{lng}`),
  address fallback (URI-encoded), null when empty. Public config exposes a safe
  `location` object; customer manage view includes it too.
- **Owner Settings** has a Location card (address, editable lat/lng, “Use my
  current location” via `navigator.geolocation` with secure-context/permission/
  timeout/unsupported errors, map-preview link, clear). The geolocation error
  mapping is a testable helper (`frontend/src/dashboard/geolocation.ts`).
- **Customer surfaces**: confirmation screen and manage page show address + a
  Google Maps **Get directions** link when a location exists.
- **Confirmation email/WhatsApp** (respect notify flags) include salon address,
  directions link, and the one-time `managementUrl` labelled **View or cancel
  booking** (reschedule stays disabled/405). Customer emails set
  `replyTo = ownerEmail`; WhatsApp bodies carry the salon `ownerWhatsapp` as a
  `wa.me` contact link — the salon number is **never** used as the Twilio `From`.
  Templates HTML-escape user-controlled values.
- **Reminders** include location/directions only — they never recreate the
  manage/cancel token (only `managementTokenHash` is stored).
- **Prerequisite enforcement**: `PUT /owner/config` refuses *enabling*
  `notifyCustomerEmail` without SMTP and `notifyCustomerWhatsapp` /
  `notifyOwnerWhatsapp` without Twilio WhatsApp + an owner WhatsApp number
  (same pattern as OTP guards; a flag already true is left alone). Readiness is
  reported by `GET /owner/settings/status` and surfaced in Settings/Notifications;
  the test-send endpoint now reports real per-channel success/failure.

## Management tokens + optional OTP

- Every new booking gets a 256-bit random management token; only its **SHA-256 hash**
  is stored (`Booking.managementTokenHash`). The plaintext and a management URL
  (using the public code) are returned exactly once at creation.
- Customer management endpoints: `/api/:identifier/bookings/:id/manage/session`,
  `.../manage/otp/request`, `.../manage/otp/verify`, and session-authenticated
  `GET/PUT/DELETE .../manage`. Booking ID alone never authorizes.
- OTP (default off): `Business.bookingManagementOtpEnabled` + channel (EMAIL | SMS | EITHER).
  Single-use 10-minute codes, attempt/resend/IP limits, masked destinations, hashed
  codes. Enabling a channel whose provider is unconfigured is refused at save time.
- Short-lived booking-scoped sessions (`BookingManagementSession`).

## Durable reminders & waitlist expiry

- **Reminders**: `BookingReminder` rows keyed by `(bookingId, channel, reminderType, offsetMinutes)`
  (defaults 1440/120 minutes), sent by `POST /api/internal/jobs/process-reminders`.
  Idempotent + retry-limited; rescheduling cancels/rebuilds reminders.
- **Waitlist**: notified entries carry `expiresAt` (30 min). Expiry is **DB-backed**,
  processed by `POST /api/internal/jobs/process-waitlist-expirations`; cascading to the
  next entry only after an authoritative availability check for that service/staff.
  No in-process timers.
- All internal jobs require `CRON_SECRET` (constant-time comparison), never exposed
  to the frontend.

## Tenant isolation

- Every owner route scopes queries by `req.owner.businessId` (JWT).
- Public identifiers resolve to exactly one business; a session/token for business A
  can never manage business B (enforced in the manage routes).
- Staff-service assignments, OTP/session rows, payment attempts, and reminders are
  business/booking scoped. See `TenantIsolation.test.ts`.

## Embedding

- `Business.embedAllowedOrigins` allowlist: when non-empty, requests carrying an
  Origin/Referer are allowed only for listed origins (plus the platform's own
  FRONTEND_URL). Empty allowlist keeps the historical permissive behavior.
- Standalone direct/QR booking is never blocked.

## Environment variables

See `packages/backend/.env.example`. Key variables: `DATABASE_URL`, `JWT_SECRET`,
`CRON_SECRET`, `FRONTEND_URL`, `FRONTEND_PUBLIC_URL`, SMTP (`SMTP_USER`/`SMTP_PASS`),
Twilio (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_WHATSAPP_FROM`/`TWILIO_SMS_FROM`),
Razorpay (`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`), Cloudinary
(`CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`).

## Free-tier deployment shape

- **Frontend**: Vercel (static React build; `/api` proxied to the backend, or
  `FRONTEND_URL`/`FRONTEND_PUBLIC_URL` pointed at the API host).
- **External Node API**: the backend on a host that can stay awake (or accept
  cold starts); serves `/api` and the built frontend statics in single-service mode.
- **Managed PostgreSQL**: any managed Postgres (e.g. Neon, Supabase, RDS).
- **Cloudinary**: optional media uploads via the signed-upload endpoint
  (`POST /api/owner/media/signature`); the secret never leaves the server.
- **Scheduler**: a free cron service calling the internal jobs
  (`process-reminders`, `process-waitlist-expirations`, `process-payment-expirations`,
  `process-refund-reconciliation`) with `CRON_SECRET`.

## Known limitations (honest)

- **Refund timing**: refunds use Razorpay speed `optimum` — instant where the network
  supports it (e.g. UPI), otherwise the normal banking timeline (5–7 working days).
  The UI/docs never promise a fixed 1–2 day SLA.
- **Live UPI Intent**: installed-UPI-app checkout requires a mobile browser and a
  Razorpay account with the UPI methods/apps enabled (merchant-level configuration);
  a desktop visitor falls back to Razorpay's hosted options.
- **Manual refund action**: if Razorpay refund initiation fails the booking stays
  cancelled and the owner must complete the refund in the Razorpay dashboard (the
  `PaymentRefund.status = FAILED` row keeps the audit trail).
- **Reconciliation latency**: `pending` or absent/unknown refunds stay `PROCESSING`
  until the `process-refund-reconciliation` cron tick observes the updated Razorpay
  status; without the cron the row remains PROCESSING (never falsely marked done).
- **Slot-race protection is advisory-lock based (no DB exclusion constraint)**:
  unpaid/free/recurring booking creates and payment-hold creates serialize on
  day-scoped resource locks — `slot:{businessId}:{serviceId}:{date}` for POOLED,
  `staff:{businessId}:{staffId}:{date}` for STAFF_BASED (Batch 3/3A). This closes
  identical-slot, overlapping-start, and shared-staff races for all in-app paths.
  The lock is per business-day/resource (coarse but correct); direct out-of-band
  DB writes would bypass it, and a database exclusion constraint was deliberately
  not added.
- **Twilio WhatsApp production readiness**: live WhatsApp needs an approved
  business-initiated template and explicit customer opt-in; free-form sandbox
  messages are development-only. The platform guard checks Twilio configuration
  and an owner number, not template approval.
- **Free hosts may sleep**: reminders, waitlist expiry, and payment-hold expiry
  depend on the external cron; without it, reminders/expiry stall (holds still stop
  consuming capacity because availability filters `holdExpiresAt > now`).
- **Management token in query string**: the token appears in the management URL
  (`?token=...`), which is a referrer/log risk; the customer page keeps it in memory
  only. Moving to session/header exchange is future polish.
- **Third-party costs**: WhatsApp/SMS/email (Twilio, SMTP) and payments (Razorpay)
  are real external services with per-message/transaction costs. WhatsApp production
  requires approved templates and an explicit customer opt-in (Batch 4 prerequisites).
