#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="FlavorPress"
BUILD_DIR="$SCRIPT_DIR/build"
APP_BUNDLE="$BUILD_DIR/${APP_NAME}.app"

if [[ ! -d "$APP_BUNDLE" ]]; then
    echo "ERROR: $APP_BUNDLE not found. Run macos/build.sh first."
    exit 1
fi

VERSION="${1:-$(node -p "require('$PROJECT_DIR/package.json').version")}"
DMG_PATH="$BUILD_DIR/${APP_NAME}-v${VERSION}-arm64.dmg"
STAGING="$BUILD_DIR/dmg-staging"

rm -rf "$STAGING" "$DMG_PATH"
mkdir -p "$STAGING"
cp -R "$APP_BUNDLE" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

echo "Creating DMG..."
hdiutil create \
    -volname "$APP_NAME" \
    -srcfolder "$STAGING" \
    -ov \
    -format UDZO \
    "$DMG_PATH" >/dev/null

rm -rf "$STAGING"

SIZE=$(du -sh "$DMG_PATH" | awk '{print $1}')
echo
echo "Built: $DMG_PATH ($SIZE)"
