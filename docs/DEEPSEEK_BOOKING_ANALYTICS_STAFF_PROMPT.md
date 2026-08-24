# DeepSeek-V4-Flash Prompt — Booking detail, Analytics Excel export, Staff salary

**Use:** Paste into DeepSeek-V4-Flash with repo access. Product: **Reservly**.

---

## Token rules (mandatory)

1. `rg` + targeted reads only. No whole-package dumps.
2. Reuse existing owner JWT routes, `Bookings.tsx`, `Analytics.tsx`, `Staff.tsx`, `api.ts`, Prisma patterns.
3. Small batches: schema → API → UI. No drive-by refactors. No WhatsApp/auth/payment rewrites.
4. Short status to human; checkboxes below for detail.

---

## Locked product decisions (do not re-ask)

| # | Feature | Spec |
|---|---------|------|
| 1 | Booking detail | Owner clicks a booking row → **detail view** with full fields + **Back** to list. Preserve status actions on detail (or list). |
| 2 | Analytics Excel | Analytics page: **From** + **To** date pickers (owner-selected range) + **Download Excel** for that range. |
| 3 | Staff salary | Optional **salary** on workers (`Staff`). Nullable; owner can set/edit/clear in Staff UI. |

---

## CURRENT (inspect — do not invent)

- List UI: `packages/frontend/src/dashboard/pages/Bookings.tsx` — table only; **no** row → detail.
- Detail API already exists: `GET /api/owner/bookings/:id` in `owner.ts` (`include: { staff: true }`). Prefer reuse; enrich DTO if missing service/formData/payment.
- Analytics UI: `Analytics.tsx` — preset ranges only (`today`/`7d`/`30d`/…). API: `getAnalytics({ dateFrom, dateTo })` + `AnalyticsService`.
- Staff: `Staff.tsx` + `Staff` model (`name`, `role`, `phone`, `email`, `color`, `isActive`) — **no salary**.
- Routes: check `App.tsx` / dashboard router for how Bookings is mounted.

---

## TARGET

### A) Booking detail + Back

- Clicking a list row (not the action buttons) opens detail.
- Prefer lightweight in-page state **or** route `/dashboard/bookings/:id` — pick one; if route, register it and use `navigate(-1)` / explicit Back to list.
- Detail shows at least: customer name/phone/email, service, staff, date, start/end, status, price fields, paymentStatus/amount, source, formData (readable), booking id.
- **Back** returns to list (keep filter if possible).
- Do not break Complete / No Show / Cancel.

### B) Analytics date range + Excel download

- Add **From** / **To** `<input type="date">` (or existing date UI pattern). Selecting custom range loads analytics for that window (appointment `date`).
- Keep preset dropdown optional; custom from/to overrides or sits beside presets.
- **Download** button → file for bookings (and useful related columns) in `[dateFrom, dateTo]` for the authenticated business only.
- Format: real `.xlsx` if adding one small dep is OK (`exceljs` or `sheetjs`); else **CSV** with `text/csv` + `.csv` filename (Excel opens it). Prefer **server-generated** download via owner route so large ranges stay auth-scoped.
- Suggested endpoint: `GET /api/owner/analytics/export?dateFrom=&dateTo=` → attachment. Cap rows reasonably (e.g. 5k) with clear error if over.
- Columns (min): date, startTime, endTime, status, customerName, customerPhone, customerEmail, service, staff, finalPrice, paymentStatus, source, bookingId.
- Validate `dateFrom <= dateTo`; timezone = business timezone for day bounds (reuse AnalyticsService date logic).

### C) Optional staff salary

- Schema: `Staff.salary` `Float?` (or `Int?` paise — prefer **INR Float nullable** to match existing `finalPrice` style) + migration.
- Owner create/update staff accepts optional `salary`; omit/null = no salary.
- Show in Staff list/form; allow clear.
- Do **not** expose salary on public booking APIs / public config DTO. Strip in public `config` if staff is returned.
- Include in owner `me` / staff CRUD responses only.

---

## Non-negotiables

| Rule | Detail |
|------|--------|
| Auth | All new owner routes use existing owner JWT; `businessId` from token only |
| Scope | Owner dashboard only |
| Public leak | Never return `salary` on public routes |
| No rewrite | Don’t refactor calendar/payments/WhatsApp |

---

## Implementation order

1. [ ] Staff `salary` migration + owner CRUD + Staff UI (hide from public DTO)
2. [ ] Booking detail view + Back (`Bookings.tsx` + reuse `GET /bookings/:id`)
3. [ ] Analytics from/to pickers + export endpoint + Download button
4. [ ] Smoke: list→detail→back; export opens in Excel; salary save/clear; public config has no salary

---

## Done when

- Owner can open booking detail and go Back.
- Analytics has from/to pickers and downloads a spreadsheet for that range.
- Staff can optionally store salary; public APIs never leak it.
