# DeepSeek-V4 Prompt — WhatsApp Multi-Tenant Wallet Migration

**How to use:** Paste this entire file into DeepSeek-V4 with repo access.  
**Product name in code:** Reservly (repo: Slot_Booking_Application). Treat “SlotBook” in requirements as this app.

---

## Token-efficiency rules (mandatory)

1. **Read first, edit second.** Skim listed files; do not dump whole files into context unless needed.
2. **Prefer `rg` / targeted reads** over reading entire packages.
3. **Reuse existing patterns** (Prisma, owner JWT auth, Razorpay verify, `encryptSecret`, `NotificationService`, owner routes). Do not invent parallel stacks.
4. **Small PRs of work:** schema → services → routes → UI → tests. Commit-quality diffs; no drive-by refactors.
5. **Do not rewrite** booking, availability, payment holds, or SMTP email flows.
6. **Answers to the human:** short status updates; put detail in code + this doc’s checkboxes.
7. **If stuck on Meta Embedded Signup:** implement wallet + central send path + LEGACY credential path first; document Embedded Signup as a known limitation with a stub “Connect” UX. Do not fake Meta APIs.

---

## Role

Senior full-stack engineer. Incremental migration: centralized platform WhatsApp control + per-tenant number identity + prepaid wallet with hard spend limits. **No greenfield rewrite.**

---

## CURRENT architecture (inspect these — do not assume)

### Tenant model
- Tenant = `Business` (`packages/backend/prisma/schema.prisma`).
- Owner auth: JWT on `/api/owner/*` (`businessId` from token — **never** trust client `businessId`).
- Public booking: `/api/:identifier` via `publicCode` / `slug` (`BusinessResolver`).

### WhatsApp today (per-salon DIY Meta)
- Fields on `Business`: `metaWhatsappPhoneNumberId`, `metaWhatsappBusinessAccountId`, `metaWhatsappAccessTokenEnc`, `metaWhatsappTemplateUtility`, `metaWhatsappTemplateMarketing`.
- Resolve: `packages/backend/src/services/notificationCredentials.ts` → `resolveMetaWhatsapp()` (DB + env fallback `META_WHATSAPP_*`).
- Encrypt: `secretCrypto.encryptSecret` / `decryptSecret`.
- Send: `NotificationService.sendWhatsApp` (Meta Cloud API Graph `v20.0`, text / template / image / CTA).
- UI: `Settings.tsx` + `SetupGuide.tsx` ask owners for Phone Number ID + Access Token.
- Toggles: `notifyCustomerWhatsapp`, `notifyOwnerWhatsapp`.
- Custom msgs: `CustomerNotification` + owner `/notifications/send*`.
- **No Meta webhook route today.** Reminders: DB `BookingReminder` + `POST /api/internal/jobs/process-reminders` (`CRON_SECRET`).
- Confirmations: **sync** after booking create (`public.ts`, `PaymentFlowService`) via `sendBookingConfirmation` — keep booking success independent of WhatsApp success.

### Money / payments today
- Money often stored as `Float` / `Int` INR (legacy). **New wallet must use integer paise (minor units) or Prisma `Decimal` — never float for wallet.**
- Platform subscription Razorpay: env `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — `owner.ts` `/subscription/pay` + `/subscription/verify` (HMAC signature). **Reuse this pattern for wallet recharge.**
- Per-salon booking Razorpay: business keys — unrelated to wallet; do not mix.

### Gaps vs target
- No wallet / ledger / reservation.
- No message cost pricing table.
- No billable WhatsApp message history with provider IDs.
- No Meta Embedded Signup; owners paste tokens.
- No platform admin UI for pricing (may add internal routes protected by secret/admin if no admin role exists — check before inventing users).

---

## TARGET architecture (one sentence)

**Platform owns Meta app + send pipeline; each Business connects its WhatsApp number (or LEGACY tokens during migration); each Business has a prepaid wallet; every billable WhatsApp send reserves → Meta → finalize/release; insufficient credits = hard stop (no Meta call, no charge).**

```text
Business → Wallet (paise) + WhatsAppConfig
                ↓
     NotificationService (central)
                ↓
   reserve → Meta Cloud API (tenant phone_number_id) → finalize/release
