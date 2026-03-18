#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOST="${OPENCLAW_VPS_HOST:-142.171.114.18}"
SSH_USER="${OPENCLAW_VPS_USER:-root}"
SSH_PORT="${OPENCLAW_VPS_SSH_PORT:-8090}"
IDENTITY_FILE="${OPENCLAW_VPS_IDENTITY_FILE:-}"
CONTROL_PATH="${TMPDIR:-/tmp}/openclaw-ingest-ssh-${SSH_USER}-${HOST//[^A-Za-z0-9]/_}-${SSH_PORT}"

LOCAL_SERVER_TS="${OPENCLAW_INGEST_LOCAL_SERVER_TS:-/Users/yangshangqing/Downloads/server.ts}"
APP_USER="${OPENCLAW_INGEST_APP_USER:-openclaw-ingest}"
APP_DIR="${OPENCLAW_INGEST_APP_DIR:-/opt/openclaw-ingest}"
DATA_DIR="${OPENCLAW_INGEST_DATA_DIR:-/var/lib/openclaw-ingest}"
INGEST_PORT="${OPENCLAW_INGEST_PORT:-9701}"
OPEN_FIREWALL="${OPENCLAW_INGEST_OPEN_FIREWALL:-0}"
MIN_NODE_MAJOR="${OPENCLAW_INGEST_MIN_NODE_MAJOR:-22}"

REMOTE_SERVICE_PATH="/etc/systemd/system/openclaw-ingest.service"
REMOTE_NAME="${SSH_USER}@${HOST}"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") <command> [options]

Commands:
  login         Open an SSH shell on the VPS.
  deploy        Upload server.ts, create/update systemd service, and restart it.
  status        Show systemd status for openclaw-ingest.
  logs          Tail service logs.
  health        Run the public /v1/health check from your local machine.
  verify        Run local health + sample ingest checks against the public endpoint.
  service-file  Print the generated systemd unit.

Options:
  --host <ip-or-domain>        VPS host. Default: ${HOST}
  --user <ssh-user>            SSH user. Default: ${SSH_USER}
  --ssh-port <port>            SSH port. Default: ${SSH_PORT}
  --identity <path>            SSH private key path.
  --server-ts <path>           Local path to server.ts. Default: ${LOCAL_SERVER_TS}
  --ingest-port <port>         Public ingest port. Default: ${INGEST_PORT}
  --open-firewall              Run 'sudo ufw allow <port>/tcp' during deploy.

Environment variable equivalents:
  OPENCLAW_VPS_HOST
  OPENCLAW_VPS_USER
  OPENCLAW_VPS_SSH_PORT
  OPENCLAW_VPS_IDENTITY_FILE
  OPENCLAW_INGEST_LOCAL_SERVER_TS
  OPENCLAW_INGEST_PORT
  OPENCLAW_INGEST_OPEN_FIREWALL

Examples:
  $(basename "$0") login --user root --identity ~/.ssh/my_vps_key
  $(basename "$0") deploy --user root --identity ~/.ssh/my_vps_key --ingest-port 18234 --open-firewall
  $(basename "$0") verify --ingest-port 18234
EOF
}

ssh_args() {
  local args=(
    -p "$SSH_PORT"
    -o StrictHostKeyChecking=accept-new
    -o ControlMaster=auto
    -o ControlPersist=10m
    -o ControlPath="$CONTROL_PATH"
  )
  if [[ -n "$IDENTITY_FILE" ]]; then
    args+=(-i "$IDENTITY_FILE")
  fi
  printf "%s\n" "${args[@]}"
}

close_control_master() {
  local args=()
  while IFS= read -r line; do
    args+=("$line")
  done < <(ssh_args)

  ssh "${args[@]}" -O exit "$REMOTE_NAME" >/dev/null 2>&1 || true
}

ssh_run() {
  local args=()
  while IFS= read -r line; do
    args+=("$line")
  done < <(ssh_args)
  ssh "${args[@]}" "$REMOTE_NAME" "$@"
}

scp_run() {
  local args=()
  while IFS= read -r line; do
    args+=("$line")
  done < <(ssh_args)
  scp "${args[@]}" "$@"
}

require_local_file() {
  local target="$1"
  if [[ ! -f "$target" ]]; then
    echo "Missing local file: $target" >&2
    exit 1
  fi
}

require_local_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required local command: $name" >&2
    exit 1
  fi
}

render_service_file() {
  cat <<EOF
[Unit]
Description=OpenClaw Public Ingest
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=INGEST_PORT=${INGEST_PORT}
Environment=INGEST_DATA_DIR=${DATA_DIR}
ExecStart=/usr/bin/env node ${APP_DIR}/server.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
}

remote_node_major() {
  ssh_run "node -p \"Number(process.versions.node.split('.')[0])\" 2>/dev/null || echo 0"
}

ensure_remote_node() {
  local major
  major="$(remote_node_major | tr -d '\r' | tail -n 1)"
  if [[ "$major" =~ ^[0-9]+$ ]] && (( major >= MIN_NODE_MAJOR )); then
    return
  fi

  cat >&2 <<EOF
Remote node version is too old (detected major=${major:-unknown}; require >= ${MIN_NODE_MAJOR}).

Please install Node 22+ on the server first, then rerun deploy.
Suggested commands from your developer:

  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
  sudo apt-get install -y nodejs

After that, rerun:

  $0 deploy --host ${HOST} --user ${SSH_USER} --ingest-port ${INGEST_PORT}
EOF
  exit 1
}

