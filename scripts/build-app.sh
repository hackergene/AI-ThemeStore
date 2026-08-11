#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
OUTPUT="${1:-$ROOT/dist/AI ThemeStore.app}"

case "$OUTPUT" in
  *.app) ;;
  *) printf 'Output must end in .app: %s\n' "$OUTPUT" >&2; exit 64 ;;
esac

VERSION="$(/usr/bin/tr -d '[:space:]' < "$ROOT/VERSION")"
case "$VERSION" in
  ''|*[!0-9.]*) printf 'VERSION must contain only digits and periods.\n' >&2; exit 65 ;;
esac

/usr/bin/swift build --package-path "$ROOT" --configuration release
BIN_DIR="$(/usr/bin/swift build --package-path "$ROOT" --configuration release --show-bin-path)"
TEMP="$(/usr/bin/mktemp -d /tmp/ai-themestore.XXXXXX)"
trap '/bin/rm -rf "$TEMP"' EXIT

APP="$TEMP/AI ThemeStore.app"
/bin/mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
/bin/cp "$ROOT/Resources/Info.plist" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $(/bin/date -u +%Y%m%d%H%M%S)" "$APP/Contents/Info.plist"
/bin/cp "$BIN_DIR/ai-themestore" "$APP/Contents/MacOS/ai-themestore"
/bin/cp "$ROOT/Resources/Brand/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
/bin/cp "$ROOT/Resources/Brand/AppIcon.png" "$APP/Contents/Resources/AppIcon.png"
/usr/bin/ditto "$ROOT/engine" "$APP/Contents/Resources/engine"
/usr/bin/ditto "$ROOT/themes" "$APP/Contents/Resources/themes"
/bin/cp "$ROOT/VERSION" "$APP/Contents/Resources/engine/VERSION"
/bin/chmod 755 "$APP/Contents/MacOS/ai-themestore" "$APP/Contents/Resources/engine/scripts/"*.sh
/usr/bin/codesign --force --deep --options runtime --sign - "$APP"
/usr/bin/codesign --verify --deep --strict "$APP"

/bin/mkdir -p "$(dirname "$OUTPUT")"
if [ -e "$OUTPUT" ]; then
  case "$OUTPUT" in
    "$ROOT"/dist/*.app) /bin/rm -rf "$OUTPUT" ;;
    *) printf 'Refusing to replace App outside the project dist directory: %s\n' "$OUTPUT" >&2; exit 66 ;;
  esac
fi
/usr/bin/ditto "$APP" "$OUTPUT"
printf 'Built AI ThemeStore %s: %s\n' "$VERSION" "$OUTPUT"
