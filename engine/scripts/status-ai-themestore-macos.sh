#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

SHORT="false"
JSON="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --short) SHORT="true"; shift ;;
    --json|--deep) JSON="true"; shift ;;
    *) fail "Unknown status argument: $1" ;;
  esac
done

ensure_node_runtime
ensure_state_model
STATUS_JSON="$("$NODE" "$SCRIPT_DIR/runtime-health.mjs" --state-root "$STATE_ROOT")"

if [ "$SHORT" = "true" ]; then
  "$NODE" -e '
    const value = JSON.parse(process.argv[1]);
    const label = value.status === "healthy" ? "Skin ON"
      : value.status === "safe_mode" ? "Skin 安全模式"
      : value.reasonCode === "auto_restore_paused" ? "Skin 暂停"
      : value.status === "pending" ? "Skin 待恢复" : "Skin 异常";
    process.stdout.write(`${label}\n`);
  ' "$STATUS_JSON"
  exit 0
fi

if [ "$JSON" = "true" ]; then
  printf '%s\n' "$STATUS_JSON"
  exit 0
fi

"$NODE" -e '
  const value = JSON.parse(process.argv[1]);
  for (const key of ["status", "app", "profileId", "desiredThemeId", "hostVersion", "adapterId", "runtimeVerified", "action", "reasonCode", "evidenceAt"]) {
    process.stdout.write(`${key}=${value[key] ?? ""}\n`);
  }
' "$STATUS_JSON"
