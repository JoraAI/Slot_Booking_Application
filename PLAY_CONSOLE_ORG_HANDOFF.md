# Play Console — Organization account & app transfer (handoff)

**Last updated:** 14 September 2026  
**App:** Jora Reservly · package `ai.jora.reservly`  
**Product brand:** Jora AI / Jora Reservly  
**Legal operator:** StaffingPros (sole proprietorship) — product of StaffingPros; sites: https://staffingpros.tech , https://jora.co.in  
**Support email:** admin@staffingpros.tech  

Use this doc when returning to Play Store production work. Context for humans and AI assistants.

---

## Why we are blocked

Production submission was **rejected** with:

> Play Console Requirements — Some types of apps can only be distributed by organizations. You selected an app category / financial features that require an **organization** account.

**Root cause:** The app was submitted from a **Personal** Play developer account while **App content → Financial features** includes:

- **Payments and transfers → Mobile payments and digital wallets**

That is accurate (Razorpay subscription + WhatsApp wallet). Personal accounts cannot publish that class of app. **Do not** clear the financial declaration to bypass this.

**Deobfuscation warning** (no R8 mapping for version code 8) is harmless — `minifyEnabled false`. Ignore for now.

**Advertising ID declaration:** answer **No** (no ad SDKs / no AD_ID).

---

## Current Play / build state (as of handoff)

| Item | Status |
|------|--------|
| Personal Play account | Has app `ai.jora.reservly`; production rejected |
| Organization Play account | User started registration; **waiting** (D-U-N-S / verification) |
| AAB uploaded | versionCode **8**, versionName **1.0.7** — **no rebuild required** for org transfer |
| Managed publishing | Turned **ON** (publish manually after Google approval) |
| Countries | Prefer **India only** at first launch |
| Store assets | `play-store-assets/` (feature graphic, icon, phone + 7" + 10" screenshots) |
| Listing kit | `PLAY_STORE_LISTING.md` |
| Privacy URL | `https://reservly-frontend-real.vercel.app/privacy` |
| Delete account URL | `https://reservly-frontend-real.vercel.app/delete-account` |
| Git | Legal copy clarifying StaffingPros on `demo` (`831b80c`); merge to `main` if not already live |

**Important:** Transfer the **existing** app as-is. Do **not** create a second app with a new package id. Do **not** require a new AAB solely for this rejection.

---

## Account model (correct setup)

| Layer | Value |
|-------|--------|
| Play **Organization** developer account | **StaffingPros** (sole prop legal name + D-U-N-S + docs) |
| Play Console login | **New Google account** (cannot reuse Personal account Gmail as org owner) |
| $25 fee | **Yes**, again for the new Org developer account |
| App listing name | Jora Reservly |
| Brand | Jora AI = product of StaffingPros |

Invite the old personal Gmail as Admin on the Org account after setup if useful.

---

## D-U-N-S (what / where)

- **D-U-N-S** = Dun & Bradstreet 9-digit business ID; required for Play Organization accounts.
- Lookup / request: [dnb.com D-U-N-S](https://www.dnb.com/duns-number/lookup.html) or Google Play–linked flow (preferred when Console offers “Get a D-U-N-S”).
- Business area: **Gachibowli, Hyderabad, Telangana** — PIN **500032**.
- **dnb.com quirk:** some forms only accept **5-digit ZIP**. Set **Country = India** first; if still stuck, put `50003` in ZIP and full `… Gachibowli, Hyderabad, Telangana 500032, India` on address lines. Do not invent a US ZIP.

Registration can take **days to ~2 weeks**. Poll email / D&B / Play Console.

---

## Resume checklist (when D-U-N-S / org is ready)

### 1. Finish Organization Play account
- [ ] Org account verified (D-U-N-S matched to StaffingPros legal name/address)
- [ ] Payments profile linked with **same** legal details
- [ ] Paid $25 on the **new** Google account

### 2. Transfer app
- [ ] On **Personal** account: transfer **Jora Reservly** → Organization account  
  Help: Play Help → “Transfer apps to an organization account”
- [ ] Accept transfer on Org account
- [ ] Confirm package still `ai.jora.reservly`

### 3. Re-submit (same AAB OK)
- [ ] Financial features still: **Mobile payments and digital wallets**
- [ ] Privacy + delete-account URLs open correctly (merge `demo`→`main` if legal pages outdated)
- [ ] Policy status clear / new production release if Console requires it
- [ ] If Play demands a higher versionCode than 8 → bump + rebuild AAB once; otherwise reuse 8
- [ ] Managed publishing: submit → wait for approval → click **Publish** when ready
- [ ] Countries: India first

### 4. Smoke after go-live
- [ ] Install from Play (Internal first if still available)
- [ ] Login, bookings, invoices, QR, subscription/wallet screens

---

## Data safety / listing notes (already decided)

See `PLAY_STORE_LISTING.md`. Highlights:

- Target age: **18+** only  
- Ads: **No**  
- Account creation: username + password + other auth (OTP); Google OAuth **web-only** → don’t claim OAuth on Android unless shipped  
- Partial data deletion without account: **No** (optional); full account deletion URL required  
- Ephemeral: **No** for stored DB fields; voice support notes optional / shared via email  
- Location / photos / address: optional where applicable  

---

## Backend / product (unrelated but production)

- API: `https://reservly-api.onrender.com` (`env: production`)
- Mobile build uses `.env.mobile` → that API
- Branch: develop on `demo`, promote to `main` for Vercel + prod API

---

## Do / don’t

| Do | Don’t |
|----|--------|
| Org account under StaffingPros | Clear financial features to pass review |
| Transfer existing app | New package id / duplicate listing |
| Keep India-only first | “All countries” day one |
| Merge legal pages to `main` | Assume Personal account can republish as-is |

---

## Open follow-ups (product)

- Invoice walk-in form: add **name** autocomplete (same as phone/email) — see app change if landed in same PR/session.
- After Org publish: optional R8 + mapping file later.
