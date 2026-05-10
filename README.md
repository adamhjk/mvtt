# mvtt

mvtt is a self hosted virtual tabletop, distributed as free software. It's designed to be:

* Easy to use for players and GMs - it's flexible enough to support many different game systems, but uses the same fundamental design language, so that if you learn how to play one game on mvtt, you know how to play others.
* Easy to extend with an AI Agent. Almost everything in mvtt is a plugin, and mvtt ships with skills that teach agents how to create new game systems, or extend existing features. 
* Free and open source.

## Status

Alpha. It might eat your data. No guarantees on back-compat. Nobody, including the author, has run a game with it yet.

## Usage

To self-host, see [Deployment](#deployment) below. To hack on it locally, see [Development](#development).

## Development

mvtt is a TypeScript monorepo: a tiny substrate plus a swarm of plugins, all glued together with pnpm workspaces. The client is Solid + Vite; the server is plain Node speaking HTTP and WebSockets. Tests run under vitest.

### Prerequisites

- **Node.js 20 or newer** (24 is what the maintainer runs; a `volta` pin is in `package.json`).
- **pnpm 10 or newer.** If you have `corepack` enabled, `corepack enable` will pick up the version pinned in `package.json`. Otherwise: `npm install -g pnpm`.
- A C toolchain that can build `better-sqlite3` against your Node version. On macOS this means Xcode command line tools; on Debian/Ubuntu `build-essential` and `python3`; on Arch `base-devel`.

No database server, no Redis, no Docker. Persistence is a SQLite file under `./data/`.

### Get the code and install

```sh
git clone <this repo> mvtt
cd mvtt
pnpm install
```

`pnpm install` builds native modules (notably `better-sqlite3`) and wires every workspace package together.

### Run it in dev mode

```sh
pnpm dev
```

This starts two processes in parallel:

- **`@vtt/server`** on `http://localhost:3001` — the substrate, the WebSocket endpoint, the auth API, and SQLite persistence under `./data/`. It runs under `tsx --watch`, so edits to server or plugin code restart it automatically.
- **`@vtt/client`** on `http://localhost:5173` — Vite dev server with HMR. The client proxies `/ws` and the auth/API routes through to the server.

Open `http://localhost:5173`. The **first account that signs up becomes the Game Master**; every subsequent signup is a player. There is no separate admin password or invite flow at this stage — just sign up first.

If you only want to run one half:

```sh
pnpm dev:server    # just the Node server
pnpm dev:client    # just the Vite client (expects a server already running)
```

### Single-port mode (closer to deploy shape)

The server can also serve the built client on its own port, with no Vite in the loop:

```sh
pnpm --filter @vtt/client build
pnpm --filter @vtt/server start
```

Now everything — `/`, `/assets/*`, the auth API, and `/ws` — is on `http://localhost:3001`.

### Tests and typechecks

Both must be green before any change is considered done.

```sh
pnpm test          # vitest: unit tests + jsdom component tests + ws wire smokes, one pass
pnpm test:watch    # the same, in watch mode
pnpm -r typecheck  # strict TS across every workspace package
```

See `CLAUDE.md` for the testing contract each plugin is expected to meet (unit, smoke, and jsdom component tests).

### Resetting local state

Local state — the auth database, world snapshots, the auth secret — lives in `./data/`. To wipe everything and start over (including re-creating the Game Master on next signup):

```sh
pnpm reset
```

This is a destructive `rm -rf data`; only run it when you actually want to forget every account, world, and uploaded asset.

### Repository layout

```
packages/
  substrate/         tiny core: World, EventBus, CommandPipeline, ws server/client, multi-world layer
  server/            Node entry point: HTTP + WebSocket, auth, persistence, plugin loading
  client/            Vite + Solid app
  shell-default/     signed-in chrome (header, world picker, layout)
  shell-workbench/   workbench surface used by some plugins
  plugin-ping/       reference minimal plugin (Ping → Pong)
  system-simple/     reference game-system plugin
  scene/, tokens/, dice-tray/, characters/, books/, pdf-book/, notes/,
  comms/, identity/, permissions/, plugin-resolution/, assets/,
  auth/, persistence-sqlite/   ...the rest of the plugin set
design/              architectural notes — start with `basics.md`
.claude/skills/      ECS and DDD authoring guides (used by AI agents)
scripts/             license header tooling
```

If you're going to write code, read `design/basics.md` and `CLAUDE.md` first — they lay out the substrate, the trust boundary, the plugin model, and the conventions every plugin is expected to follow.

## Deployment

mvtt deploys as a single Node process behind a TLS-terminating reverse proxy. The recommended shape on a Linux box is **systemd + Caddy**: Caddy obtains and renews a Let's Encrypt cert and proxies to the mvtt service on `localhost:3001`. SQLite, the auth secret, and per-world plugin uploads all live under `<checkout>/data/` — there's no external database, no Docker volume, no object storage to wire up.

### Prerequisites on the box

- Node 20+ and pnpm (`corepack enable` is enough)
- `git`, `systemd`, `sudo`, and a C toolchain (for `better-sqlite3`)
- **Caddy** — `deploy.sh` configures it but doesn't install it. Use the [official cloudsmith repo](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) on Debian/Ubuntu, `sudo dnf install -y caddy` on Fedora/RHEL, `sudo pacman -S caddy` on Arch.

### Initial deploy

As the user the service should run as (a regular user is fine — it doesn't need to be root, and the data dir lives in the checkout, owned by that user):

```sh
git clone <this repo> mvtt
cd mvtt
pnpm run deploy
```

The first `pnpm run deploy` copies `deploy/env.example` to `deploy/env` and stops so you can fill it in:

```sh
$EDITOR deploy/env       # set BETTER_AUTH_URL and TRUSTED_ORIGINS to your https://domain
pnpm run deploy          # second run installs the systemd unit, configures Caddy, starts both
```

DNS for the domain has to point at this host before that second run — Caddy requests a Let's Encrypt cert immediately and rate-limits failed attempts.

The first user to sign up after the service comes up becomes the global Game Master.

### Updates

Same command, every time:

```sh
pnpm run deploy
```

It's idempotent. The script auto-detects the source directory, the user/group it's invoked as, and the path to `node`, then:

1. `git pull --ff-only` if there's a tracking branch and the working tree is clean
2. `pnpm install --frozen-lockfile`
3. `pnpm --filter @vtt/client build`
4. Re-renders `/etc/systemd/system/mvtt.service` for the current host and writes it only if the rendered content differs (no spurious sudo prompts on a no-op)
5. `systemctl enable` on first run, then `start` or `restart`
6. Re-renders `/etc/caddy/Caddyfile` from the domain in `BETTER_AUTH_URL`, writes only on change, and `systemctl reload`s Caddy

If `/etc/caddy/Caddyfile` already exists without the script's marker comment (i.e. you wrote it yourself), the script leaves it alone and prints the block it would have written so you can paste it into your own config.

`sudo` is required for the systemd / `/etc/caddy/` bits; everything else runs as the invoking user. For unattended runs, add a sudoers entry for `systemctl restart mvtt`, `systemctl reload caddy`, and the two `tee` writes.

### Logs and backups

```sh
journalctl -u mvtt -f                                        # tail logs
sqlite3 data/mvtt.db ".backup 'data/backup-$(date +%F).db'"  # snapshot the db (WAL-safe)
rsync -a data/plugin-data/ /backup/plugin-data/              # back up uploads
```

See [`deploy/README.md`](./deploy/README.md) for the full deploy reference, including overrides for `SOURCE_DIR` / `SERVICE_USER` / `NODE_BIN`.

## License

mvtt is free software, licensed under the **GNU Affero General Public License, version 3 (AGPLv3)**. The full license text is in [`COPYING`](./COPYING); a short top-level notice is in [`LICENSE`](./LICENSE). Source files carry an SPDX-style header (see `scripts/license-header.txt`); `pnpm license:apply` re-applies it to any file missing one.

In plain language, the AGPL means:

- You can run mvtt for any purpose, study how it works, modify it, and share it.
- If you distribute mvtt — *or run a modified version of it as a network service that other people interact with* — you must make the corresponding source code (including your modifications) available to those users under the same AGPLv3 terms.
- There is no warranty. mvtt is alpha software; see the Status section.

### Icons

The icons under [`assets/icons/`](./assets/icons) are **not** covered by the AGPL. They come from [game-icons.net](https://game-icons.net) and are licensed under **Creative Commons Attribution 3.0 (CC BY 3.0)**, with a small number of CC0 contributions. Per-author attribution and the full list of contributors live in [`assets/icons/license.txt`](./assets/icons/license.txt); if you redistribute or build on these icons, follow the CC BY 3.0 attribution requirement and keep that file alongside them.

## Contributions

mvtt is closed to contributions, but open to your ideas and issues. We will implement them with an agent under our control - in this era, it is impossible to safely review and accept external contributions.

