#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

PORT=9341
PORT_EXPLICIT="false"
RESTORE_BASE_THEME="false"
RESTART_CODEX="false"
UNINSTALL="false"
SAFE_MODE="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; PORT_EXPLICIT="true"; shift 2 ;;
    --restore-base-theme) RESTORE_BASE_THEME="true"; shift ;;
    --restart-codex) RESTART_CODEX="true"; shift ;;
    --uninstall) UNINSTALL="true"; shift ;;
    --safe-mode) SAFE_MODE="true"; shift ;;
    *) fail "Unknown restore argument: $1" ;;
  esac
done

discover_codex_app
require_macos_runtime
ensure_state_root
ensure_state_model

# Desired state changes first so a crash cannot re-enable injection on restart.
if [ "$SAFE_MODE" = "true" ]; then
  "$NODE" "$STATE_STORE" native --state-root "$STATE_ROOT" --safe-mode >/dev/null
else
  "$NODE" "$STATE_STORE" native --state-root "$STATE_ROOT" >/dev/null
fi

if [ "$PORT_EXPLICIT" = "false" ] && [ -f "$RUNTIME_STATE_PATH" ]; then
  PORT="$(runtime_field port)" || fail "Could not read the saved CDP port; desired native state was preserved."
elif [ "$PORT_EXPLICIT" = "false" ] && [ -f "$STATE_PATH" ]; then
  PORT="$(state_field port)" || fail "Could not read the saved CDP port; state was preserved."
fi

if [ -f "$RUNTIME_STATE_PATH" ] || [ -f "$STATE_PATH" ]; then
  stop_recorded_injector
fi
# Always remove the themed Codex launchd babysitter so quitting Codex stays quit.
release_codex_launchd_job || true
CODEX_RUNNING="false"
codex_is_running && CODEX_RUNNING="true"
DEBUG_READY="false"
verified_cdp_endpoint "$PORT" && DEBUG_READY="true"

if [ "$DEBUG_READY" = "true" ]; then
  "$NODE" "$INJECTOR" --remove --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 8000 >/dev/null \
    || fail "The live skin could not be removed and verified; restore stopped safely."
elif [ "$CODEX_RUNNING" = "true" ] && [ "$RESTART_CODEX" = "false" ]; then
  fail "Codex is still running but its saved CDP endpoint cannot be verified. Pass --restart-codex for a full restore."
fi

if [ "$RESTORE_BASE_THEME" = "true" ]; then
  "$NODE" "$SCRIPT_DIR/theme-config.mjs" restore "$CONFIG_PATH" "$THEME_BACKUP_PATH"
fi

if [ "$RESTART_CODEX" = "true" ]; then
  [ "$CODEX_RUNNING" = "true" ] && stop_codex true
  launch_codex_normally
fi

/bin/rm -f "$RUNTIME_STATE_PATH"
if [ "$UNINSTALL" = "true" ]; then
  /bin/rm -f "$HOME/Desktop/AI ThemeStore.command"
  /bin/rm -f "$HOME/Desktop/AI ThemeStore - Customize.command"
  /bin/rm -f "$HOME/Desktop/AI ThemeStore - Verify.command"
  /bin/rm -f "$HOME/Desktop/AI ThemeStore - Restore.command"
fi

if [ "$SAFE_MODE" = "true" ]; then
  printf 'AI ThemeStore entered native safe mode successfully.\n'
else
  printf 'AI ThemeStore was restored to native appearance successfully.\n'
fi
