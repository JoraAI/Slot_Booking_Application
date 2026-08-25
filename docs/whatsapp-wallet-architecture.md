# WhatsApp shared-platform + prepaid wallet

## Model

```text
WHATSAPP_PROVIDER=meta|twilio|gupshup  (default: meta)
        ↓
Reservly shared WhatsApp credentials (env only)
        ↓
Salon Enable WhatsApp (WhatsAppConfig SHARED / CONNECTED)
        ↓
Prepaid Wallet (paise) → reserve → send → finalize/release
```

- **Email / SMTP:** salon mailbox in Settings, or platform Resend/SMTP for auth OTP.
- **WhatsApp:** shared number only. Salons never paste Phone Number ID, access tokens, Twilio, or Gupshup secrets.
- **Connect** = opt-in (`POST /owner/whatsapp/connect`). **Disconnect** = opt-out.
- Empty wallet → `INSUFFICIENT_CREDITS`, no provider call; bookings + email still work.
- Provider is **invisible** to owners; flip `WHATSAPP_PROVIDER` in backend env.

## Pricing (≈1.2× wholesale, provider-aware)

Seeded tenant charges (INR/India, paise). Wholesale ≈ Meta category fee; Twilio adds ~$0.005 (~42p). Gupshup uses the same tenant rates as Meta by default (adjust via internal API if needed). **Not shown in the owner dashboard.**

| Category | Meta / Gupshup (1.2×) | Twilio (1.2×) |
|----------|----------------------|---------------|
| UTILITY | ₹0.60 (60p) | ₹1.10 (110p) |
| MARKETING | ₹1.02 (102p) | ₹1.52 (152p) |
| SERVICE | ₹0.48 (48p) | ₹0.98 (98p) |
| AUTHENTICATION | ₹0.36 (36p) | ₹0.86 (86p) |

- Booking / reminder / cancel / waitlist / test → **UTILITY**
- Owner custom / broadcast WhatsApp → **MARKETING**

You still pay Meta / Twilio / Gupshup separately; the wallet margin is yours.

## Env (platform)

```bash
WHATSAPP_PROVIDER=meta   # or twilio | gupshup

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

# Gupshup (Self-Serve API)
GUPSHUP_API_KEY=
GUPSHUP_APP_NAME=                 # src.name from Settings (not UUID)
GUPSHUP_APP_ID=bf9b2544-1967-469e-be55-79f478e2ae57
GUPSHUP_SOURCE=91XXXXXXXXXX
GUPSHUP_DISPLAY_PHONE=+91XXXXXXXXXX
GUPSHUP_TEMPLATE_UTILITY=         # approved template UUID
GUPSHUP_TEMPLATE_MARKETING=       # approved template UUID
```

### Gupshup templates

Outside the 24-hour session window, Gupshup requires APPROVED templates. Prefer existing single-variable templates, or create:

| Env | Category | Suggested name | Body |
|-----|----------|----------------|------|
| `GUPSHUP_TEMPLATE_UTILITY` | UTILITY | `reservly_utility` | `{{1}}` |
| `GUPSHUP_TEMPLATE_MARKETING` | MARKETING | `reservly_marketing` | `{{1}}` |

After Meta approval, copy each template’s UUID into env. List approved templates:

```bash
curl -s "https://api.gupshup.io/wa/app/${GUPSHUP_APP_ID}/template?templateStatus=APPROVED" \
  -H "apikey: $GUPSHUP_API_KEY"
```

Send path: session text/image/CTA via `POST /wa/api/v1/msg`; on outside-session errors, fall back to `POST /wa/api/v1/template/msg` with `params: [fullMessage]`.

## Owner UX

1. Top up WhatsApp Wallet (Notifications).
2. Settings → **Enable WhatsApp**.
3. Tick WhatsApp customers / WhatsApp me → Save.
4. Set Owner WhatsApp (customer contact line in messages).
5. Custom / promo sends show that marketing rate costs more than normal alerts.

## Removed

Per-salon LEGACY Meta / Twilio credential forms.
`Business.metaWhatsapp*` fields may still exist in the DB but are ignored for sending.
