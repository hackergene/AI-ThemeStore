#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

REQUIRE_LIVE="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --require-live) REQUIRE_LIVE="true"; shift ;;
    *) fail "Unknown doctor argument: $1" ;;
  esac
done

discover_codex_app
require_macos_runtime
ensure_state_model
[ -f "$CONFIG_PATH" ] || fail "Codex config not found: $CONFIG_PATH"
for required in \
  "$PROJECT_ROOT/assets/ai-themestore.css" \
  "$PROJECT_ROOT/assets/renderer-inject.js" \
  "$PROJECT_ROOT/scripts/codex-shell-probe.mjs" \
  "$PROJECT_ROOT/scripts/injector.mjs"; do
  [ -s "$required" ] || fail "Required project file is missing or empty: $required"
done

if [ -f "$THEME_DIR/theme.json" ]; then
  PAYLOAD_JSON="$("$NODE" "$INJECTOR" --check-payload --theme-dir "$THEME_DIR")"
elif [ -f "$PROJECT_ROOT/assets/theme.json" ]; then
  PAYLOAD_JSON="$("$NODE" "$INJECTOR" --check-payload)"
else
  PAYLOAD_JSON='{"pass":true,"themeId":"native","themeName":"No downloaded theme","imageBytes":0,"payloadBytes":0}'
fi
PORT=9341
DESIRED_GENERATION="$(desired_field generation)"
HAS_RUNTIME_STATE="false"
if [ -f "$RUNTIME_STATE_PATH" ]; then
  PORT="$(runtime_field port)"
  HAS_RUNTIME_STATE="true"
elif [ -f "$STATE_PATH" ]; then
  PORT="$(state_field port)"
  HAS_RUNTIME_STATE="true"
fi
LIVE="false"
if [ "$HAS_RUNTIME_STATE" = "true" ] && [ -f "$THEME_DIR/theme.json" ] && verified_cdp_endpoint "$PORT"; then
  if "$NODE" "$INJECTOR" --verify --port "$PORT" --theme-dir "$THEME_DIR" \
    --desired-generation "$DESIRED_GENERATION" --timeout-ms 12000 >/dev/null 2>&1; then
    LIVE="true"
  fi
fi
[ "$REQUIRE_LIVE" = "false" ] || [ "$LIVE" = "true" ] || fail "No verified live AI ThemeStore session is active."

"$NODE" -e '
  const payload = JSON.parse(process.argv[1]);
  const result = {
    pass: true,
    product: "AI ThemeStore",
    version: process.argv[2],
    platform: `darwin-${process.argv[3]}`,
    codexVersion: process.argv[4],
    codexTeamId: process.argv[5],
    nodeVersion: process.argv[6],
    officialAppSignatureValid: true,
    modifiesAppAsar: false,
    live: process.argv[7] === "true",
    port: Number(process.argv[8]),
    theme: {
      id: payload.themeId,
      name: payload.themeName,
      imageBytes: payload.imageBytes,
      payloadBytes: payload.payloadBytes,
    },
  };
  console.log(JSON.stringify(result, null, 2));
' "$PAYLOAD_JSON" "$SKIN_VERSION" "$(/usr/bin/uname -m)" "$CODEX_VERSION" "$CODEX_TEAM_ID" "$NODE_VERSION" "$LIVE" "$PORT"
