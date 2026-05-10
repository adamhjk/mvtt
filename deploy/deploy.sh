#!/usr/bin/env bash
# Deploy or update mvtt on the current host.
#
# Idempotent: safe to re-run. On first run, copies deploy/env from
# the example and exits so you can fill it in. On subsequent runs:
# pulls (if a tracking branch exists and the tree is clean), installs
# deps, rebuilds the client, refreshes the systemd unit if anything
# about the deploy shape changed, starts or restarts the service, and
# refreshes Caddy's reverse-proxy config for the same domain.
#
# Auto-detects:
#   SOURCE_DIR    = the parent of this script's directory (the repo)
#   SERVICE_USER  = whoami at invocation time
#   SERVICE_GROUP = id -gn
#   NODE_BIN      = command -v node
#
# Override any of these by exporting them before invoking the script.
#
# Requires: node >= 20, pnpm, git, systemd, caddy, sudo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$(dirname "$SCRIPT_DIR")}"
SERVICE_USER="${SERVICE_USER:-$(whoami)}"
SERVICE_GROUP="${SERVICE_GROUP:-$(id -gn)}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
UNIT_PATH="/etc/systemd/system/mvtt.service"
CADDYFILE_PATH="/etc/caddy/Caddyfile"
CADDY_MARKER="# Managed by mvtt deploy.sh — re-run pnpm run deploy to update."

if [[ -z "$NODE_BIN" ]]; then
	echo "error: node not found in PATH" >&2
	exit 1
fi

if ! command -v caddy >/dev/null 2>&1; then
	echo "error: caddy not found in PATH" >&2
	echo "install caddy and re-run; see https://caddyserver.com/docs/install" >&2
	echo "  Debian/Ubuntu: https://caddyserver.com/docs/install#debian-ubuntu-raspbian" >&2
	echo "  Fedora/RHEL:   sudo dnf install -y caddy" >&2
	echo "  Arch:          sudo pacman -S caddy" >&2
	exit 1
fi

cd "$SOURCE_DIR"

# 1. env file: bootstrap on first run, then bail so the operator can
# edit it. Subsequent runs just pass through.
if [[ ! -f deploy/env ]]; then
	echo "==> deploy/env not found; copying from env.example"
	cp deploy/env.example deploy/env
	chmod 600 deploy/env
	echo
	echo "Edit $SOURCE_DIR/deploy/env (set BETTER_AUTH_URL and TRUSTED_ORIGINS),"
	echo "then re-run this script."
	exit 0
fi

# 2. git pull, but only when it's safe and meaningful.
if [[ -d .git ]]; then
	if ! git diff-index --quiet HEAD --; then
		echo "==> working tree has local changes; skipping git pull"
	elif ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
		echo "==> no upstream branch; skipping git pull"
	else
		echo "==> git pull --ff-only"
		git pull --ff-only
	fi
fi

# 3. install + build (both idempotent; fast no-ops when up to date).
echo "==> pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

echo "==> pnpm --filter @vtt/client build"
pnpm --filter @vtt/client build

# 4. render the systemd unit for *this* checkout. ProtectHome=read-only
# rather than true, because the source may itself live under /home;
# ReadWritePaths punches through for the data dir regardless.
RENDERED_UNIT="$(cat <<EOF
[Unit]
Description=mvtt - modern virtual tabletop
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$SOURCE_DIR
EnvironmentFile=-$SOURCE_DIR/deploy/env
ExecStart=$NODE_BIN --import tsx packages/server/src/main.ts
Restart=on-failure
RestartSec=2
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mvtt

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
ReadWritePaths=$SOURCE_DIR/data
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=true
RestrictRealtime=true

[Install]
WantedBy=multi-user.target
EOF
)"

# 5. install or refresh the unit. Only writes (and only daemon-reloads)
# when content actually changes — no spurious sudo prompts on a no-op.
unit_changed=0
if [[ -f "$UNIT_PATH" ]] && diff -q <(printf '%s\n' "$RENDERED_UNIT") "$UNIT_PATH" >/dev/null 2>&1; then
	echo "==> systemd unit unchanged"
