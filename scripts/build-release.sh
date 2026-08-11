#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
VERSION="$(/usr/bin/tr -d '[:space:]' < "$ROOT/VERSION")"
APP="$ROOT/dist/AI ThemeStore.app"
ZIP="$ROOT/dist/AI-ThemeStore-$VERSION-macos.zip"

"$SCRIPT_DIR/build-app.sh" "$APP"
/bin/rm -f "$ZIP" "$ZIP.sha256"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
(
  cd "$ROOT/dist"
  /usr/bin/shasum -a 256 "$(basename "$ZIP")" > "$(basename "$ZIP").sha256"
)
printf 'Built release: %s\n' "$ZIP"
