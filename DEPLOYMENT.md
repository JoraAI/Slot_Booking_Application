# Deployment Guide — Fly.io + Vercel + Neon

**Shape:** Vercel (frontend) + Fly.io (API) + Neon (Postgres) + external cron.

Repo includes `Dockerfile` and `fly.toml` at the monorepo root for the API.

---

## Every-time checklist (after first setup)

```bash
# 1. Push code (or deploy from local)
fly deploy

# 2. If you changed VITE_* on Vercel → Redeploy frontend in Vercel UI
# 3. If you changed secrets:
fly secrets set KEY=value
fly apps restart slotbook-api

# 4. Smoke test
curl https://slotbook-api.fly.dev/api/health
```

---

## Step 0 — Accounts & CLI (one-time)

1. Create accounts: [Fly.io](https://fly.io), [Neon](https://neon.tech), [Vercel](https://vercel.com), [cron-job.org](https://cron-job.org)
2. Fly needs a payment card on file (free allowance still usually requires a card)
3. Install Fly CLI and log in:

```bash
curl -L https://fly.io/install.sh | sh
# add ~/.fly/bin to PATH if the installer says so
fly auth login
```

You also need Node 20+, pnpm, and git locally.

---

## Step 1 — Create free Postgres (Neon)

1. Neon → New Project → pick a region near Fly (`sin` / Singapore or closest available)
2. Copy the connection string
3. Ensure it includes SSL, e.g. `?sslmode=require`

Save this as `DATABASE_URL`. Do **not** commit it.

---

## Step 2 — Create the Fly app (one-time)

From the **repo root** (`Slot_Booking_Application`):

```bash
cd /path/to/Slot_Booking_Application
fly apps create slotbook-api
```

If the name is taken, edit `app = "..."` in `fly.toml` and create that name instead.

`fly.toml` defaults:

- `app = "slotbook-api"`
- `primary_region = "sin"` (change if you want Mumbai/`bom`, US/`iad`, etc.)
- HTTP port `8080`
- Health check `GET /api/health`
- Auto-stop when idle (`min_machines_running = 0`) — free-friendly, cold starts OK

---

## Step 3 — Set Fly secrets (required before first deploy)

Generate secrets:

```bash
openssl rand -hex 32   # use as JWT_SECRET
openssl rand -hex 32   # use as CRON_SECRET
```

Set them (replace placeholders; use your Neon URL):

```bash
fly secrets set \
  DATABASE_URL="postgresql://USER:PASS@HOST/DB?sslmode=require" \
  JWT_SECRET="PASTE_JWT_SECRET" \
  CRON_SECRET="PASTE_CRON_SECRET" \
  FRONTEND_URL="https://placeholder.vercel.app" \
  FRONTEND_PUBLIC_URL="https://placeholder.vercel.app"
```

You will update `FRONTEND_*` after Vercel gives you a real URL (Step 5).

Optional later (email / WhatsApp / payments / media):

```bash
fly secrets set \
  SMTP_HOST="smtp.gmail.com" \
  SMTP_PORT="587" \
  SMTP_SECURE="false" \
  SMTP_USER="you@gmail.com" \
  SMTP_PASS="app-password" \
  SMTP_FROM_NAME="SlotBook"
# Twilio / Razorpay / Cloudinary when needed — see packages/backend/.env.example
```

```bash
fly secrets list   # names only
```

---

## Step 4 — Deploy the API

From repo root:

```bash
fly deploy
```

What happens:

1. Docker builds the monorepo backend image
2. `release_command` runs `pnpm exec prisma migrate deploy`
3. App starts: `node dist/index.js` on port **8080**
4. Public URL: `https://slotbook-api.fly.dev` (or your app name)

Verify:

```bash
curl https://slotbook-api.fly.dev/api/health
fly status
fly logs
```

If migrate/release fails:

```bash
fly logs
fly ssh console -C "pnpm exec prisma migrate status"
```

---

## Step 5 — Deploy the frontend (Vercel)

1. Import the GitHub repo in Vercel
2. Prefer **Root Directory = repository root** (pnpm workspace), with:
   - **Install**: `pnpm install --frozen-lockfile`
   - **Build**: `pnpm --filter frontend build`
   - **Output**: `packages/frontend/dist`
3. Or set Root Directory to `packages/frontend` only if install/build from that package works in your Vercel project settings
4. Environment variable (Production + Preview):

```text
VITE_API_BASE_URL=https://slotbook-api.fly.dev
```

No trailing slash. Never put `JWT_SECRET`, `CRON_SECRET`, Twilio, or Razorpay in `VITE_*`.

5. Deploy → copy the Vercel URL (e.g. `https://slotbook.vercel.app`)
6. Point the API at that origin:

```bash
fly secrets set \
  FRONTEND_URL="https://slotbook.vercel.app" \
  FRONTEND_PUBLIC_URL="https://slotbook.vercel.app"
fly apps restart slotbook-api
```

After any `VITE_*` change on Vercel: **Redeploy** the frontend (Vite inlines env at build time).

---

## Step 6 — External cron (required)

Free Fly machines may sleep. Cron wakes the API and runs jobs.

Create 4 jobs (cron-job.org or similar):

- Method: **POST**
- Header: `x-cron-secret: <same CRON_SECRET as Fly>`
- URLs:

```text
https://slotbook-api.fly.dev/api/internal/jobs/process-reminders
https://slotbook-api.fly.dev/api/internal/jobs/process-waitlist-expirations
https://slotbook-api.fly.dev/api/internal/jobs/process-payment-expirations
https://slotbook-api.fly.dev/api/internal/jobs/process-refund-reconciliation
```

| Job | Interval |
|---|---|
| reminders | every 5 min |
| waitlist expirations | every 5 min |
| payment expirations | every 1 min |
| refund reconciliation | every 5 min |

Auth also accepts JSON body `{ "secret": "..." }` if your cron tool cannot set headers.

---

## Step 7 — Smoke test

1. Open the Vercel site → sign up as an owner
2. Configure services / hours / location
3. Open public booking URL `/b/{publicCode}`
4. Create a test booking
5. Confirm API health still OK

Optional seed against production (only if intentional):

```bash
DATABASE_URL="your-neon-url" pnpm --filter backend db:seed
```

---

## Everyday commands

```bash
fly deploy
fly logs
fly status
fly secrets set KEY=val
fly apps restart slotbook-api
fly scale count 1
```

Keep API always awake (uses more free allowance / may cost):

```toml
# in fly.toml [http_service]
auto_stop_machines = "off"
min_machines_running = 1
```

Then `fly deploy` again.

---

## Environment reference

See `packages/backend/.env.example`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres |
| `JWT_SECRET` | Owner JWT signing |
| `CRON_SECRET` | Internal job auth |
| `PORT` | `8080` on Fly (`fly.toml`) |
| `FRONTEND_URL` | Vercel origin (CORS) |
| `FRONTEND_PUBLIC_URL` | Links / QR / manage URLs |

Optional: `SMTP_*`, `TWILIO_*`, `RAZORPAY_*`, `CLOUDINARY_*`.

---

## Honest free-tier limits

- Fly auto-stop → cold starts after idle
- Neon free may suspend compute → first query after idle is slow
- Twilio / Razorpay are paid third parties
- No in-process timers — external cron (§6) is required
- Vercel hosts only the static frontend

---

## Files in this repo

| File | Role |
|---|---|
| `Dockerfile` | Builds backend for Fly |
| `fly.toml` | App name, region, port, migrate release, health check |
| `.dockerignore` | Keeps image small / excludes secrets |
| `packages/frontend/vercel.json` | SPA rewrites for deep links |
