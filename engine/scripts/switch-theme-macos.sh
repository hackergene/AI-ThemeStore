#!/bin/bash

# Transactional theme switch: stage -> apply -> live verify -> commit -> rollback.

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

THEME_ID=""
APPLY_NOW="true"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --id) THEME_ID="${2:-}"; shift 2 ;;
    --no-apply) APPLY_NOW="false"; shift ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[ -n "$THEME_ID" ] || fail "Usage: switch-theme-macos.sh --id <theme-id>"

ensure_state_root
discover_codex_app
require_macos_runtime
ensure_state_model
THEMES_ROOT="$STATE_ROOT/themes"
SRC="$THEMES_ROOT/$THEME_ID"
[ -d "$SRC" ] || fail "Theme not found: $THEME_ID"

progress() {
  printf '%s\n' "$*" >&2
  if [ "${THEMESTORE_NOTIFICATION_OWNER:-}" != "native-app" ]; then
    /usr/bin/osascript -e "display notification \"$*\" with title \"AI ThemeStore\"" >/dev/null 2>&1 || true
  fi
}

json_field_from_file() {
  json_file_field "$1" "$2"
}

TRANSACTION_JSON="$(/usr/bin/mktemp "$STATE_ROOT/transaction-result.XXXXXX")"
VERIFY_JSON="$(/usr/bin/mktemp "$STATE_ROOT/transaction-verify.XXXXXX")"
cleanup() {
  /bin/rm -f "$TRANSACTION_JSON" "$VERIFY_JSON"
}
trap cleanup EXIT

progress "Staging theme..."
"$NODE" "$THEME_TRANSACTION" prepare --state-root "$STATE_ROOT" --source "$SRC" > "$TRANSACTION_JSON"
TRANSACTION_ID="$(json_field_from_file "$TRANSACTION_JSON" id)"
STAGED_DIR="$(json_field_from_file "$TRANSACTION_JSON" stagedPath)"
[ -n "$TRANSACTION_ID" ] && [ -d "$STAGED_DIR" ] || fail "Theme staging did not produce a valid transaction."

THEME_NAME="$("$NODE" -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(t.name||t.id||"")' "$STAGED_DIR/theme.json")"
[ -n "$THEME_NAME" ] || THEME_NAME="$THEME_ID"

if [ "$APPLY_NOW" != "true" ]; then
  "$NODE" "$THEME_TRANSACTION" abort --state-root "$STATE_ROOT" --id "$TRANSACTION_ID" >/dev/null
  progress "Validated: ${THEME_NAME} (not applied)"
  exit 0
fi

DESIRED_GENERATION="$(desired_field generation)"
PORT=9341
PROVISIONAL_INJECTOR_PID=""
if [ -f "$RUNTIME_STATE_PATH" ]; then
  saved="$(runtime_field port 2>/dev/null || true)"
  [ -n "${saved:-}" ] && PORT="$saved"
elif [ -f "$STATE_PATH" ]; then
  saved="$(state_field port 2>/dev/null || true)"
  [ -n "${saved:-}" ] && PORT="$saved"
fi

