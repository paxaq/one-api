# VPS production deploy (Phase 1 complete)

UNIT23 one-api runs on a self-managed **Oracle Linux aarch64** host, exposed publicly through a **Cloudflare Tunnel** (`cloudflared`). Hermes and Tailscale coexist on the same machine and must not be stopped for day-to-day ops.

| Item | Value |
|------|--------|
| Host alias | `opc@kr-arm-2` |
| Public product URL | `https://oneapi.unit23api.com` |
| Ingress | Cloudflare Tunnel → `http://127.0.0.1:3000` |
| App process | systemd user unit `one-api.service` |
| Tunnel process | systemd user unit `cloudflared.service` |
| Database | Postgres 16 (Podman `oneapi-pg`, bind `127.0.0.1:5432`) |
| Cache | Redis 7 (Podman `oneapi-redis`, bind `127.0.0.1:6379`) |
| UI theme | `THEME=open` |
| Min Stripe top-up | **$5** (`MIN_TOPUP_USD` / options `MinTopUpUSD`) |
| Email | Resend · from `oneapi@unit23.xyz` (domain **unit23.xyz** verified in Resend) |
| Public 80/443 | **Closed** (firewalld + no Caddy); tunnel only |
| Admin access | SSH / Tailscale (not public HTTP) |

## Phase 1 status

Completed:

- [x] Product branch merged with upstream `Laisky/one-api` while keeping Stripe, Resend/`EmailProvider`, and open theme (`railway-sync-upstream`)
- [x] VPS deploy pack in-repo (`deploy/vps/*`)
- [x] Runtime on `kr-arm-2` with Postgres + Redis + one-api
- [x] Railway Postgres dump restored (plain SQL for PG16)
- [x] DNS: `oneapi.unit23api.com` CNAME → Cloudflare Tunnel (proxied)
- [x] `cloudflared` connector registered and running
- [x] Host firewall no longer exposes http/https; direct public IP access blocked
- [x] `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` synced onto VPS `.env` (from Railway)
- [x] `RESEND_API_KEY` + `EMAIL_PROVIDER=resend` on VPS; DB `SMTPFrom=oneapi@unit23.xyz`
- [x] Minimum top-up lowered to **$5** (env, options table, open UI + binary rebuild)

Still operator / Phase 2:

- [ ] Confirm Stripe Dashboard webhook URL is `https://oneapi.unit23api.com/api/payment/stripe/webhook` (not Railway)
- [ ] Rotate temporary smoke passwords and any tokens shared during cutover
- [ ] Decommission Railway after a 7–14 day soak (optional rollback window)
- [ ] Optional: weekly upstream merge cadence; upgrade `cloudflared` binary

## Repository layout

| Path | Purpose |
|------|---------|
| `docker-compose.yml` | Reference full stack (one-api image + Postgres + Redis + Caddy). **Production currently uses hybrid host runtime** (see below). |
| `Dockerfile.vps` | Slim arm64 image (modern + open themes, Go 1.26) for rebuilds |
| `Caddyfile` | Optional reverse-proxy config if you re-open 80/443 without tunnel |
| `.env.example` | Secret placeholders (`SESSION_SECRET` must be 16/24/32 bytes for securecookie) |
| `backup-postgres.sh` | `pg_dump -Fc` helper for compose-style stacks |
| `README.md` | This document |

## Production architecture (as deployed)

```text
                    Internet
                        │
              Cloudflare edge (HTTPS)
                        │
              Cloudflare Tunnel (QUIC)
                        │
              cloudflared (user systemd)
                        │
                 one-api :3000 (user systemd)
                    │           │
              Postgres:5432   Redis:6379
              (Podman, localhost only)

Admin: SSH / Tailscale → host
Coexist: Hermes gateway (do not stop)
```

### Why hybrid runtime

Disk on the free-tier ARM host is tight. Phase 1 uses:

1. **Native Go binary** built on the host (`~/one-api/bin/one-api`) with embedded `web/build/open`
2. **Podman** only for Postgres and Redis
3. **cloudflared** for ingress (no public Caddy)

`docker-compose.yml` remains the documented path to rebuild a full containerized stack later.

## Host paths (production)

| Path | Purpose |
|------|---------|
| `/home/opc/one-api/` | Source tree + binary `bin/one-api` |
| `/home/opc/one-api/deploy/vps/.env` | Runtime secrets (mode `600`, **not** in git) |
| `/home/opc/one-api/deploy/vps/data/postgres` | Postgres data directory |
| `/home/opc/one-api/deploy/vps/data/redis` | Redis data directory |
| `/home/opc/one-api/deploy/vps/logs/` | App log directory |
| `/home/opc/.cloudflared/cert.pem` | Tunnel origin cert (secret) |
| `/home/opc/.cloudflared/config.yml` | Tunnel ingress config |
| `/home/opc/.cloudflared/<tunnel-id>.json` | Tunnel credentials (secret) |
| `~/.config/systemd/user/one-api.service` | App unit |
| `~/.config/systemd/user/cloudflared.service` | Tunnel unit |

User linger is enabled (`loginctl enable-linger opc`) so user units survive logout.

## Service management

```bash
# App
systemctl --user status one-api
systemctl --user restart one-api
journalctl --user -u one-api -f

# Tunnel
systemctl --user status cloudflared
systemctl --user restart cloudflared
journalctl --user -u cloudflared -f
cloudflared tunnel info one-api

# Data plane
podman ps
podman logs oneapi-pg
podman logs oneapi-redis

# Health
curl -fsS http://127.0.0.1:3000/api/status
curl -fsS https://oneapi.unit23api.com/api/status
```

## Secrets and env

Copy from example only as a template:

