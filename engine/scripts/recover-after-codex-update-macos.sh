#!/bin/bash

# Explicit local recovery entry. The menu bar App confirms the restart before
# invoking this script; lifecycle automation uses reconciler policy directly.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
. "$SCRIPT_DIR/common-macos.sh"

ensure_node_runtime
ensure_state_model
"$NODE" "$STATE_STORE" recover --state-root "$STATE_ROOT" >/dev/null
/bin/rm -f "$RUNTIME_STATE_PATH"
exec "$SCRIPT_DIR/reconcile-codex-theme-macos.sh" --manual
