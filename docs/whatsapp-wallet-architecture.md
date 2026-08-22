# WhatsApp shared-platform + prepaid wallet

## Model

```text
Reservly Meta Cloud API (env: META_WHATSAPP_PHONE_NUMBER_ID + ACCESS_TOKEN)
        ↓
Salon Enable WhatsApp (WhatsAppConfig SHARED / CONNECTED)
        ↓
Prepaid Wallet (paise) → reserve → send → finalize/release
```

- **Email / SMTP:** unchanged — each salon still configures their own mailbox in Settings.
- **WhatsApp:** shared number only. Salons never paste Phone Number ID or access tokens.
- **Connect** = opt-in (`POST /owner/whatsapp/connect`). **Disconnect** = opt-out.
- Empty wallet → `INSUFFICIENT_CREDITS`, no Meta call; bookings + email still work.

## Pricing (2× markup)

Seeded tenant charges (INR/India, paise) ≈ **2×** modeled Meta cost for the same volume:

| Category | Tenant charge |
|----------|----------------|
| UTILITY | ₹1.00 (100p) |
| MARKETING | ₹1.70 (170p) |
| SERVICE | ₹0.80 (80p) |
| AUTHENTICATION | ₹0.60 (60p) |

You still pay Meta separately at Meta’s rates; the wallet margin is yours.

## Env (platform)

`META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN`, optional
`META_WHATSAPP_DISPLAY_PHONE`, `META_WHATSAPP_TEMPLATE_UTILITY`, `META_WHATSAPP_TEMPLATE_MARKETING`.

## Owner UX

1. Top up WhatsApp Wallet (Notifications).
2. Settings → **Enable WhatsApp**.
3. Tick WhatsApp customers / WhatsApp me → Save.
4. Set Owner WhatsApp (customer contact line in messages).

## Removed

Per-salon LEGACY Meta credential forms and `/owner/whatsapp/connect` token body.
`Business.metaWhatsapp*` fields may still exist in the DB but are ignored for sending.