```

---

## Non-negotiables

| Rule | Detail |
|------|--------|
| Hard limit | Balance &lt; cost → status `INSUFFICIENT_CREDITS`, no Meta call, no debit |
| Reserve before send | Concurrent sends cannot overspend (row lock / version / atomic update) |
| No negative balance | Ever |
| Idempotent recharge | Unique Razorpay payment/order id → one `RECHARGE` ledger row |
| Server-side pay verify | Never credit from frontend “success” alone |
| Tenant isolation | All reads/writes scoped by `req.owner.businessId` |
| Secrets | Never return tokens to frontend; encrypt at rest; never log tokens |
| Bookings | Always succeed even if WhatsApp fails / wallet empty |
| Email | Independent of WhatsApp wallet |
| Pricing | DB-configurable; no hard-coded Meta rates in send logic |
| Legacy | Keep existing Meta fields; mark `connectionMode=LEGACY` until reconnect |

---

## Suggested schema (adapt names to Prisma conventions)

Use **integer paise** (`Int`) for wallet amounts unless project already uses `Decimal` for money — prefer Int paise for atomic SQL.

```text
WhatsAppConfig          1:1 Business
  phoneNumberId, wabaId, displayPhone, status, connectionMode (LEGACY|EMBEDDED|DISCONNECTED)
  accessTokenEnc (nullable if platform token used), enabled, metadata Json

Wallet                  1:1 Business
  balancePaise Int, currency "INR", status, version Int, lowBalanceThresholdPaise

WalletTransaction       immutable ledger
  type: RECHARGE|WHATSAPP_CHARGE|REFUND|REVERSAL|ADJUSTMENT|RESERVATION|RESERVATION_RELEASE
  amountPaise, balanceBeforePaise, balanceAfterPaise, status, referenceType, referenceId
  providerPaymentId @unique (nullable), description, metadata

WhatsAppPricing         admin-managed
  country, currency, category (UTILITY|MARKETING|SERVICE|...), pricePaise
  effectiveFrom, effectiveTo?, active

WhatsAppMessageLog
  businessId, bookingId?, customerId?, toPhone, category, template?
  costPaise, reservationTxId?, providerMessageId?, status, failureReason
