# DeepSeek-V4-Flash Prompt — Owner Google Sign-In + Email OTP Signup / Forgot Password

**How to use:** Paste this entire file into DeepSeek-V4-Flash with repo access.  
**Product:** Reservly (repo: Slot_Booking_Application).  
**Do not implement customer booking / manage-booking OTP changes.** Owner dashboard auth only.

---

## Token-efficiency rules (mandatory)

1. **Read first, edit second.** Use `rg` / targeted reads; do not dump whole packages into context.
2. **Reuse existing patterns:** Prisma, `hashOwnerPassword` / `verifyOwnerPassword`, JWT on `/api/owner/*`, `BookingManagementService` OTP hashing/rate limits, `NotificationService` + `resolveSmtp`, `LoginPage.tsx`.
3. **Small incremental batches:** schema → auth OTP service → routes → frontend → tests. No drive-by refactors.
4. **Do not rewrite** booking, payments, WhatsApp wallet, or per-salon SMTP notification flows.
5. **Short status updates** to the human; detail lives in code + checkboxes below.
6. If Google GIS verification is blocked locally, still ship backend token verify + UI button wired to `GOOGLE_CLIENT_ID`; document env setup clearly.

---

## Role

Senior full-stack engineer. Add **Google Sign-In** and **email OTP** for **owner** signup + forgot-password, without breaking existing email/password logins.

**Important:** Much of this work may already exist in the working tree. **Verify against this prompt first**, then only fix gaps / bugs. Do not re-implement from scratch.

---

## Product decisions (locked — do not re-ask)

| Topic | Decision |
|-------|----------|
| OTP when | **Signup email verify** + **forgot-password reset** only |
| Normal login | **Password-only** (existing accounts unchanged). No OTP on every login |
| Signup order | **(1) email → (2) OTP → (3) business name + timezone + password → create workspace** |
| Google UI | Web dashboard `LoginPage` only; Google Identity Services / credential button; env placeholders |
| Google + existing email | **Auto-link** same `ownerEmail` (case-insensitive) and issue JWT |
| New Google user | After Google OK → **Complete signup** step (name + timezone) → create business (no password required yet) |
| Google-only later | Settings: allow **set a password** so email/password login works too |
| OTP defaults | 6-digit, ~10 min TTL, rate-limited resend, hash at rest (never store plaintext) |
| OTP email transport | **Platform SMTP from env only** (`SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM_NAME`). Do **not** use salon Settings SMTP for auth emails |
| Scope | Owner dashboard only |

---

## VERIFICATION STATUS (2026-08-23) — start here

### Already implemented (do not recreate)

| Area | Location / notes |
|------|------------------|
| Schema | `Business.ownerPassword` nullable; `googleSub` unique; `emailVerifiedAt`; model `OwnerAuthOtp` |
| Migration | `packages/backend/prisma/migrations/20260904000000_owner_google_otp/` (**must** stay after `20260903_*`; do not reuse `20260902000000_*` — that timestamp is taken by WhatsApp pricing) |
| OTP service | `OwnerAuthOtpService.ts` — hash, TTL, attempts, cooldown, platform SMTP via `sendOtpEmail(..., undefined)` |
| Google verify | `GoogleTokenVerifier.ts` — JWKS + audience/`email_verified` checks (no `google-auth-library` required) |
| Signup API | `POST /auth/signup/request-otp`, `/verify-otp`; `POST /signup` requires `signupToken` (no unverified create) |
| Forgot API | `POST /auth/forgot/request-otp` (generic ok), `/verify-otp`, `/reset` |
| Google API | `POST /auth/google`, `POST /auth/google/complete` |
| Login null password | Clear `NO_PASSWORD` message; existing hashed passwords still work |
| Set password | `POST /owner/password/set` + Settings UI when `passwordSet === false` |
| Frontend | `LoginPage.tsx` multi-step signup / forgot / Google; `VITE_GOOGLE_CLIENT_ID` in frontend `.env.example` |
| DTO flags | `passwordSet`, `googleLinked` on owner me |
| Tests | `OwnerAuthOtp.test.ts`, `GoogleTokenVerifier.test.ts` (11/12 passed when Neon briefly woke; OA-1 flaked on P1001) |

### Bugs already fixed in-repo (do not reintroduce)

1. **`/auth/google/complete` was nested inside `/auth/google`** — complete handler only registered after a new-user Google hit. Handlers must be **sibling** top-level `publicRouter.post(...)` registrations.
2. Migration folder renamed to **`20260904000000_owner_google_otp`** to avoid colliding with `20260902000000_whatsapp_pricing_2x_markup`.
3. `embedOriginGuard` must skip identifier **`auth`** (same as `signup`).
4. Owner-auth OTP email copy should not say “Verify your booking” when `business` is omitted.

### Remaining checklist for DeepSeek (fix / harden only)

1. [ ] Confirm `public.ts`: `/auth/google` and `/auth/google/complete` are **separate** routes; new-user path issues `googleSignupToken` inside `/auth/google` only.
2. [ ] Prefer registering **all** `/auth/*` routes **before** any `/:identifier/*` routes (defensive Express ordering).
3. [ ] If `existing.googleSub` is set and **≠** incoming `sub`, reject with 409 (do not silently log in under a mismatched Google account).
4. [ ] Run `prisma migrate deploy` + `OwnerAuthOtp` / `GoogleTokenVerifier` tests when Neon is reachable; re-run any single flake caused by P1001.
5. [ ] Manual smoke: legacy email+password login; OTP signup; forgot password; Google new + Google auto-link; Settings set-password.
6. [ ] Ensure production/backend env has platform `SMTP_*` + `GOOGLE_CLIENT_ID`; frontend has matching `VITE_GOOGLE_CLIENT_ID`.
7. [ ] Do **not** invent a second auth stack or add Apple/Facebook.