else
	echo "==> writing $UNIT_PATH"
	printf '%s\n' "$RENDERED_UNIT" | sudo tee "$UNIT_PATH" >/dev/null
	sudo systemctl daemon-reload
	unit_changed=1
fi

# 6. enable + start/restart. is-enabled / is-active are read-only and
# don't need sudo; only the mutating calls do.
if ! systemctl is-enabled mvtt >/dev/null 2>&1; then
	echo "==> enabling mvtt"
	sudo systemctl enable mvtt
fi

if systemctl is-active mvtt >/dev/null 2>&1; then
	echo "==> restarting mvtt"
	sudo systemctl restart mvtt
else
	echo "==> starting mvtt"
	sudo systemctl start mvtt
fi

# 7. derive the public hostname and bind port from deploy/env so Caddy
# stays in lockstep with whatever the server's actually doing.
get_env_var() {
	# Last assignment wins; strip surrounding quotes; ignore comments.
	grep -E "^[[:space:]]*$1=" deploy/env 2>/dev/null \
		| tail -1 \
		| sed -E "s/^[[:space:]]*$1=//; s/^[\"']//; s/[\"']\$//; s/[[:space:]]*#.*\$//"
}

BETTER_AUTH_URL="$(get_env_var BETTER_AUTH_URL)"
ENV_PORT="$(get_env_var PORT)"
ENV_PORT="${ENV_PORT:-3001}"

if [[ -z "$BETTER_AUTH_URL" ]]; then
	echo "error: BETTER_AUTH_URL not set in deploy/env; can't render Caddyfile" >&2
	exit 1
fi

# Strip scheme, path, and port to get the bare hostname Caddy uses as
# its site address. Caddy will request a Let's Encrypt cert for it.
DOMAIN="${BETTER_AUTH_URL#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%%/*}"
DOMAIN="${DOMAIN%%:*}"

if [[ -z "$DOMAIN" ]]; then
	echo "error: could not extract hostname from BETTER_AUTH_URL=$BETTER_AUTH_URL" >&2
	exit 1
fi

# 8. render the Caddyfile. The marker line lets us recognise the file
# as ours on subsequent runs and refuse to clobber an operator-written
# config we don't own.
RENDERED_CADDYFILE="$(cat <<EOF
$CADDY_MARKER

$DOMAIN {
	encode zstd gzip
	reverse_proxy localhost:$ENV_PORT
}
EOF
)"

if [[ -f "$CADDYFILE_PATH" ]] && ! grep -qF "$CADDY_MARKER" "$CADDYFILE_PATH"; then
	echo
	echo "warning: $CADDYFILE_PATH exists and is not managed by deploy.sh."
	echo "         leaving it alone. either delete it (next run regenerates) or"
	echo "         add this block to it manually:"
	echo
	printf '%s\n' "$RENDERED_CADDYFILE" | sed 's/^/    /'
	echo
else
	if [[ -f "$CADDYFILE_PATH" ]] && diff -q <(printf '%s\n' "$RENDERED_CADDYFILE") "$CADDYFILE_PATH" >/dev/null 2>&1; then
		echo "==> Caddyfile unchanged"
	else
		echo "==> writing $CADDYFILE_PATH"
		printf '%s\n' "$RENDERED_CADDYFILE" | sudo tee "$CADDYFILE_PATH" >/dev/null
		if systemctl is-active caddy >/dev/null 2>&1; then
			echo "==> reloading caddy"
			sudo systemctl reload caddy
		fi
	fi

	if ! systemctl is-enabled caddy >/dev/null 2>&1; then
		echo "==> enabling caddy"
		sudo systemctl enable caddy
	fi

	if ! systemctl is-active caddy >/dev/null 2>&1; then
		echo "==> starting caddy"
		sudo systemctl start caddy
	fi
fi

echo
echo "==> done. tail logs with: journalctl -u mvtt -f"
