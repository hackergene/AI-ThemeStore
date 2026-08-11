#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

MANUAL="false"
FRESH_WINDOW=12
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manual) MANUAL="true"; shift ;;
    --fresh-window) FRESH_WINDOW="${2:-}"; shift 2 ;;
    *) fail "Unknown reconcile argument: $1" ;;
  esac
done
case "$FRESH_WINDOW" in ''|*[!0-9]*) fail "Invalid fresh-launch window." ;; esac

discover_codex_app
require_macos_runtime
ensure_state_model

DESIRED_INFO="$("$NODE" -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write([value.desiredTheme?.id || "native", value.restorePolicy, value.paused, value.safeMode, value.generation].join("\n"));
' "$DESIRED_STATE_PATH")"
DESIRED_THEME_ID="$(printf '%s\n' "$DESIRED_INFO" | /usr/bin/sed -n '1p')"
RESTORE_POLICY="$(printf '%s\n' "$DESIRED_INFO" | /usr/bin/sed -n '2p')"
PAUSED="$(printf '%s\n' "$DESIRED_INFO" | /usr/bin/sed -n '3p')"
SAFE_MODE="$(printf '%s\n' "$DESIRED_INFO" | /usr/bin/sed -n '4p')"
GENERATION="$(printf '%s\n' "$DESIRED_INFO" | /usr/bin/sed -n '5p')"

if [ "$DESIRED_THEME_ID" = "native" ] || [ "$PAUSED" = "true" ] || [ "$SAFE_MODE" = "true" ] || [ "$RESTORE_POLICY" != "always" ]; then
  exec "$SCRIPT_DIR/status-ai-themestore-macos.sh" --json
fi

CURRENT_STATUS="$("$NODE" "$SCRIPT_DIR/runtime-health.mjs" --state-root "$STATE_ROOT")"
# Preserve verified evidence for the route the user can currently see. The
# second route remains a release gate, but must not downgrade a visibly themed
# renderer to "not applied" during routine observation.
if "$NODE" -e 'const s=JSON.parse(process.argv[1]);process.exit(s.status === "healthy" || s.runtimeVerified === true ? 0 : 1)' "$CURRENT_STATUS"; then
  printf '%s\n' "$CURRENT_STATUS"
  exit 0
fi

CODEX_PID="$(codex_main_pids | /usr/bin/head -n 1)"
if [ -z "$CODEX_PID" ]; then
  "$NODE" -e '
    const s=JSON.parse(process.argv[1]);
    process.stdout.write(`${JSON.stringify({...s,status:"pending",runtimeVerified:false,action:"none",reasonCode:"codex_not_running"},null,2)}\n`);
  ' "$CURRENT_STATUS"
  exit 0
fi

STARTED_AT="$(process_started_at "$CODEX_PID")"
AGE_SECONDS="$("$NODE" -e 'const age=Math.floor((Date.now()-Date.parse(process.argv[1]))/1000);process.stdout.write(String(Number.isFinite(age)?Math.max(0,age):999999))' "$STARTED_AT")"
if [ "$MANUAL" != "true" ] && [ "$AGE_SECONDS" -gt "$FRESH_WINDOW" ]; then
  CURRENT_PORT=9341
  if [ -f "$RUNTIME_STATE_PATH" ]; then
    SAVED_PORT="$(runtime_field port 2>/dev/null || true)"
    [ -n "$SAVED_PORT" ] && CURRENT_PORT="$SAVED_PORT"
  fi
  # A watcher without its verified CDP endpoint cannot affect the current
  # established session and is safe to stop after full recorded identity match.
  if ! verified_cdp_endpoint "$CURRENT_PORT"; then
    stop_recorded_injector || true
  fi
  "$NODE" -e '
    const s=JSON.parse(process.argv[1]);
    process.stdout.write(`${JSON.stringify({...s,status:"pending",runtimeVerified:false,action:"none",reasonCode:"established_session_pending"},null,2)}\n`);
  ' "$CURRENT_STATUS"
  exit 0
fi

ATTEMPT_KEY="${CODEX_VERSION}|${CODEX_PID}|${STARTED_AT}|${GENERATION}"
CLAIM="$("$NODE" "$SCRIPT_DIR/recovery-attempts.mjs" claim --state-root "$STATE_ROOT" --key "$ATTEMPT_KEY")"
if ! "$NODE" -e 'process.exit(JSON.parse(process.argv[1]).claimed ? 0 : 1)' "$CLAIM"; then
  "$NODE" -e '
    const s=JSON.parse(process.argv[1]);
    process.stdout.write(`${JSON.stringify({...s,status:"pending",runtimeVerified:false,action:"none",reasonCode:"recovery_attempt_already_used"},null,2)}\n`);
  ' "$CURRENT_STATUS"
  exit 0
fi

PORT=9341
if [ -f "$RUNTIME_STATE_PATH" ]; then
  SAVED_PORT="$(runtime_field port 2>/dev/null || true)"
  [ -n "$SAVED_PORT" ] && PORT="$SAVED_PORT"
fi

if "$SCRIPT_DIR/start-ai-themestore-macos.sh" --port "$PORT" --restart-existing >/dev/null; then
  "$NODE" "$SCRIPT_DIR/recovery-attempts.mjs" finish --state-root "$STATE_ROOT" --key "$ATTEMPT_KEY" --outcome success >/dev/null
  exec "$SCRIPT_DIR/status-ai-themestore-macos.sh" --json
fi

FINISH="$("$NODE" "$SCRIPT_DIR/recovery-attempts.mjs" finish --state-root "$STATE_ROOT" --key "$ATTEMPT_KEY" --outcome failure)"
if "$NODE" -e 'process.exit(JSON.parse(process.argv[1]).safeMode ? 0 : 1)' "$FINISH"; then
  stop_recorded_injector || true
  if verified_cdp_endpoint "$PORT"; then
    "$NODE" "$INJECTOR" --remove --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 8000 >/dev/null 2>&1 || true
  fi
fi
exec "$SCRIPT_DIR/status-ai-themestore-macos.sh" --json
