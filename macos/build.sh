#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="FlavorPress"
BUILD_DIR="$SCRIPT_DIR/build"
CACHE_DIR="$SCRIPT_DIR/.cache"
APP_BUNDLE="$BUILD_DIR/${APP_NAME}.app"
MACOS_DIR="$APP_BUNDLE/Contents/MacOS"
RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"
SERVER_DIR="$RESOURCES_DIR/server"

NODE_VERSION="v22.11.0"
NODE_ARCH="darwin-arm64"
NODE_TARBALL="node-${NODE_VERSION}-${NODE_ARCH}.tar.xz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"
NODE_CACHED_BIN="$CACHE_DIR/node-${NODE_VERSION}-${NODE_ARCH}/bin/node"

mkdir -p "$CACHE_DIR"

if [[ ! -x "$NODE_CACHED_BIN" ]]; then
    echo "Downloading Node ${NODE_VERSION} ${NODE_ARCH}..."
    curl -fsSL -o "$CACHE_DIR/$NODE_TARBALL" "$NODE_URL"
    tar -xJf "$CACHE_DIR/$NODE_TARBALL" -C "$CACHE_DIR"
    rm -f "$CACHE_DIR/$NODE_TARBALL"
fi

echo "Building Next.js standalone bundle..."
cd "$PROJECT_DIR"
if [[ ! -d node_modules ]]; then
    npm install
fi
npm run build > /dev/null

if [[ ! -d "$PROJECT_DIR/.next/standalone" ]]; then
    echo "ERROR: .next/standalone missing. Is output: 'standalone' set in next.config.ts?"
    exit 1
fi

cd "$SCRIPT_DIR"
rm -rf "$BUILD_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$SERVER_DIR"

echo "Assembling server resources..."
cp -R "$PROJECT_DIR/.next/standalone/." "$SERVER_DIR/"
mkdir -p "$SERVER_DIR/.next"
cp -R "$PROJECT_DIR/.next/static" "$SERVER_DIR/.next/static"
if [[ -d "$PROJECT_DIR/public" ]]; then
    cp -R "$PROJECT_DIR/public" "$SERVER_DIR/public"
fi

cp "$NODE_CACHED_BIN" "$RESOURCES_DIR/node"
chmod +x "$RESOURCES_DIR/node"

echo "Compiling Swift sources..."
swiftc \
    -O \
    -parse-as-library \
    -target arm64-apple-macos14.0 \
    -framework AppKit \
    -framework SwiftUI \
    -framework WebKit \
    -framework ServiceManagement \
    -framework Network \
    -o "$MACOS_DIR/$APP_NAME" \
    "$SCRIPT_DIR/Sources/FlavorPressApp.swift"

cp "$SCRIPT_DIR/Resources/Info.plist" "$APP_BUNDLE/Contents/Info.plist"

echo "Ad-hoc signing bundle..."
codesign --force --deep --sign - "$APP_BUNDLE" 2>&1 | tail -3

SIZE=$(du -sh "$APP_BUNDLE" | awk '{print $1}')
echo
echo "Built: $APP_BUNDLE ($SIZE)"
echo "Run:   open '$APP_BUNDLE'"
