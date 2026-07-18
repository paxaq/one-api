# VPS deploy pack (arm64 / Podman)

Target host: Oracle Linux aarch64 (`opc@kr-arm-2`). Coexists with Hermes and Tailscale.

## Layout

| File | Purpose |
|------|---------|
| `docker-compose.yml` | one-api + Postgres 16 + Redis 7 + Caddy |
| `Dockerfile.vps` | Slim image (modern + open themes, Go 1.26) |
| `Caddyfile` | TLS for `oneapi.unit23api.com` + HTTP :80 smoke |
| `.env.example` | Secret placeholders |
| `backup-postgres.sh` | `pg_dump -Fc` into `./backups/` |

## Prerequisites

- Podman 4+ (or Docker) with compose provider
- OCI NSG + host firewalld allowing **80/443**
- Do not stop Hermes or Tailscale

## Quick start

```bash
cd deploy/vps
cp .env.example .env
# edit .env

# Build arm64 image (prefer off-box if disk is tight):
podman build -t localhost/unit23/one-api:vps -f Dockerfile.vps ../..

podman compose -f docker-compose.yml up -d
curl -fsS http://127.0.0.1/api/status
```

## Restore from Railway dump

```bash
podman compose -f docker-compose.yml stop one-api
podman compose -f docker-compose.yml exec -T postgres \
  pg_restore --clean --if-exists -U oneapi -d oneapi < /path/to/railway.dump
podman compose -f docker-compose.yml start one-api
```

## Cutover checklist

1. Final Railway dump and restore
2. DNS `oneapi.unit23api.com` → VPS public IP
3. Stripe webhook → `https://oneapi.unit23api.com/api/payment/stripe/webhook`
4. Smoke login, chat, top-up path
5. Keep Railway 7–14 days as rollback

## Backup

```bash
./backup-postgres.sh
```