deploy() {
  require_local_command ssh
  require_local_command scp
  require_local_command curl
  require_local_file "$LOCAL_SERVER_TS"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  local local_service="$tmp_dir/openclaw-ingest.service"
  render_service_file > "$local_service"

  ensure_remote_node

  echo "Uploading files to ${REMOTE_NAME}..."
  scp_run "$LOCAL_SERVER_TS" "${REMOTE_NAME}:/tmp/openclaw-ingest-server.ts"
  scp_run "$local_service" "${REMOTE_NAME}:/tmp/openclaw-ingest.service"

  echo "Provisioning service on remote host..."
  ssh_run "
    set -euo pipefail
    if ! id -u '${APP_USER}' >/dev/null 2>&1; then
      sudo useradd --system --shell /usr/sbin/nologin --home-dir '${APP_DIR}' '${APP_USER}'
    fi
    sudo mkdir -p '${APP_DIR}' '${DATA_DIR}'
    sudo install -o '${APP_USER}' -g '${APP_USER}' -m 0644 /tmp/openclaw-ingest-server.ts '${APP_DIR}/server.ts'
    sudo install -o root -g root -m 0644 /tmp/openclaw-ingest.service '${REMOTE_SERVICE_PATH}'
    sudo chown -R '${APP_USER}:${APP_USER}' '${APP_DIR}' '${DATA_DIR}'
    sudo systemctl daemon-reload
    sudo systemctl enable openclaw-ingest
    sudo systemctl restart openclaw-ingest
    rm -f /tmp/openclaw-ingest-server.ts /tmp/openclaw-ingest.service
  "

  if [[ "$OPEN_FIREWALL" == "1" ]]; then
    echo "Opening firewall port ${INGEST_PORT}/tcp..."
    ssh_run "sudo ufw allow ${INGEST_PORT}/tcp comment 'openclaw-ingest' || true"
  fi

  echo
  echo "Deploy finished. Next checks:"
  echo "  $0 status --host ${HOST} --user ${SSH_USER} --ingest-port ${INGEST_PORT}"
  echo "  $0 health --host ${HOST} --ingest-port ${INGEST_PORT}"

  close_control_master
}

login() {
  local args=()
  while IFS= read -r line; do
    args+=("$line")
  done < <(ssh_args)
  exec ssh "${args[@]}" "$REMOTE_NAME"
}

status() {
  ssh_run "sudo systemctl status openclaw-ingest --no-pager"
}

logs() {
  ssh_run "sudo journalctl -u openclaw-ingest -f"
}

health() {
  require_local_command curl
  curl --fail --silent --show-error "http://${HOST}:${INGEST_PORT}/v1/health"
  echo
}

verify() {
  require_local_command curl

  echo "--- health ---"
  health

  echo "--- sample ingest ---"
  curl --fail --silent --show-error -X POST "http://${HOST}:${INGEST_PORT}/v1/ingest" \
    -H "Content-Type: application/json" \
    -H "X-Schema-Version: 1.0.0" \
    -H "X-Node-Fingerprint: anon_test1234567890abcdef" \
    -d '{
      "batch_id": "batch_test_001",
      "submitted_at": "2026-03-17T20:00:00Z",
      "facts": [
        {
          "public_fact_id": "pfact_test001",
          "schema_version": "1.0.0",
          "node_fingerprint": "anon_test1234567890abcdef",
          "subject_type": "skill",
          "subject_ref": "web-research",
          "subject_version": "0.2.0",
          "scenario_signature": "product_research.ai_game",
          "scenario_tags": ["research", "product"],
          "metric_name": "closure_rate",
          "metric_value": 0.75,
          "sample_size": 12,
          "confidence": 0.82,
          "context": {
            "avg_run_count_per_session": 3.2,
            "co_skills": ["summarizer"]
          },
          "computed_at": "2026-03-17T19:55:00Z",
          "submitted_at": "2026-03-17T20:00:00Z"
        }
      ]
    }'
  echo
}

COMMAND="${1:-}"
if [[ -z "$COMMAND" ]]; then
  usage
  exit 1
fi
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="$2"
      REMOTE_NAME="${SSH_USER}@${HOST}"
      CONTROL_PATH="${TMPDIR:-/tmp}/openclaw-ingest-ssh-${SSH_USER}-${HOST//[^A-Za-z0-9]/_}-${SSH_PORT}"
      shift 2
      ;;
    --user)
      SSH_USER="$2"
      REMOTE_NAME="${SSH_USER}@${HOST}"
      CONTROL_PATH="${TMPDIR:-/tmp}/openclaw-ingest-ssh-${SSH_USER}-${HOST//[^A-Za-z0-9]/_}-${SSH_PORT}"
      shift 2
      ;;
    --ssh-port)
      SSH_PORT="$2"
      CONTROL_PATH="${TMPDIR:-/tmp}/openclaw-ingest-ssh-${SSH_USER}-${HOST//[^A-Za-z0-9]/_}-${SSH_PORT}"
      shift 2
      ;;
    --identity)
      IDENTITY_FILE="$2"
      shift 2
      ;;
    --server-ts)
      LOCAL_SERVER_TS="$2"
      shift 2
      ;;
    --ingest-port)
      INGEST_PORT="$2"
      shift 2
      ;;
    --open-firewall)
      OPEN_FIREWALL="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

REMOTE_NAME="${SSH_USER}@${HOST}"

case "$COMMAND" in
  login)
    login
    ;;
  deploy)
    deploy
    ;;
  status)
    status
    ;;
  logs)
    logs
    ;;
  health)
    health
    ;;
  verify)
    verify
    ;;
  service-file)
    render_service_file
    ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    usage
    exit 1
    ;;
esac
