# DeepSeek-V4-Flash Prompt — Analytics KPI drill-down + Product sales

**Use:** Paste into DeepSeek-V4-Flash with repo access. Product: **Reservly** (repo: Slot_Booking_Application).

---

## Token rules (mandatory)

1. `rg` + targeted reads only. No whole-package dumps.
2. Reuse owner JWT, `Analytics.tsx`, `Bookings.tsx`, `AnalyticsService`, `api.ts`, Prisma, `DashboardLayout` nav patterns.
3. Small batches: schema → API → UI. No drive-by refactors. **Do not touch** WhatsApp, Razorpay wallet, auth/SSO, public booking widget flows.
4. Short status to human; use checkboxes below for progress.

---

## Locked product decisions (do not re-ask)

| # | Feature | Spec |
|---|---------|------|
| 1 | KPI drill-down | Clicking an analytics **number/KPI** opens a detail experience with **Back** to Analytics (same date range preserved). |
| 2 | Bookings KPIs | For booking-backed metrics (e.g. Total Bookings, status counts, QR count), **navigate to Bookings** pre-filtered by the Analytics `dateFrom`/`dateTo` (+ status when relevant). Prefer query params over inventing a second booking list. |
| 3 | Non-list KPIs | Peak Hour / Busiest Day / rates: either filtered Bookings **or** a small Analytics sub-panel explaining the metric + related bookings — always with **Back**. |
| 4 | Product sales | Optional salon **retail products** (shampoo, etc.): catalog + **Mark sale** UI + Analytics section for units/revenue in the selected date range. |
| 5 | Scope | Owner dashboard only. No public storefront / customer product checkout in this batch. |

---

## CURRENT (inspect — do not invent)

- Analytics UI: `packages/frontend/src/dashboard/pages/Analytics.tsx` — KPI cards via `Kpi` are **not clickable**; range via presets + custom from/to; export CSV already works.
- Analytics API: `GET /owner/analytics?dateFrom=&dateTo=` → `AnalyticsService.getAnalytics` (`packages/backend/src/services/AnalyticsService.ts`). Types: `AnalyticsData` in `packages/frontend/src/types/index.ts`.
- Bookings UI: `Bookings.tsx` — list + in-page detail + Back; filter today is **status only**. Owner list API: `GET /owner/bookings` already documents `dateFrom` / `dateTo` / `status` in OpenAPI (`owner.ts`) — **wire UI to these params** if backend already filters; else add filter support in `bookingService.getOwnerBookings` without breaking callers.
- Frontend API: `api.getAnalytics`, `api.getOwnerBookings`, `api.exportAnalyticsCsv` in `packages/frontend/src/lib/api.ts`.
- Router: `App.tsx` → `/dashboard/analytics`, `/dashboard/bookings`. Nav: `DashboardLayout.tsx`.
- **No Product model** in Prisma today — greenfield for retail.

---

## TARGET

### A) Analytics KPI → detail / Bookings

1. Make KPI cards (and other sensible numeric rows: status breakdown counts, by-service counts, QR count) **keyboard/mouse clickable** (button or `role="button"` + focus styles). Non-actionable labels stay plain.
2. **Preferred pattern for booking metrics:**
   - `navigate(`/dashboard/bookings?dateFrom=${dateFrom}&dateTo=${dateTo}`)` for Total Bookings.
   - Add `&status=CANCELLED` (etc.) when the KPI is status-specific.
   - Bookings page: read `useSearchParams`, apply date (+ status) filters, show a clear banner (“Filtered from Analytics · {from} → {to}”) + **Back to Analytics** that returns to `/dashboard/analytics` **with the same date range** (query or `location.state`).
3. Preserve existing Bookings detail view and Complete / No Show / Cancel.
4. Do not break Analytics export or range presets.

**Minimum clickable KPIs:** Total Bookings, status breakdown values, QR Bookings count, By Service row counts (filter by service if easy; else date-only list). Collected / discounts: optional drill to payments or bookings with payment filter — only if cheap; else leave non-clickable with hint.

### B) Product catalog + Mark sale

**Schema (suggested — adjust names to match Prisma style):**

- `Product`: `id`, `businessId`, `name`, `sku?`, `price` (Float INR), `cost?` (Float?), `isActive`, `createdAt`, `updatedAt`. Index `[businessId, isActive]`.
- `ProductSale`: `id`, `businessId`, `productId`, `quantity` (Int ≥ 1), `unitPrice` (snapshot), `totalAmount` (quantity × unitPrice), `soldAt` (DateTime), `note?`, `bookingId?` (optional link), `createdAt`. Indexes for `[businessId, soldAt]`, `[businessId, productId]`.

**Owner APIs (JWT, `businessId` from token only):**

- `GET/POST /owner/products`, `PUT/DELETE /owner/products/:id` (soft-deactivate OK via `isActive=false` if hard delete risks history).
- `POST /owner/product-sales` — mark sale (`productId`, `quantity`, optional `soldAt` default now, optional `note`/`bookingId`).
- `GET /owner/product-sales?dateFrom=&dateTo=` — list for UI.
- Extend `GET /owner/analytics` (same date window) with e.g. `productMetrics: { totalUnits, totalRevenue, byProduct: [{ id, name, units, revenue }] }` — empty when no sales.

**UI:**

- New dashboard page **Products** (nav item next to Services) **or** a tab/section under Services — pick one; keep layout consistent with Staff/Services.
- Catalog: add/edit/deactivate product (name, price required).
- **Mark sale**: pick product, quantity, optional note → saves `ProductSale`.
- Analytics: new section **Product sales** under existing KPIs (same date range): total revenue, units, top products table. Clicking product totals may open Products sales list filtered by range (optional).

### C) Do not break

- Existing analytics cards, heatmap, sparkline, CSV export, staff/performance blocks if present.
- Booking create/cancel/pay flows; public config; WhatsApp; wallet.
- Tenant isolation: all queries scoped by `req.owner.businessId`.

---

## Non-negotiables

| Rule | Detail |
|------|--------|
| Auth | Owner JWT only; never trust `businessId` from body |
| Money | Store product prices as Float INR like `Service.price` / `finalPrice` |
| Public | Products **not** on public booking widget in this batch |
| Migrations | Prisma migration required; no destructive edits to Booking/Payment |
| UI | Mobile-usable; Back always returns to prior Analytics range |

---

## Implementation order

1. [ ] Bookings: honor `dateFrom`/`dateTo`/`status` query params + “from Analytics” banner + Back link
2. [ ] Analytics: clickable KPIs → navigate with those params (preserve range)
3. [ ] Product + ProductSale migration + owner CRUD + Mark sale UI + nav
4. [ ] Analytics `productMetrics` + Product sales section
5. [ ] Smoke: KPI → Bookings → Back; mark sale → analytics product numbers update; export/bookings still work

---

## Done when

- Clicking Total Bookings (and other agreed KPIs) lands on a filtered Bookings (or detail) view with **Back** to Analytics.
- Owner can manage products, mark sales, and see product revenue/units on Analytics for the selected range.
- No regressions to existing analytics, bookings detail, or export.
