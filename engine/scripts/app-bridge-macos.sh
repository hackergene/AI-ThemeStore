#!/bin/bash

# Narrow local bridge owned by the native menu bar App. No arbitrary command,
# path, URL, environment or executable payload is accepted.

set -euo pipefail

ACTION="${1:-status}"
THEME_ID="${2:-}"
APP_ID="${3:-codex}"
case "$APP_ID" in
  codex) ;;
  *) printf '{"status":"failed","reasonCode":"invalid_app"}\n' >&2; exit 64 ;;
esac
case "$ACTION" in
  status|observe|pause|resume|recover|restore-native|safe-mode|doctor) ;;
  apply)
    case "$THEME_ID" in
      ''|*[!A-Za-z0-9._-]*)
        printf '{"status":"failed","reasonCode":"invalid_bridge_request"}\n' >&2
        exit 64
        ;;
    esac
    [ "${#THEME_ID}" -le 80 ] || exit 64
    ;;
  *)
    printf '{"status":"failed","reasonCode":"invalid_bridge_request"}\n' >&2
    exit 64
    ;;
esac
[ "$#" -le 3 ] || { printf '{"status":"failed","reasonCode":"invalid_bridge_request"}\n' >&2; exit 64; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
. "$SCRIPT_DIR/common-macos.sh"

case "$ACTION" in
  status) ;;
  observe) exec "$SCRIPT_DIR/reconcile-codex-theme-macos.sh" ;;
  pause) "$SCRIPT_DIR/pause-ai-themestore-macos.sh" >/dev/null ;;
  resume)
    ensure_node_runtime
    ensure_state_model
    "$NODE" "$STATE_STORE" pause --state-root "$STATE_ROOT" --value false >/dev/null
    /bin/rm -f "$RUNTIME_STATE_PATH"
    ;;
  recover) "$SCRIPT_DIR/recover-after-codex-update-macos.sh" >/dev/null ;;
  restore-native) "$SCRIPT_DIR/restore-ai-themestore-macos.sh" --restart-codex >/dev/null ;;
  safe-mode) "$SCRIPT_DIR/restore-ai-themestore-macos.sh" --safe-mode >/dev/null ;;
  doctor) "$SCRIPT_DIR/doctor-macos.sh" >/dev/null ;;
  apply) "$SCRIPT_DIR/switch-theme-macos.sh" --id "$THEME_ID" >/dev/null ;;
esac

exec "$SCRIPT_DIR/status-ai-themestore-macos.sh" --json
