# Google Play Console — Jora Reservly production listing kit

Use this while filling **Play Console → Jora Reservly (`ai.jora.reservly`)**.  
Assets folder: `play-store-assets/` (feature graphic). Screenshots you capture on a device.

**Privacy policy URL (required):**  
`https://reservly-frontend-real.vercel.app/privacy`  
(after this deploy; also reachable in-app from Sign in and Dashboard → App info)

**Support / contact email:** `admin@staffingpros.tech`  
**Website:** `https://jora.co.in`

---

## 1) Main store listing — copy (paste)

### App name (≤ 30)
```
Jora Reservly
```

### Short description (≤ 80)
```
Owner app for salon bookings, invoices, staff, and WhatsApp — by Jora AI.
```

### Full description (≤ 4000)
```
Jora Reservly is the owner dashboard for salon and service businesses — manage appointments, customers, staff, invoices, and notifications from your phone.

Built for owners and managers
• View and update bookings and calendar
• Manage services, products, staff, and working hours
• Create walk-in invoices and track payments
• Share your public booking QR / link with customers
• WhatsApp and email notifications (when configured)
• Subscription and WhatsApp wallet tools

Who it’s for
Salon, clinic, spa, and appointment-based shop owners who already use Jora Reservly on the web. Customers book on the web; this app is for running the business.

Sign in
Use your owner email and password. Google Sign-In remains on the web dashboard.

Need help?
Email admin@staffingpros.tech or open Support inside the app.

Powered by Jora AI — https://jora.co.in
```

### Category
**Business** (or Productivity)

### Contact details
| Field | Value |
|-------|--------|
| Email | `admin@staffingpros.tech` |
| Phone | optional |
| Website | `https://jora.co.in` |
| Privacy policy | `https://reservly-frontend-real.vercel.app/privacy` |

---

## 2) Graphics

| Asset | Spec | File / how |
|-------|------|------------|
| **App icon** | 512×512 PNG, 32-bit with alpha OK for icon | Export from Android adaptive icon / brand mark (Play Console → Store listing → App icon) |
| **Feature graphic** | **1024×500**, JPEG or 24-bit PNG **no alpha** | `play-store-assets/feature-graphic-1024x500.jpg` (or `.png`) |
| **Phone screenshots** | Min **2**; prefer 1080×1920 (9:16) | Capture on a real device (see shot list below) |
| Tablet / TV / Wear | Optional | Skip unless you target those form factors |

### Suggested screenshot set (4–6)
1. Login / home dashboard  
2. Bookings list  
3. Calendar  
4. Invoices  
5. QR / public page  
6. Settings or Analytics  

Tip: use a demo salon with realistic data; hide any live customer PII.

---

## 3) App content → Data safety (recommended answers)

Declare based on current app behavior. Adjust if you change features.

### Overview
- **Does your app collect or share user data?** → **Yes**
- **Is all user data encrypted in transit?** → **Yes** (HTTPS)
- **Do you provide a way for users to request deletion?** → **Yes** (email `admin@staffingpros.tech`; documented in Privacy Policy)

### Data types collected (collected = yes; shared with third parties only as below)

| Type | Collected? | Shared? | Purpose | Optional? | Ephemeral? |
|------|------------|---------|---------|-----------|------------|
| **Email address** | Yes | Yes (email/WhatsApp providers when sending mail) | Account, App functionality, Communications | No (account) | No |
| **Name** | Yes | Sometimes (booking/invoice messages) | App functionality | No | No |
| **Phone number** | Yes (customers / business contact) | Yes (WhatsApp provider when messaging) | App functionality, Communications | Yes for some flows | No |
| **User IDs** | Yes (account / business ids) | No ads | App functionality, Analytics (in-app) | No | No |
| **Passwords** | Yes (hashed server-side) | No | Account management | No | No |
| **Photos** | Yes (logo/cover/service images you upload) | No ads | App functionality | Yes | No |
| **Audio files** | Yes only if owner records a **support** voice note (emailed; not stored as media DB files) | Yes (email provider as attachment) | App functionality / Support | Yes | Effectively ephemeral for our storage |
| **Approximate / precise location** | Yes if owner sets salon pin via device GPS | No ads | App functionality | Yes | No |
| **Purchase history** | Yes (subscriptions / wallet via Razorpay ids & amounts) | Yes (Razorpay) | App functionality, Fraud prevention | No for paid features | No |
| **Other financial info** | Payment status / Razorpay ids (not full card numbers) | Yes (Razorpay) | App functionality | — | No |
| **App interactions / crash** | Basic server logs as needed to operate | No ads | Analytics / Fraud prevention | — | — |

**Not collected for advertising / resale.** Do **not** claim “no data collected.”

### Data shared with
- **Razorpay** — payments / subscriptions / refunds  
- **Email provider** — transactional + support mail  
- **WhatsApp BSP** (e.g. Gupshup) — when owner sends WhatsApp  

### Security practices
- Data encrypted in transit: **Yes**  
- Users can request deletion: **Yes**

---

## 4) Content rating

Start **IARC questionnaire** in Play Console → App content → Content ratings.

Suggested answers for this B2B owner utility:
- Not a game  
- No user-generated public social feed (owner ops tool)  
- No violence / sexual content / drugs  
- May include **in-app purchases** (subscription / wallet top-up via Razorpay) → answer purchase questions honestly  
- Not primarily for children  

Expected outcome: low maturity rating (e.g. Everyone / PEGI 3 equivalent — follow the form result).

---

## 5) Target audience & content

- **Target age:** 18+ (business owners)  
- **Appeal to children:** No  
- **News / COVID / etc.:** No special declarations unless prompted  

---

## 6) Countries / availability

- Start with **India** (primary market)  
- Add more countries when support/payments are ready  

---

## 7) Release track order

1. Complete store listing + Data safety + content rating + privacy URL (all green).  
2. Upload AAB (`versionCode` must increase if already used). Current repo: **1.0.7 / 8**.  
3. **Internal testing** → add your Gmail as tester → install from Play link → smoke test.  
4. When stable → **Production** → Managed publish or auto.  
5. First production review can take hours to a few days.

### Smoke test on Internal track
- [ ] Sign in / stay signed in after force-stop  
- [ ] Bookings list loads  
- [ ] Create or view invoice  
- [ ] Open QR page / save PNG  
- [ ] Settings location (optional)  
- [ ] Support ticket (optional voice)  
- [ ] Subscription / wallet screen opens (live Razorpay — careful on real money)

---

## 8) Developer account checklist

- [ ] Play Console developer account paid / verified  
- [ ] App created with application id `ai.jora.reservly`  
- [ ] Upload key / Play App Signing enrolled (upload keystore you already use for AABs)  
- [ ] Declarations: ads (**No** unless you add them), Data safety submitted  

---

## Paths

| Item | Path |
|------|------|
| Feature graphic | `play-store-assets/feature-graphic-1024x500.jpg` |
| Privacy page (source) | `packages/frontend/src/pages/PrivacyPolicyPage.tsx` |
| Signed AAB (after rebuild) | `packages/frontend/android/app/build/outputs/bundle/release/app-release.aab` |
