#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
NODE="${NODE:-$(command -v node || true)}"
[ -n "$NODE" ] || { printf 'Node.js 20 or newer is required for tests.\n' >&2; exit 69; }

for script in "$ROOT"/engine/scripts/*.sh "$ROOT"/scripts/*.sh; do
  /bin/bash -n "$script"
done

for script in "$ROOT"/engine/scripts/*.mjs "$ROOT"/engine/assets/*.js; do
  "$NODE" --check "$script" >/dev/null
done

"$NODE" -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const root = process.argv[1];
  for (const id of fs.readdirSync(root)) {
    const directory = path.join(root, id);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, "theme.json"), "utf8"));
    if (metadata.id !== id) throw new Error(`Theme id mismatch: ${id}`);
    for (const key of ["hero", "taskBackground"]) {
      const file = metadata.assets?.[key];
      if (!file || path.basename(file) !== file || !fs.existsSync(path.join(directory, file))) {
        throw new Error(`Invalid ${key} for ${id}`);
      }
    }
  }
' "$ROOT/themes"

for test_file in \
  codex-shell-probe.test.mjs \
  recovery-attempts.test.mjs \
  state-store.test.mjs \
  theme-transaction.test.mjs \
  theme-route-gate.test.mjs \
  home-layout-matrix-gate.test.mjs \
  runtime-health.test.mjs; do
  "$NODE" "$SCRIPT_DIR/$test_file"
done

if /usr/bin/grep -R -E -n \
  '(Firebase|GoogleService-Info|fast-ai|/home/hackergene|/api/device/|device-identity-v1|production\.env|staging\.env)' \
  "$ROOT/Sources" "$ROOT/engine" "$ROOT/scripts" "$ROOT/themes"; then
  printf 'Production-only marker found in Community source.\n' >&2
  exit 1
fi

"$ROOT/scripts/build-app.sh"
/usr/bin/codesign --verify --deep --strict "$ROOT/dist/AI ThemeStore Community.app"
printf 'AI ThemeStore Community tests passed.\n'
