# Deploying mvtt

A self-hosted single-box deploy: Caddy in front for TLS, mvtt as a
systemd service behind it, sqlite + plugin uploads on the local disk.
The deploy script auto-detects the source directory and current user,
so wherever you check the repo out, and as whichever user you run it,
_that's_ where the service runs from.

## What runs where

- **Caddy** — listens on :80/:443, terminates TLS (auto Let's Encrypt),
  reverse-proxies to `localhost:3001`. WebSocket upgrades pass through
  with no extra config.
- **mvtt** — `node --import tsx packages/server/src/main.ts` under
  systemd, binds `localhost:3001`. Serves both the built client and
  the `/ws` endpoint from the same port.
- **State** — `<checkout>/data/`: `mvtt.db` (auth + worlds + events +
  snapshots), `auth.secret` (auto-generated), `plugin-data/<worldId>/`
  (asset uploads). Nothing outside the checkout.

## One-time prerequisites

- Node 20+ and pnpm (`corepack enable` is enough)
- `git`, `systemd`, `sudo`
- **Caddy** — the deploy script configures it but doesn't install it.
  - Debian/Ubuntu: [official cloudsmith repo](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
  - Fedora/RHEL: `sudo dnf install -y caddy`
  - Arch: `sudo pacman -S caddy`

## Deploy / update

From the checkout, as the user the service should run as:

```sh
pnpm run deploy
```

That's it for both first-time setup and every subsequent update. The
script is idempotent:

1. **First run** — copies `deploy/env.example` to `deploy/env` and
   exits. Edit `deploy/env` (set `BETTER_AUTH_URL` and
   `TRUSTED_ORIGINS`), then re-run.
2. **Every run** —
   - `git pull --ff-only` if there's a tracking branch and the tree is clean
   - `pnpm install --frozen-lockfile`
   - `pnpm --filter @vtt/client build`
   - re-renders `/etc/systemd/system/mvtt.service` for the current `(source dir, user, group, node binary)` and writes only if it actually changed (no spurious sudo prompts on a no-op)
   - `systemctl enable` on first run, then `systemctl start` or `restart`
   - re-renders `/etc/caddy/Caddyfile` from the domain in `BETTER_AUTH_URL`, writes only if changed, and `systemctl reload`s Caddy

DNS for the domain has to point at this host the first time the
Caddyfile is written — Caddy will request a Let's Encrypt cert
immediately and rate-limits failed attempts.

`sudo` is required for the systemd / `/etc/caddy/` bits; the rest
runs as the invoking user. For unattended runs, add a sudoers entry
for `systemctl restart mvtt`, `systemctl reload caddy`, and the two
`tee` writes.

The first user to sign up after the service comes up becomes the
global game master.

### When the script won't touch Caddy

The script writes a marker comment to the Caddyfile on first install.
If `/etc/caddy/Caddyfile` already exists _without_ that marker (i.e.
you wrote it yourself), the script leaves it alone, prints the block
it would have written, and continues. Either delete the file (next run
regenerates) or paste the printed block into your own config.

## Logs

```sh
journalctl -u mvtt -f
```

## Backups

Everything is in `<checkout>/data/`. With the service running, sqlite's
WAL mode means the right way to snapshot the db is:

```sh
sqlite3 data/mvtt.db ".backup 'data/backup-$(date +%F).db'"
```

`plugin-data/` is just files; `rsync` is fine.

## Overrides

The script auto-detects everything reasonable, but you can override
any of these by exporting them before invoking it:

- `SOURCE_DIR` — defaults to the parent of the script's directory
- `SERVICE_USER` / `SERVICE_GROUP` — default to `whoami` / `id -gn`
- `NODE_BIN` — defaults to `command -v node`

```sh
NODE_BIN=/opt/node-22/bin/node pnpm run deploy
```
