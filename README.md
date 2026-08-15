# Reservly — Flexible Reservations for Every Business

A self-contained, embeddable reservation platform for appointment and capacity-based businesses, including salons, clinics, studios, gyms, cafés, and restaurants.

## Features

### Core
- **Service catalog** — Categories + services with per-service duration, buffer time, capacity, staff assignment, and pricing
- **Server-side pricing engine** — Percentage/flat discounts with validity windows; prices and snapshots are always computed on the backend
- **Service-aware availability** — Slot grids adapt to each service's duration, buffer, capacity, resource mode (staff-based vs pooled), and granularity
- **Parallel seat booking** — Multiple simultaneous bookings per time slot
- **Dynamic intake forms** — Drag-and-drop field builder with live preview
- **Opaque public codes** — Each business gets a secure, URL-safe `publicCode`; customer links resolve to exactly one business
- **Business timezone engine** — All booking dates/times resolve in the owner's IANA timezone
- **Customizable public page** — Branding (colors, logo, cover) and page sections (Hero, Services, Offers, About, Hours…)
- **QR codes** — Dedicated QR page; bookings from QR links are tracked as a distinct source
- **Slot blocking** — Block individual time slots for holidays/maintenance
- **Booking status workflow** — CONFIRMED → COMPLETED / NO_SHOW / CANCELLED
- **Owner signup** — Create an isolated business workspace in seconds

### Optional Features (Owner-Toggled)
- 🕐 **Waitlist** — Auto-notify customers when slots free up (30-min expiry cascade)
- 🔄 **Recurring Bookings** — Weekly/bi-weekly/monthly with conflict preview
- 👥 **Multi-Staff** — Book specific staff members, staff working hours, staff-per-service assignment
- 💳 **Payments (Razorpay)** — UPI, Cards, Netbanking; full or deposit mode; authoritative server-side amounts
- 🔔 **Reminders** — Database-backed appointment reminders (durable, cron-friendly)

### Analytics Dashboard
- KPI cards with real-time data
- Booking heatmap (7×24 grid)
- Status breakdown (donut chart)
- Feature-gated sections for payments, waitlist, staff performance

### Embed Modes
- **Standalone** — Full page with header
- **iframe/QR** — No chrome, postMessage for height sync
- **Script tag** — Mounts into `#booking-widget` container
- **Theme injection** — URL params override CSS custom properties

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite 5 + Tailwind CSS 3.4 + Framer Motion 11 |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL + Prisma ORM |
| Auth | JWT (owner) |
| Notifications | Nodemailer (Gmail SMTP) + WhatsApp (Twilio/Meta) |
| Payments | Razorpay (UPI, Cards, Netbanking, Wallets) |
| Deployment | Docker-ready |

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 8+
- PostgreSQL 14+

### 1. Clone & Install
```bash
git clone <repo-url>
cd slot_booking_application
pnpm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your settings
```

### 3. Setup Database
```bash
cd packages/backend
npx prisma migrate dev --name init
npx prisma db seed
```

### 4. Start Development
```bash
# From project root
pnpm --filter backend dev    # Backend on http://localhost:3001
pnpm --filter frontend dev   # Frontend on http://localhost:5173
```

### 5. Access
- **Customer Widget**: `http://localhost:5173/b/{publicCode}` — the demo's public code is shown at login/QR page; the legacy slug `demo-salon` redirects to it
- **Owner Dashboard**: `http://localhost:5173/login`
- **API Docs (Swagger)**: `http://localhost:3001/api-docs`
- **API Health**: `http://localhost:3001/api/health`

### 6. Demo Credentials
- **Owner Login**: `owner@demosalon.com` / `admin123`
- **Business Slug / Public Code**: `demo-salon` (slug) — the opaque `publicCode` is generated per business and used in customer URLs

## Docker Deployment

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on port 5432
- Backend API on port 3001
- Frontend on port 5173

## API Endpoints

### Public (Customer-facing)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/signup` | Create a business workspace |
| GET | `/api/:code/config` | Get public business config (branding, services, sections) |
| GET | `/api/:code/availability?date=&serviceId=&staffId=` | Service-aware slot availability |
| POST | `/api/:code/bookings` | Create booking (server derives price/duration/source) |
| GET | `/api/:code/bookings/:id` | Get booking |
| PUT | `/api/:code/bookings/:id` | Update/reschedule booking |
| DELETE | `/api/:code/bookings/:id` | Cancel booking |
| POST | `/api/:code/waitlist` | Join waitlist *[feature: waitlist]* |
| POST | `/api/:code/payments/initiate` | Initiate Razorpay order *[feature: payments]* |
| POST | `/api/:code/payments/verify` | Verify payment *[feature: payments]* |
| POST | `/api/:code/recurring` | Create recurring series *[feature: recurring]* |

