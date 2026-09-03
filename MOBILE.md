# Reservly mobile (Android + iOS)

The owner dashboard is wrapped with [Capacitor](https://capacitorjs.com/) so the same React app runs as:

- **Web** — full product (owner dashboard + public booking / manage pages)
- **Android / iOS** — owner shell only (login + dashboard). Public booking stays on the web for links, embeds, and QR codes.

Nothing in the web deploy path changes: `pnpm build` / Vercel still ship the normal SPA.

## Prerequisites

| Platform | Tools |
|----------|--------|
| Both | Node 18+, pnpm, this repo installed (`pnpm install`) |
| Android | Android Studio (SDK 35+), JDK 17+, device or emulator |
| iOS | macOS, Xcode 15+, CocoaPods, Apple Developer account for device/TestFlight |

## Configure API URL for native builds

Inside the native WebView there is **no** Vite `/api` proxy. Set the public API origin before building:

```bash
# packages/frontend/.env  (or export for one build)
VITE_API_BASE_URL=https://reservly-api.onrender.com
```

Use your real Render (or other) API host. With or without trailing `/api` is fine.

Backend CORS already allows Capacitor origins (`https://localhost`, `capacitor://localhost`, …). Optionally add more via `CORS_ORIGINS` (comma-separated) on the API.

## Build & sync

From the repo root:

```bash
# Build frontend dist/ and sync into android/ + ios/
pnpm mobile:sync

# Or one platform:
pnpm mobile:android
pnpm mobile:ios
```

From `packages/frontend`:

```bash
pnpm run build:mobile
npx cap sync
npx cap open android   # Android Studio
npx cap open ios       # Xcode (macOS only)
```

## First-time platform folders

If `android/` or `ios/` are missing under `packages/frontend`:

```bash
cd packages/frontend
pnpm run build:mobile
npx cap add android
npx cap add ios
npx cap sync
```

`cap add ios` must run on a Mac (or a machine with the iOS project templates). The `ios/` folder can be committed so Linux CI still builds web + Android.

## Run

1. **Android:** Android Studio → open `packages/frontend/android` → Run on emulator/device.
2. **iOS:** Xcode → open `packages/frontend/ios/App/App.xcworkspace` → select team → Run.

Sign in with an owner email/password (e.g. demo accounts). Google Sign-In is intentionally web-only.

## Permissions

- **Location** (Settings → pin salon): Android uses fine/coarse location; iOS needs `NSLocationWhenInUseUsageDescription` (added in the iOS project).
- **Back button (Android):** navigates React Router history; exits only from login root.

## What stays web-only

- Public booking (`/:slug`, `/b/:slug`)
- Customer manage booking pages
- Google Identity Services button

External https links (maps, docs) open in the system browser / Custom Tabs via `@capacitor/browser`.

## Store checklist (high level)

1. Set production `VITE_API_BASE_URL` and rebuild + `cap sync`.
2. Update app icons / splash in Android Studio and Xcode (or Capacitor assets tooling).
3. Privacy policy URL, Play Console / App Store Connect listings.
4. Test: login, bookings list, invoice view, wallet/subscription Razorpay, Settings geolocation.
5. Ensure API `FRONTEND_URL` / `CORS_ORIGINS` include any extra origins you use.