```bash
cp deploy/vps/.env.example deploy/vps/.env
chmod 600 deploy/vps/.env
# edit SQL_DSN / REDIS / SESSION_SECRET / Stripe / Resend as needed
```

Important:

- `SESSION_SECRET` length must be **16, 24, or 32 bytes** (AES for securecookie). Prefer a 32-character secret or base64-decoded 32-byte value as documented in `.env.example`.
- `MIN_TOPUP_USD=5` — also stored as options key `MinTopUpUSD` (UI open theme embeds the same floor).
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (env). Webhook path: `/api/payment/stripe/webhook`.
- Resend: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (env). Sender display uses options `SMTPFrom` (production: `oneapi@unit23.xyz`) + `SystemName`.
- Postgres and Redis on production bind to **localhost** only.
- Never commit `.env`, `cert.pem`, or tunnel credential JSON.

### Payments and email (product config)

| Setting | Production value | Where |
|---------|------------------|--------|
| Minimum top-up | **$5 USD** | `MIN_TOPUP_USD` env + `options.MinTopUpUSD` + TopUp UI |
| Preset amounts (open UI) | $5, $10, $20, $50, $100 | `web/open/.../TopUpPage.tsx` |
| Stripe secret / webhook secret | set on host | VPS `.env` |
| Email provider | `resend` | env + `options.EmailProvider` |
| Resend API key | set on host | VPS `.env` |
| From address | `oneapi@unit23.xyz` | `options.SMTPFrom` |
| Resend verified domain | `unit23.xyz` | Resend dashboard (not `unit23api.com`) |

Product site hostname is **`oneapi.unit23api.com`**. Transactional mail uses the verified Resend domain **`unit23.xyz`** — that split is intentional and correct.

## Cloudflare Tunnel notes

- Tunnel name: `one-api`
- Ingress hostname: `oneapi.unit23api.com` → `http://127.0.0.1:3000`
- DNS: proxied **CNAME** to `{tunnel-id}.cfargotunnel.com`
- Public host **firewalld** should list only `ssh` (and `dhcpv6-client`), **not** `http`/`https`
- Direct hits to the VPS public IP on 80/443 are expected to fail

Install / reinstall tunnel connector (if credentials already exist):

```bash
# config.yml already points at credentials-file and hostname
systemctl --user enable --now cloudflared
```

To recreate DNS after record conflicts, delete existing A/AAAA/CNAME for `oneapi.unit23api.com`, then:

```bash
cloudflared tunnel route dns --overwrite-dns one-api oneapi.unit23api.com
```

## Rebuild app binary (arm64 host)

```bash
cd ~/one-api
# Frontend (open theme) if UI changed:
#   export PATH="$HOME/.hermes/node/bin:$PATH"
#   cd web/open && yarn install && yarn build
#   # vite outputs to web/build/open
CGO_ENABLED=1 go build -trimpath -ldflags "-s -w" -o bin/one-api .
systemctl --user restart one-api
```

Or build image off-box and transfer:

```bash
docker buildx build --platform linux/arm64 -t unit23/one-api:vps -f deploy/vps/Dockerfile.vps --load .
docker save unit23/one-api:vps | gzip > one-api-vps.tar.gz
# scp + podman load on host, then wire compose if desired
```

## Database backup and restore

### Backup (running Podman Postgres)

```bash
mkdir -p ~/one-api/deploy/vps/backups
podman exec oneapi-pg pg_dump -U oneapi -Fc oneapi \
  > ~/one-api/deploy/vps/backups/oneapi-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Prefer **plain SQL** when moving across major Postgres versions:

```bash
podman exec oneapi-pg pg_dump -U oneapi --no-owner --no-acl oneapi \
  > ~/one-api/deploy/vps/backups/oneapi-$(date -u +%Y%m%dT%H%M%SZ).sql
```

### Restore (example)

```bash
systemctl --user stop one-api
podman exec oneapi-pg dropdb -U oneapi --if-exists oneapi
podman exec oneapi-pg createdb -U oneapi oneapi
# Custom format (same major version):
# podman exec -i oneapi-pg pg_restore -U oneapi -d oneapi --no-owner --no-acl < backup.dump
# Plain SQL (cross-version friendlier):
podman exec -i oneapi-pg psql -U oneapi -d oneapi < backup.sql
systemctl --user start one-api
```

Phase 1 production data was migrated from Railway using a **plain SQL** dump (Railway Postgres 18 → host Postgres 16; strip PG18-only GUCs such as `transaction_timeout` if restore complains).

## Optional: re-enable public 80/443 (not recommended while tunnel is primary)

Only for emergency bypass:

1. `sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload`
2. Start Caddy with host networking using `Caddyfile` / `Caddyfile.host`
3. Ensure OCI security rules allow 80/443 if needed

Prefer fixing `cloudflared` instead of long-term public exposure.

## Coexistence rules

Do **not** stop or remove:

- `hermes-gateway.service` (user)
- `tailscaled` (system)
- Archived project tarball under `~/archives/` (if present)

## Smoke checklist

```bash
systemctl --user is-active one-api cloudflared
podman ps | grep oneapi
curl -fsS http://127.0.0.1:3000/api/status | jq .success
curl -fsS https://oneapi.unit23api.com/api/status | jq .success,.data.system_name
# Authenticated API (use a valid token):
# curl -fsS https://oneapi.unit23api.com/v1/models -H "Authorization: Bearer $KEY"
```

## Related docs

- Product positioning: [USAGE.md](../../USAGE.md)
- Railway-oriented env sample (legacy): [.env.railway.example](../../.env.railway.example)
- Kubernetes (upstream style): [docs/manuals/k8s.md](../../docs/manuals/k8s.md)
