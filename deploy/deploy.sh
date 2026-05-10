#!/usr/bin/env bash
# Deploy or update mvtt on the current host.
#
# Idempotent: safe to re-run. On first run, copies deploy/env from
# the example and exits so you can fill it in. On subsequent runs:
# pulls (if a tracking branch exists and the tree is clean), installs
# deps, rebuilds the client, refreshes the systemd unit if anything
# about the deploy shape changed, then starts or restarts the service.
#
# Auto-detects:
#   SOURCE_DIR    = the parent of this script's directory (the repo)
#   SERVICE_USER  = whoami at invocation time
#   SERVICE_GROUP = id -gn
#   NODE_BIN      = command -v node
#
# Override any of these by exporting them before invoking the script.
#
# Requires: node >= 20, pnpm, git, systemd, sudo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$(dirname "$SCRIPT_DIR")}"
SERVICE_USER="${SERVICE_USER:-$(whoami)}"
SERVICE_GROUP="${SERVICE_GROUP:-$(id -gn)}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
UNIT_PATH="/etc/systemd/system/mvtt.service"

if [[ -z "$NODE_BIN" ]]; then
	echo "error: node not found in PATH" >&2
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

# 6. enable + start/restart.
if ! sudo systemctl is-enabled mvtt >/dev/null 2>&1; then
	echo "==> enabling mvtt"
	sudo systemctl enable mvtt
fi

if sudo systemctl is-active mvtt >/dev/null 2>&1; then
	echo "==> restarting mvtt"
	sudo systemctl restart mvtt
else
	echo "==> starting mvtt"
	sudo systemctl start mvtt
fi

echo
echo "==> done. tail logs with: journalctl -u mvtt -f"