---

## CURRENT architecture (inspect — do not invent)

### Auth baseline (pre-feature)
- Tenant = `Business` (`packages/backend/prisma/schema.prisma`).
- Login: `POST /api/owner/login` — email + password → JWT `{ businessId, email }`.
- Legacy signup created business immediately — **replaced** by OTP-gated `POST /signup` + `signupToken`.
- Password change (logged-in): `PUT /api/owner/password`.
- UI: `packages/frontend/src/dashboard/pages/LoginPage.tsx`.
- API client: `packages/frontend/src/lib/api.ts`.

### Reuse for OTP
- Patterns from `BookingManagementService` (SHA-256, attempts, TTL, consume-once). **Separate table** `OwnerAuthOtp` (not `BookingManagementOtp`).
- Email: `NotificationService.sendOtpEmail` with **no business** → `resolveSmtp()` uses **env platform SMTP**. Fail closed 503 if SMTP missing.

### JWT / uniqueness
- One business per `ownerEmail` (case-insensitive). Keep that invariant.
- Existing JWTs and password hashes must keep working after migration.

---

## TARGET behavior (spec)

### A) Email signup
1. `POST /auth/signup/request-otp` `{ email }` → 409 if registered; else send OTP.
2. `POST /auth/signup/verify-otp` `{ email, code }` → `{ signupToken }` (~30 min, `typ=owner_signup`).
3. `POST /signup` `{ signupToken, name, timezone, ownerPassword }` → create workspace + JWT.
4. No unverified email account creation.

### B) Login
- Keep `POST /api/owner/login` password-only for existing rows.
- If `ownerPassword` is null: instruct Google or Forgot password / set password.

### C) Forgot password
1. Request OTP (generic response; send only if account exists).
2. Verify → `resetToken` (`typ=owner_password_reset`).
3. Reset with new password (works for Google-linked too).

### D) Google Sign-In (GIS)
1. Frontend: GIS button; send ID token as `credential`.
2. Backend: verify JWKS / audience / `email_verified` against `GOOGLE_CLIENT_ID`.
3. Existing email → auto-link `googleSub` + JWT; mismatched `googleSub` → 409.
4. New email → `needsSignupCompletion` + `googleSignupToken` → complete with name + timezone (`ownerPassword` null).
5. Env: backend `GOOGLE_CLIENT_ID`; frontend `VITE_GOOGLE_CLIENT_ID` (same OAuth client).

### E) Settings — set password
- `POST /owner/password/set` when no password yet.
- `PUT /owner/password` when password already set (require current).

---

## Schema (canonical)

```prisma
ownerPassword     String?   // nullable for Google-only; EXISTING rows stay non-null
googleSub         String?   @unique
emailVerifiedAt   DateTime? // null = legacy trusted

model OwnerAuthOtp {
  id              String   @id @default(cuid())
  email           String
  purpose         String   // 'SIGNUP' | 'PASSWORD_RESET'
  codeHash        String
  expiresAt       DateTime
  attempts        Int      @default(0)
  maxAttempts     Int      @default(5)
  consumedAt      DateTime?
  requesterIp     String?
  createdAt       DateTime @default(now())
  @@index([email, purpose, createdAt])
}
```

Migration folder: **`20260904000000_owner_google_otp`** (non-breaking `DROP NOT NULL` on `ownerPassword`).

---

## Non-negotiables

| Rule | Detail |
|------|--------|
| Existing password login | Must keep working with no OTP step |
| No plaintext OTP in DB | Hash only |
| Platform SMTP for auth | Env SMTP only; salon SMTP untouched |
| Verify Google server-side | Never trust client email without verifying ID token |
| One email → one business | Case-insensitive email uniqueness |
| Rate limits | Per email + per IP on OTP request/verify |
| JWT shape | Still `{ businessId, email }` |
| Route registration | Never nest `publicRouter.post` inside another route handler |

---

## Files (expected)

- `packages/backend/prisma/schema.prisma` + `migrations/20260904000000_owner_google_otp/`
- `OwnerAuthOtpService.ts`, `GoogleTokenVerifier.ts` + tests
- `packages/backend/src/routes/public.ts`, `owner.ts`
- `NotificationService.ts` (OTP email; platform path)
- `packages/backend/.env.example`, `packages/frontend/.env.example`
- `LoginPage.tsx`, `Settings.tsx`, `api.ts`, types
- Brief note in `DEPLOYMENT.md` / `APPLICATION_CONTEXT.md` if already touched

---

## Out of scope

- Customer booking / manage-booking OTP redesign  
- Apple / Facebook login  
- Changing salon notification SMTP behavior  
- Forcing existing users to re-verify email  
- Rewriting WhatsApp wallet / pricing work in the same PR unless fixing a merge conflict  

---

## Done when

- Existing owner can still `email + password` → dashboard with zero extra steps  
- New signup cannot create a business without OTP verify  
- Forgot password works via OTP → new password → login  
- Google button works with valid client IDs; new users complete name/timezone; same-email auto-link  
- Google-only can set password in Settings  
- Auth OTP emails use env platform SMTP only  
- `/auth/google` and `/auth/google/complete` are correctly registered siblings  
- Migration timestamp does not collide with WhatsApp migrations  
- Auth tests pass when DB is reachable  
