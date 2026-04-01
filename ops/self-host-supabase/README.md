# Self-Host Supabase on VPS

This folder contains repeatable scripts for Track A migration:
- bootstrap VPS
- deploy self-host Supabase stack
- backup/restore basics
- health checks
- cutover checklist with short read-only window

## 1) Bootstrap VPS

```bash
cd ops/self-host-supabase
sudo bash bootstrap-vps.sh
```

What it does:
- installs Docker Engine + Compose plugin
- adds `apdeploy` to docker group
- prepares `/opt/ap-supabase` directories

## 2) Deploy Supabase Stack

Create env file:

```bash
cp env.example .env
```

Fill values, then:

```bash
bash deploy-supabase.sh
```

## 3) Optional TLS Reverse Proxy

Use `nginx-supabase.conf.template` and your domain:
- `supabase.<domain>`
- `studio.<domain>`

Issue certs with certbot.

## 4) Backups

```bash
bash backup-postgres.sh
```

Add to cron:

```cron
0 3 * * * /opt/ap-supabase/ops/self-host-supabase/backup-postgres.sh >> /var/log/ap-supabase-backup.log 2>&1
```

## 5) Health Check

```bash
bash healthcheck.sh
```

## 6) Cutover

Follow `cutover-checklist.md` step-by-step.