```

Migration: for each existing Business with Meta fields → create `WhatsAppConfig` (LEGACY) + `Wallet` balance 0. Do **not** gift credits.

---

## Backend implementation map

| Concern | Reuse / create |
|---------|----------------|
| Credentials | Extend `notificationCredentials.ts`; prefer tenant `WhatsAppConfig` + optional platform system token from env |
| Send path | Gate **all** WhatsApp in `NotificationService.sendWhatsApp` through wallet reserve/finalize |
| Events | confirmation, cancellation, reminder (`ReminderService.processDue`), waitlist, custom, owner alerts — same gate |
| Wallet service | new `WalletService.ts`: getOrCreate, reserve, finalize, release, recharge, adjust |
| Recharge | Mirror `/owner/subscription/pay` + `/verify` → `/owner/whatsapp-wallet/recharge` + `/verify` using **platform** Razorpay keys |
| Pricing | `WhatsAppPricingService.getPricePaise(category, country)` |
| Webhooks | Optional Phase-B: `POST /api/webhooks/meta-whatsapp` — map `phone_number_id` → Business; update `WhatsAppMessageLog`; validate Meta signature |
| Internal jobs | Reminders already async — check wallet **at send time**, not at schedule time |
| Admin pricing | If no admin role: `INTERNAL` route with `CRON_SECRET` or env `PLATFORM_ADMIN_SECRET` + document; or seed pricing via migration |

**Env (platform):** `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_API_VERSION`, existing `META_WHATSAPP_*` fallbacks, `RAZORPAY_*` for wallet top-ups.

**Remove from salon UX (primary path):** asking for Phone Number ID / Access Token. Keep LEGACY edit behind “Advanced / Migration” only if needed.

---

## API sketch (follow existing `/owner/*` style)

```text
GET  /owner/whatsapp/status
POST /owner/whatsapp/connect          # Embedded Signup or OAuth exchange — stub if blocked
POST /owner/whatsapp/disconnect

GET  /owner/whatsapp-wallet
GET  /owner/whatsapp-wallet/transactions
POST /owner/whatsapp-wallet/recharge  # create Razorpay order
POST /owner/whatsapp-wallet/verify    # signature + credit ledger (idempotent)

GET  /owner/whatsapp/messages         # usage history
```

Derive `businessId` from auth only.

---

## Frontend map

| Page | Change |
|------|--------|
| `Settings.tsx` / `SetupGuide.tsx` | Replace DIY Meta token form with Connect WhatsApp + wallet credits CTA |
| New or `Notifications.tsx` section | Balance, Add credits, usage, low-balance banner, transaction list |
| `SubscriptionPage.tsx` | Do not conflate SaaS subscription with WhatsApp wallet |
| `api.ts` | New client methods |

Copy tone: “WhatsApp notifications use prepaid credits. Estimated remaining ≈ balance ÷ current utility price (not a guarantee).”

---

## Critical flows (implement exactly)

### Send
```text
enabled? → resolve price → reserve(paise) → Meta send →
  ok: finalize charge + log ACCEPTED + providerMessageId
  fail before accept: release reservation + log FAILED
insufficient: log INSUFFICIENT_CREDITS, return (no throw into booking)
```

### Recharge
```text
auth business → min amount check → Razorpay order → client pay →
verify signature → upsert by razorpay_payment_id → RECHARGE tx → balance +=
```

### Concurrency test (required)
`balancePaise=20`, two parallel reserves of `12` → one succeeds, one fails; final balance ≥ 0.

---

## Phases (execute in order)

1. **Docs** — keep this file; add short `docs/whatsapp-wallet-architecture.md` (CURRENT/TARGET/migration only, &lt;200 lines).
2. **Prisma migration** — models above + backfill wallets/configs.
3. **WalletService + tests** — ledger, reserve, concurrency, idempotent recharge.
4. **Wire NotificationService** — all WhatsApp paths.
5. **Owner APIs + Razorpay recharge**.
6. **Frontend** — connect UX + wallet UI; strip primary DIY token UX.
7. **Meta connect** — Embedded Signup if feasible; else LEGACY + clear limitation.
8. **Webhook** (optional) — status updates only; do not auto-refund on delivery failure.
9. **Run existing tests** + new wallet/WhatsApp tests; fix regressions.

---

## Acceptance checklist

- [ ] Booking/cancel/reminder/custom WhatsApp all wallet-gated  
- [ ] Empty wallet → no Meta call; booking still works; email still works  
- [ ] No negative balance; concurrency safe  
- [ ] Recharge idempotent; server-verified  
- [ ] Tokens never in API JSON / logs  
- [ ] Tenant isolation tests  
- [ ] Legacy businesses migrated to Wallet=0 + LEGACY config  
- [ ] Pricing configurable without code change  
- [ ] Low-balance dashboard warning (email/in-app, not WhatsApp)  
- [ ] Deployment notes: new env vars in `.env.example` + `DEPLOYMENT.md`  

---

## Known Meta limitation (document, don’t invent)

Meta may require Business verification + WhatsApp Embedded Signup / Tech Provider setup for true “Connect WhatsApp” without pasting tokens. If the repo has no Tech Provider assets, ship wallet + send gating + LEGACY migration first; expose Connect as guided OAuth/Embedded when credentials allow.

---

## Final report (when done — concise)

Architecture deltas · key files · migrations · APIs · wallet reserve mechanics · payment idempotency · security · tests run · migration for existing salons · env/deploy · known limitations.

**Stop condition:** Do not expand scope into SMS, voice, full redesign, or subscription plan changes.
