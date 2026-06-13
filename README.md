# SlotBook — Universal Slot Booking SaaS Microservice

A fully self-contained, embeddable slot booking microservice inspired by Calendly but purpose-built for physical service businesses (salons, clinics, studios, gyms, etc.).

## Features

### Core
- **Parallel seat booking** — Multiple simultaneous bookings per time slot
- **Dynamic intake forms** — Drag-and-drop field builder with live preview
- **Business-specific slugs** — Each business gets a unique booking URL
- **Slot blocking** — Block individual time slots for holidays/maintenance
- **Booking status workflow** — CONFIRMED → COMPLETED / NO_SHOW / CANCELLED

### Optional Features (Owner-Toggled)
- 🕐 **Waitlist** — Auto-notify customers when slots free up (30-min expiry cascade)
- 🔄 **Recurring Bookings** — Weekly/bi-weekly/monthly with conflict preview
- 👥 **Multi-Staff** — Book specific staff members or "any available"
- 💳 **Payments (Razorpay)** — UPI, Cards, Netbanking; full or deposit mode

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
- **Customer Widget**: `http://localhost:5173/b/demo-salon` (or `http://localhost:5173/demo-salon`)
- **Owner Dashboard**: `http://localhost:5173/login`
- **API Docs (Swagger)**: `http://localhost:3001/api-docs`
- **API Health**: `http://localhost:3001/api/health`

### 6. Demo Credentials
- **Owner Login**: `owner@demosalon.com` / `admin123`
- **Business Slug**: `demo-salon`

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
| GET | `/api/:slug/config` | Get business config |
| GET | `/api/:slug/availability?date=&staffId=` | Get slot availability |
| POST | `/api/:slug/bookings` | Create booking |
| GET | `/api/:slug/bookings/:id` | Get booking |
| PUT | `/api/:slug/bookings/:id` | Update booking |
| DELETE | `/api/:slug/bookings/:id` | Cancel booking |
| POST | `/api/:slug/waitlist` | Join waitlist *[feature: waitlist]* |
| POST | `/api/:slug/payments/initiate` | Initiate payment *[feature: payments]* |
| POST | `/api/:slug/payments/verify` | Verify payment *[feature: payments]* |

### Owner (JWT-protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/owner/login` | Login |
| GET | `/api/owner/bookings` | List bookings |
| PUT | `/api/owner/bookings/:id` | Update booking |
| POST | `/api/owner/block` | Block slot |
| GET | `/api/owner/blocks` | List blocks |
| PUT | `/api/owner/config` | Update config |
| PUT | `/api/owner/working-hours` | Update working hours |
| PUT | `/api/owner/form-fields` | Update form fields |
| GET | `/api/owner/analytics` | Get analytics data |
| GET | `/api/owner/staff` | List staff *[feature: multi-staff]* |
| POST | `/api/owner/staff` | Create staff *[feature: multi-staff]* |
| GET | `/api/owner/payments` | List payments *[feature: payments]* |

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
<iframe src="https://your-domain.com/b/your-slug?embed=true" 
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