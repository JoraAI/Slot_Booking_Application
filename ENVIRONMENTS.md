# Reservly environments — `main` (prod) vs `demo`

Two Git branches and two Neon databases. Matching Razorpay keys when you use them.

**Phase 1 (current):** one Render API + one Vercel frontend is fine.  
Keep the **existing Neon** on the live deploy (demo data). Create / hold the **new Neon** for production and switch `DATABASE_URL` / `DIRECT_URL` on that same Render service when you go live with real salons. Add a second API/frontend later only if you need both envs online at once.

| | **Production (`main`)** | **Demo (`demo`)** |
|---|---|---|
| Git branch | `main` | `demo` |
| Neon | **New** project (real salons; migrate only, never seed) | **Existing** project (seed + demo logins) |
| Render API | Same service for now → point at prod Neon when ready | Same service for now → keep existing Neon until cutover |
| Vercel | Same project; Production branch `main` | Same project; use `demo` for Previews, or switch later |
| Platform Razorpay (`RAZORPAY_*`) | **Live** keys when on prod Neon | **Test** keys while on demo Neon |
| Per-salon checkout (Settings) | Live keys + Test Mode **OFF** | Test keys + Test Mode **ON** |
| Seed | **Never** run against prod | OK (`pnpm db:seed`) |
| `RESERVLY_ENV` | `production` | `demo` |

## One-time Neon setup

**Existing Neon project in this repo’s current deploy → use as DEMO** (`reservly-demo` / keep the current name).  
It already has (or can be seeded with) demo salon data. Point the **`demo`** branch / `reservly-api-demo` at this database.

**Create a second Neon project for PRODUCTION** (e.g. name `reservly-prod`).  
Leave it empty except for migrations — **do not** run `pnpm db:seed` on it. Point **`main`** / `reservly-api` at this database.

For each project, copy pooled + direct URLs onto the matching Render service:

| Var | Value |
|---|---|
| `DATABASE_URL` | Pooled `…-pooler…` + `?sslmode=require&pgbouncer=true` |
| `DIRECT_URL` | Direct host (no `-pooler`) + `?sslmode=require` |

### Checklist when you add the new prod Neon

1. Neon → **New Project** → `reservly-prod` → copy pooled + direct URLs.  
2. On Render **reservly-api** (`main`): set `DATABASE_URL` / `DIRECT_URL` to the **new** project; set `RESERVLY_ENV=production` and **live** `RAZORPAY_*`.  
3. On Render **reservly-api-demo** (`demo`): keep `DATABASE_URL` / `DIRECT_URL` on the **existing** (old) Neon project; `RESERVLY_ENV=demo` and **test** `RAZORPAY_*`.  
4. Run `prisma migrate deploy` against **prod** (empty → schema only).  
5. Confirm demo still works against the old DB; prod `/api/health` shows `"env":"production"`.

## Razorpay (two layers)

### 1) Platform keys (Render env) — wallet top-up + owner subscriptions
- **Demo service:** Razorpay Dashboard → **Test mode** → Key Id / Secret → `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`
- **Prod service:** same dashboard → **Live mode** → different Key Id / Secret

### 2) Per-salon customer checkout (stored in that env’s DB)
- Demo salons: Settings → enable Payments → **Test Mode ON** → paste `rzp_test_…` keys  
- Real salons (prod DB only): **Test Mode OFF** → paste `rzp_live_…` keys  

Do not put live salon keys in the demo database.

## Render

Use `render.yaml` (two services) or create manually:

1. **reservly-api** — branch `main`, `RESERVLY_ENV=production`, prod Neon + live Razorpay  
2. **reservly-api-demo** — branch `demo`, `RESERVLY_ENV=demo`, demo Neon + test Razorpay  

Also set per service: `FRONTEND_URL`, `FRONTEND_PUBLIC_URL`, `JWT_SECRET`, `CRON_SECRET`, WhatsApp/email as needed.
Use **different** `JWT_SECRET` and `CRON_SECRET` per env.

## Vercel

### Production (`main`)
- Root `vercel.json` rewrites `/api/*` → prod Render host (e.g. `https://reservly-api.onrender.com`).
- Production branch = `main`.

### Demo (`demo`)
Option A (simplest): second Vercel project “reservly-demo”, Production Branch = `demo`, use `vercel.demo.json` as `vercel.json` (or paste the same rewrites pointing at `https://reservly-api-demo.onrender.com`).

Option B: one Vercel project — Production = `main`, connect `demo` for Previews and set Preview env / rewrite to the demo API (Preview rewrites are limited; Option A is clearer).

## Migrate / seed safely

```bash
# Against DEMO only (point shell at demo .env or export URLs)
export DATABASE_URL="…demo-pooler…"
export DIRECT_URL="…demo-direct…"
pnpm --filter backend db:migrate:prod   # prisma migrate deploy
pnpm --filter backend db:seed           # demo logins / sample data — DEMO ONLY
```

```bash
# Against PROD — migrate only, never seed
export DATABASE_URL="…prod-pooler…"
export DIRECT_URL="…prod-direct…"
pnpm --filter backend db:migrate:prod
# DO NOT run db:seed on production
```

Promote code: develop & test on `demo` → merge PR into `main` → migrate **prod** Neon if there are new migrations → confirm `/api/health` shows `"env":"production"`.

## Local templates

| File | Use |
|---|---|
| `packages/backend/.env.demo.example` | Copy → `.env` when developing against demo Neon |
| `packages/backend/.env.production.example` | Reference for prod Render vars (never commit secrets) |
| `packages/frontend/.env.demo.example` | Mobile / direct API builds aimed at demo |
| `packages/frontend/.env.production.example` | Mobile / direct API builds aimed at prod |

## Smoke checks

```bash
curl -s https://reservly-api-demo.onrender.com/api/health
# expect "env":"demo"

curl -s https://reservly-api.onrender.com/api/health
# expect "env":"production"
```

Demo logins (demo DB after seed): see README — e.g. `owner@demosalon.com` / `admin123`.
