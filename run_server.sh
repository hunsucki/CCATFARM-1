#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8001}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
RPI_IP="${RPI_IP:-192.168.0.4}"

BACKEND_PID=""
FRONTEND_PID=""

log() {
  printf '[ccatfarm] %s\n' "$*"
}

stop_servers() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi

  [[ -z "$FRONTEND_PID" ]] || wait "$FRONTEND_PID" 2>/dev/null || true
  [[ -z "$BACKEND_PID" ]] || wait "$BACKEND_PID" 2>/dev/null || true
  log "서버를 종료했습니다."
  exit "$exit_code"
}

trap stop_servers EXIT
trap 'exit 130' INT TERM

if systemctl --user is-active --quiet ccatfarm-backend.service 2>/dev/null \
  || systemctl --user is-active --quiet ccatfarm-frontend.service 2>/dev/null; then
  log "기존 ccatfarm systemd 서비스가 실행 중입니다."
  log "먼저 다음 명령으로 중지하세요:"
  log "systemctl --user disable --now ccatfarm-frontend.service ccatfarm-backend.service"
  exit 1
fi

if [[ ! -x "$BACKEND_DIR/.venv/bin/python" ]]; then
  log "backend/.venv를 찾을 수 없습니다. Python 가상환경과 의존성을 먼저 준비하세요."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.nvm/nvm.sh"
    nvm use 20.20.2 --silent >/dev/null 2>&1 || nvm use --lts --silent >/dev/null
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  log "npm을 찾을 수 없습니다. Node.js 20과 npm을 설치하세요."
  exit 1
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  log "프런트엔드 의존성을 설치합니다."
  (cd "$FRONTEND_DIR" && npm ci)
fi

log "최신 프런트엔드 프로덕션 빌드를 생성합니다."
(cd "$FRONTEND_DIR" && npm run build)

log "백엔드 시작: http://$BACKEND_HOST:$BACKEND_PORT"
(
  cd "$BACKEND_DIR"
  export PYTHONUNBUFFERED=1 RPI_IP
  exec .venv/bin/python -m uvicorn main:app \
    --host "$BACKEND_HOST" \
    --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

log "프런트엔드 시작: http://$FRONTEND_HOST:$FRONTEND_PORT"
(
  cd "$FRONTEND_DIR"
  exec ./node_modules/.bin/vite preview \
    --host "$FRONTEND_HOST" \
    --port "$FRONTEND_PORT" \
    --strictPort
) &
FRONTEND_PID=$!

sleep 1
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  log "백엔드 시작에 실패했습니다. 위 로그를 확인하세요."
  exit 1
fi
if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  log "프런트엔드 시작에 실패했습니다. 위 로그를 확인하세요."
  exit 1
fi

log "서버가 실행 중입니다. 종료하려면 Ctrl+C를 누르세요."

set +e
wait -n "$BACKEND_PID" "$FRONTEND_PID"
SERVER_EXIT_CODE=$?
set -e

log "서버 프로세스 하나가 종료되었습니다. 나머지 서버도 정리합니다."
exit "$SERVER_EXIT_CODE"
