# WhatsApp shared-platform + prepaid wallet

## Model

```text
WHATSAPP_PROVIDER=meta|twilio  (default: meta)
        ↓
Reservly shared WhatsApp credentials (env only)
        ↓
Salon Enable WhatsApp (WhatsAppConfig SHARED / CONNECTED)
        ↓
Prepaid Wallet (paise) → reserve → send → finalize/release
```

- **Email / SMTP:** unchanged — each salon configures their own mailbox in Settings (not Twilio Email).
- **WhatsApp:** shared number only. Salons never paste Phone Number ID, access tokens, or Twilio secrets.
- **Connect** = opt-in (`POST /owner/whatsapp/connect`). **Disconnect** = opt-out.
- Empty wallet → `INSUFFICIENT_CREDITS`, no provider call; bookings + email still work.
- Provider is **invisible** to owners; flip `WHATSAPP_PROVIDER` in backend env.

## Pricing (≈1.6× wholesale, provider-aware)

Seeded tenant charges (INR/India, paise). Wholesale ≈ Meta category fee; Twilio adds ~$0.005 (~42p):

| Category | Meta (1.6×) | Twilio (1.6×) |
|----------|-------------|---------------|
| UTILITY | ₹0.80 (80p) | ₹1.47 (147p) |
| MARKETING | ₹1.36 (136p) | ₹2.03 (203p) |
| SERVICE | ₹0.64 (64p) | ₹1.31 (131p) |
| AUTHENTICATION | ₹0.48 (48p) | ₹1.15 (115p) |

- Booking / reminder / cancel / waitlist / test → **UTILITY**
- Owner custom / broadcast WhatsApp → **MARKETING** (UI highlights higher cost)

You still pay Meta (and Twilio when selected) separately; the wallet margin is yours.

## Env (platform)

```bash
WHATSAPP_PROVIDER=meta   # or twilio

# Meta
META_WHATSAPP_PHONE_NUMBER_ID=
META_WHATSAPP_ACCESS_TOKEN=
META_WHATSAPP_DISPLAY_PHONE=
META_WHATSAPP_TEMPLATE_UTILITY=
META_WHATSAPP_TEMPLATE_MARKETING=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+1...
TWILIO_WHATSAPP_CONTENT_SID_UTILITY=
TWILIO_WHATSAPP_CONTENT_SID_MARKETING=
```

## Owner UX

1. Top up WhatsApp Wallet (Notifications).
2. Settings → **Enable WhatsApp**.
3. Tick WhatsApp customers / WhatsApp me → Save.
4. Set Owner WhatsApp (customer contact line in messages).
5. Custom / promo sends show that marketing rate costs more than normal alerts.

## Removed

Per-salon LEGACY Meta / Twilio credential forms.
`Business.metaWhatsapp*` fields may still exist in the DB but are ignored for sending.
