# Reservly Deployment Guide — Render + Vercel + Neon

**Product:** Reservly  
**Shape:** Vercel (frontend) + Render (API) + Neon (Postgres) + external cron.

No credit card required for this path (free tiers). Repo includes `Dockerfile` and optional `render.yaml`.

---

## Every-time checklist (after first setup)

1. Push to the Git branch Render watches (usually `main`) → auto-deploys API  
2. If you changed `VITE_*` on Vercel → **Redeploy** the frontend  
3. Smoke test: `curl https://YOUR-API.onrender.com/api/health`

---

## Step 0 — Accounts (one-time)

Create these (GitHub login is fine; card usually not required):

1. [Render](https://render.com) — API
2. [Neon](https://neon.tech) — Postgres (do **not** use Render free Postgres long-term; it expires ~30 days)
3. [Vercel](https://vercel.com) — frontend
4. [cron-job.org](https://cron-job.org) — scheduled jobs

Push this repo to **GitHub** if it is not already there (Render + Vercel deploy from Git).

---

## Step 1 — Create free Postgres (Neon)

1. Neon → **New Project**
2. Pick a region (any is fine for a pilot)
3. Copy the connection string
4. Ensure SSL: add `?sslmode=require` if missing

That string is `DATABASE_URL`. Never commit it.

---

## Step 2 — Create the Render Web Service

1. Render Dashboard → **New** → **Web Service**
2. Connect your GitHub account and select **Slot_Booking_Application**
3. Settings:

| Field | Value |
|---|---|
| Name | `reservly-api` (or any available name) |
| Region | closest to you |
| Runtime | **Docker** |
| Dockerfile path | `./Dockerfile` |
| Docker build context directory | `.` (repo root) |
| Branch | `main` |
| Instance type | **Free** |
| Health check path | `/api/health` |

4. Do **not** click Create yet — add env vars first (Step 3), or create then add env and redeploy.

### Optional: Blueprint instead of manual UI

If you prefer Infrastructure-as-Code:

1. Render → **New** → **Blueprint**
2. Select the repo (uses `render.yaml`)
3. Fill in `DATABASE_URL`, `FRONTEND_URL`, `FRONTEND_PUBLIC_URL` when prompted  
   (`JWT_SECRET` / `CRON_SECRET` can be auto-generated)

---

## Step 3 — Environment variables on Render

In the Web Service → **Environment**:

Generate secrets locally:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # CRON_SECRET
```

| Key | Value |
|---|---|
| `DATABASE_URL` | Neon connection string (`?sslmode=require`) |
| `JWT_SECRET` | long random string |
| `CRON_SECRET` | long random string |
| `FRONTEND_URL` | `https://placeholder.vercel.app` (update after Step 5) |
| `FRONTEND_PUBLIC_URL` | same as `FRONTEND_URL` for now |
| `NODE_ENV` | `production` |

Optional later (email / WhatsApp / payments / media) — see `packages/backend/.env.example`:

- `SMTP_*`
- `TWILIO_*`
- `RAZORPAY_*`
- `CLOUDINARY_*`

Save with **Save, rebuild, and deploy**.

---

## Step 4 — Wait for deploy & verify API

1. Open the service **Logs** / **Events** until deploy is Live
2. Copy the URL, e.g. `https://reservly-api.onrender.com`
3. Test (first request after idle can take ~30–60s while the free instance wakes):

```bash
curl https://reservly-api.onrender.com/api/health
```

Expect JSON with a healthy status.

If migrate fails, check logs for `DATABASE_URL` / SSL errors. The container runs:

`pnpm exec prisma migrate deploy && node dist/index.js`

---

## Step 5 — Deploy the frontend (Vercel)

1. Vercel → **Add New** → **Project** → import the same GitHub repo
2. Prefer **Root Directory = repository root** (pnpm workspace):

| Setting | Value |
|---|---|
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm --filter frontend build` |
| Output Directory | `packages/frontend/dist` |

3. Environment variable (Production + Preview):

```text
VITE_API_BASE_URL=https://reservly-api.onrender.com
```

No trailing slash. Never put `JWT_SECRET` / `CRON_SECRET` / Twilio / Razorpay in `VITE_*`.

4. Deploy → copy the Vercel URL, e.g. `https://reservly.vercel.app`
5. Update Render env:

| Key | Value |
|---|---|
| `FRONTEND_URL` | `https://reservly.vercel.app` |
| `FRONTEND_PUBLIC_URL` | `https://reservly.vercel.app` |

6. Redeploy the Render service (env change → Save and deploy)

After any `VITE_*` change on Vercel: **Redeploy frontend** (Vite inlines env at build time).

---

## Step 6 — External cron (required)

Free Render sleeps after ~15 minutes idle. Cron wakes the API and runs jobs.

Create **4** jobs on cron-job.org (or similar):

- Method: **POST**
- Header: `x-cron-secret: <same CRON_SECRET as Render>`
- URLs (replace host):

```text
https://reservly-api.onrender.com/api/internal/jobs/process-reminders
https://reservly-api.onrender.com/api/internal/jobs/process-waitlist-expirations
https://reservly-api.onrender.com/api/internal/jobs/process-payment-expirations
https://reservly-api.onrender.com/api/internal/jobs/process-refund-reconciliation
```

| Job | Interval |
|---|---|
| reminders | every 5 min |
| waitlist expirations | every 5 min |
| payment expirations | every 1 min |
| refund reconciliation | every 5 min |

If the tool cannot set headers, use JSON body: `{ "secret": "YOUR_CRON_SECRET" }`.

---

## Step 7 — Smoke test

1. Open the Vercel site → **Sign up** as an owner
2. Configure services / hours / location
3. Open public booking URL `/b/{publicCode}`
4. Create a test booking
5. Confirm health still works after a few minutes

Optional seed against production (only if intentional):

```bash
DATABASE_URL="your-neon-url" pnpm --filter backend db:seed
```

---

## Everyday commands / habits

| Action | How |
|---|---|
| Deploy API | `git push` to the watched branch (or Manual Deploy in Render) |
| Deploy frontend | `git push` or Redeploy in Vercel |
| Change API secrets | Render → Environment → Save & deploy |
| Change `VITE_API_BASE_URL` | Vercel env → Redeploy frontend |
| Logs | Render → Logs |
| Cold start | First hit after ~15 min idle can take 30–60s — normal on free |

---

## Free-tier limits (honest)

- Render free web service **sleeps** after inactivity → cold starts
- ~750 free instance hours / month per workspace
- Neon free may suspend compute → first DB query after idle can be slow
- Do **not** use Render free Postgres for long-term data (expires ~30 days) — use Neon/Supabase
- Twilio / Razorpay are paid third parties when you enable them
- No in-process timers — external cron (Step 6) is required

---

## Environment reference

See `packages/backend/.env.example`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres |
| `JWT_SECRET` | Owner JWT signing |
| `CRON_SECRET` | Internal job auth |
| `PORT` | Set by Render automatically |
| `FRONTEND_URL` | Vercel origin (CORS) |
| `FRONTEND_PUBLIC_URL` | Links / QR / manage URLs |

---

## Files in this repo

| File | Role |
|---|---|
| `Dockerfile` | Builds API; runs migrate then `node dist/index.js` |
| `render.yaml` | Optional Blueprint for one-click Render setup |
| `.dockerignore` | Keeps image small / excludes secrets |
| `packages/frontend/vercel.json` | SPA rewrites for deep links |
| `fly.toml` | Leftover Fly config — ignore if you use Render |