`/api/:code` accepts either the opaque `publicCode` or the legacy slug for compatibility.

### Owner (JWT-protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/owner/login` | Login |
| GET | `/api/owner/me` | Full business config (incl. services, categories, sections) |
| GET | `/api/owner/bookings` | List bookings |
| PUT | `/api/owner/bookings/:id` | Update booking |
| POST | `/api/owner/block` | Block slot |
| GET | `/api/owner/blocks` | List blocks |
| PUT | `/api/owner/config` | Update config (incl. branding, timezone, reminders) |
| PUT | `/api/owner/working-hours` | Update working hours |
| PUT | `/api/owner/form-fields` | Update form fields |
| GET | `/api/owner/categories` · POST · PUT/:id · DELETE/:id | Service category CRUD |
| GET | `/api/owner/services` · POST · PUT/:id · DELETE/:id | Service CRUD |
| GET/PUT | `/api/owner/services/:id/hours` | Per-service working hours |
| GET/PUT | `/api/owner/staff/:id/hours` | Per-staff working hours |
| GET/POST/PUT/DELETE | `/api/owner/page-sections` | Public page section CRUD |
| GET | `/api/owner/qr` | QR link + public code |
| GET | `/api/owner/analytics` | Analytics (incl. by-service, by-source, QR rate, discounts) |
| GET | `/api/owner/staff` | List staff *[feature: multi-staff]* |
| POST | `/api/owner/staff` | Create staff *[feature: multi-staff]* |
| GET | `/api/owner/payments` | List payments *[feature: payments]* |

### Internal (cron)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/internal/jobs/process-reminders` | Process due reminders. Protect with `CRON_SECRET` via `x-cron-secret` header or `secret` body |
| POST | `/api/internal/jobs/process-waitlist-expirations` | Expire notified waitlist entries and cascade when the slot is still available |
| POST | `/api/internal/jobs/process-payment-expirations` | Expire stale 10-minute payment capacity holds |

## Project Structure

```
packages/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      # Database schema
│   │   └── seed.ts            # Seed data
│   └── src/
│       ├── index.ts           # Express server + Swagger
│       ├── lib/prisma.ts      # Prisma client
│       ├── middleware/auth.ts  # JWT middleware
│       ├── routes/
│       │   ├── public.ts      # Customer routes
│       │   └── owner.ts       # Owner routes
│       └── services/
│           ├── FeatureGuard.ts
│           ├── AvailabilityService.ts
│           ├── BookingService.ts
│           ├── NotificationService.ts
│           ├── WaitlistService.ts
│           ├── RecurringService.ts
│           ├── PaymentService.ts
│           └── AnalyticsService.ts
├── frontend/
│   └── src/
│       ├── widget/            # Customer booking widget
│       │   ├── StepRouter.tsx
│       │   ├── FeatureGate.tsx
│       │   ├── CalendarPicker.tsx
│       │   ├── TimeSlotGrid.tsx
│       │   ├── WaitlistSheet.tsx
│       │   ├── RecurringPreview.tsx
│       │   └── steps/
│       │       ├── StaffSelection.tsx
│       │       ├── DateTimePicker.tsx
│       │       ├── CustomerForm.tsx
│       │       ├── PaymentStep.tsx
│       │       └── ConfirmationScreen.tsx
│       ├── dashboard/         # Owner dashboard
│       │   ├── DashboardLayout.tsx
│       │   └── pages/         # 11 pages
│       ├── store/             # Zustand store
│       ├── hooks/             # Custom hooks
│       └── lib/api.ts         # API client
├── docker-compose.yml
└── README.md
```

## Feature Flags

All optional features are controlled by boolean flags in the business config. When toggled OFF:
- UI sections are hidden via `<FeatureGate>` component
- API endpoints return 403
- No related data is collected or stored

Toggle from: **Dashboard → Settings → Features**

## Embedding

### iframe
```html
<iframe src="https://your-domain.com/b/{publicCode}?embed=true"
        style="border:0; width:100%; min-height:600px;" />
```

### Script Tag
```html
<div id="booking-widget"></div>
<script>
  window.__BOOKING_SLUG__ = 'your-slug';
  window.__BOOKING_THEME__ = { primary: '#7C3AED' };
</script>
<script src="https://your-domain.com/embed.js"></script>
```

### postMessage Events
```javascript
window.addEventListener('message', (e) => {
  switch(e.data.type) {
    case 'BOOKING_CONFIRMED': // ...
    case 'BOOKING_CANCELLED': // ...
    case 'PAYMENT_COMPLETED': // ...
    case 'WIDGET_HEIGHT':     // ...
  }
});
```

## License

MIT