apply_and_verify_staged() {
  if verified_cdp_endpoint "$PORT"; then
    # Stop the committed watcher before staging; otherwise a route refresh can
    # re-apply the previous theme while this transaction is being verified.
    stop_recorded_injector
    PROVISIONAL_INJECTOR_PID="$(launch_injector_daemon "$PORT" "$STAGED_DIR" "$DESIRED_GENERATION")"
    /bin/sleep 0.25
    /bin/kill -0 "$PROVISIONAL_INJECTOR_PID" 2>/dev/null || return 1
    if ! "$NODE" "$INJECTOR" --once --port "$PORT" --theme-dir "$STAGED_DIR" \
      --desired-generation "$DESIRED_GENERATION" --timeout-ms 15000 >/dev/null; then
      # A renderer can briefly expose its app:// target before the Codex shell
      # markers settle after the local confirmation steals focus. Retry exactly
      # once with the same staged payload and generation; never widen the target.
      /bin/sleep 0.75
      "$NODE" "$INJECTOR" --once --port "$PORT" --theme-dir "$STAGED_DIR" \
        --desired-generation "$DESIRED_GENERATION" --timeout-ms 15000 >/dev/null || return 1
    fi
  else
    if ! AI_THEMESTORE_THEME_DIR="$STAGED_DIR" \
      AI_THEMESTORE_DESIRED_GENERATION="$DESIRED_GENERATION" \
      "$SCRIPT_DIR/start-ai-themestore-macos.sh" --port "$PORT" --restart-existing >/dev/null; then
      return 1
    fi
  fi
  if ! "$NODE" "$INJECTOR" --verify --port "$PORT" --theme-dir "$STAGED_DIR" \
    --desired-generation "$DESIRED_GENERATION" --timeout-ms 30000 > "$VERIFY_JSON"; then
    "$NODE" "$INJECTOR" --once --port "$PORT" --theme-dir "$STAGED_DIR" \
      --desired-generation "$DESIRED_GENERATION" --timeout-ms 15000 >/dev/null || return 1
    "$NODE" "$INJECTOR" --verify --port "$PORT" --theme-dir "$STAGED_DIR" \
      --desired-generation "$DESIRED_GENERATION" --timeout-ms 20000 > "$VERIFY_JSON" || return 1
  fi
}

rollback_live_theme() {
  [ -f "$STATE_ROOT/theme/theme.json" ] || return 1
  verified_cdp_endpoint "$PORT" || return 1
  if [ -n "$PROVISIONAL_INJECTOR_PID" ]; then
    /bin/kill -TERM "$PROVISIONAL_INJECTOR_PID" 2>/dev/null || true
    PROVISIONAL_INJECTOR_PID=""
  fi
  AI_THEMESTORE_DESIRED_GENERATION="$DESIRED_GENERATION" \
    hot_reapply_theme "$PORT" 15000 || return 1
  "$NODE" "$INJECTOR" --verify --port "$PORT" --theme-dir "$STATE_ROOT/theme" \
    --desired-generation "$DESIRED_GENERATION" --timeout-ms 20000 >/dev/null || return 1
}

progress "Applying staged theme..."
if ! apply_and_verify_staged; then
  progress "Verification failed; restoring previous theme..."
  if rollback_live_theme; then
    "$NODE" "$THEME_TRANSACTION" abort --state-root "$STATE_ROOT" --id "$TRANSACTION_ID" >/dev/null
    fail "Theme verification failed; the previous verified theme was restored."
  fi
  "$NODE" "$INJECTOR" --remove --port "$PORT" --theme-dir "$STATE_ROOT/theme" --timeout-ms 8000 >/dev/null 2>&1 || true
  "$NODE" "$THEME_TRANSACTION" abort --state-root "$STATE_ROOT" --id "$TRANSACTION_ID" --rollback-failed >/dev/null
  fail "Theme and rollback verification failed; native safe mode is enabled."
fi

progress "Committing verified theme..."
"$NODE" "$THEME_TRANSACTION" commit --state-root "$STATE_ROOT" --id "$TRANSACTION_ID" > "$TRANSACTION_JSON"
NEW_GENERATION="$(json_field_from_file "$TRANSACTION_JSON" desiredGeneration)"

# The provisional watcher points at staging. Rebind it to the committed directory.
if ! AI_THEMESTORE_DESIRED_GENERATION="$NEW_GENERATION" hot_reapply_theme "$PORT" 12000; then
  fail "Theme was verified and committed, but the committed watcher could not be rebound. Recovery is pending."
fi
"$NODE" "$INJECTOR" --verify --port "$PORT" --theme-dir "$STATE_ROOT/theme" \
  --desired-generation "$NEW_GENERATION" --timeout-ms 20000 > "$VERIFY_JSON"
FINAL_INJECTOR_PID="$(runtime_field injectorPid)"
FINAL_INJECTOR_STARTED_AT="$(runtime_field injectorStartedAt)"
FINAL_CODEX_PID="$(codex_main_pids | /usr/bin/head -n 1)"
write_verified_runtime "$VERIFY_JSON" "$PORT" "$FINAL_INJECTOR_PID" "$FINAL_INJECTOR_STARTED_AT" "${FINAL_CODEX_PID:-0}" applied

progress "Done: ${THEME_NAME}"
