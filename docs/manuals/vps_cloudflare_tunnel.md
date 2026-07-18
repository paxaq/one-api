# VPS + Cloudflare Tunnel operations (UNIT23)

This manual describes the **Phase 1 production** layout for UNIT23 one-api on Oracle Cloud arm64 with Cloudflare Tunnel ingress.

For file layout, rebuild, and backup commands, see [deploy/vps/README.md](../../deploy/vps/README.md).

## Goals of Phase 1

1. Move production off Railway onto a VPS (VPS is now the sole production host).
2. Keep product customizations: Stripe Checkout, Resend email, open theme.
3. Expose `https://oneapi.unit23api.com` via Cloudflare Tunnel without opening origin 80/443.
4. Force browser/API clients to HTTPS at the Cloudflare edge (Always Use HTTPS).

## Traffic path

```text
Client
  → Cloudflare (HTTPS, proxied DNS)
  → Cloudflare Tunnel edge
  → cloudflared on VPS (outbound QUIC)
  → one-api listening on 127.0.0.1:3000
```

DNS record shape:

- Type: **CNAME**
- Name: `oneapi`
- Target: `<tunnel-uuid>.cfargotunnel.com`
- Proxy: **Proxied** (orange cloud)

HTTPS-only (Cloudflare Dashboard → SSL/TLS → Edge Certificates):

- **Always Use HTTPS** = On (HTTP → 301 to HTTPS)
- Verified: `http://oneapi.unit23api.com` redirects; `https://` returns 200

## Host firewall posture

Expected `firewall-cmd --list-services` on the app host:

```text
dhcpv6-client ssh
```

Do **not** publish Postgres (`5432`) or Redis (`6379`) on `0.0.0.0`.

## systemd units (user)

| Unit | Role |
|------|------|
| `one-api.service` | Application binary |
| `cloudflared.service` | Tunnel connector |

```bash
systemctl --user status one-api cloudflared
loginctl show-user opc -p Linger   # should be yes
```

## Failure modes

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Domain 502/1033 | `cloudflared` down | `systemctl --user restart cloudflared`; check `tunnel info` |
| Domain 521 (legacy) | Origin 80/443 closed without tunnel | Do not re-open ports; fix tunnel |
| Login cookie ignored on HTTP | `Secure` session cookies | Always use HTTPS product URL |
| App up, empty data | Wrong `SQL_DSN` or Postgres container stopped | `podman ps`; verify `.env` |

## Security notes

- Tunnel origin certificate (`cert.pem`) and `*.json` credentials are secrets; keep them only under `~/.cloudflared/` on the host.
- Do not commit Cloudflare API tokens, tunnel tokens, or `cert-*.pem` downloads into git.
- After any cutover smoke that resets admin passwords, rotate credentials again for production use.

## Billing and email (Phase 1+)

| Item | Status |
|------|--------|
| Stripe keys on VPS `.env` | Configured (synced from Railway) |
| Stripe webhook URL in Dashboard | Confirm → `https://oneapi.unit23api.com/api/payment/stripe/webhook` |
| Minimum top-up | **$5** (`MIN_TOPUP_USD` / `MinTopUpUSD`) |
| Resend API key + `EMAIL_PROVIDER=resend` | Configured on VPS |
| From address | `oneapi@unit23.xyz` (`options.SMTPFrom`) |
| Resend domain | **`unit23.xyz` verified** (mail domain; product URL remains `unit23api.com`) |

## Railway decommission

Project **`oneapi_railway`** (`47e562ca-e39c-4325-bc97-96a7e52cb4f7`) was deleted with Railway CLI (`railway delete --project … --yes`). Services that lived there: `one-api`, `Postgres`, `Redis`. Production traffic is VPS + Cloudflare Tunnel only.

Repo still contains `Dockerfile.railway` / `railway.json` as optional emergency references, not an active deploy.

## Phase 2 follow-ups

- Confirm Stripe Dashboard webhook points at the tunnel hostname (not Railway)
- Optional `cloudflared` binary upgrade when convenient
- Rotate any temporary cutover passwords
