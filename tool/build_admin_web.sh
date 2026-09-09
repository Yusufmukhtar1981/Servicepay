#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${ADMIN_OUTPUT_DIR:-build/admin-web}"
BUILD_VERSION="${SERVICEPAY_BUILD_VERSION:-$(date -u +%Y.%m.%d)}"
BUILD_COMMIT="${SERVICEPAY_BUILD_COMMIT:-$(git rev-parse --short=12 HEAD)}"
API_BASE_URL="${SERVICEPAY_API_BASE_URL:-https://api.servicepay.ng/api}"

rm -rf "$OUTPUT_DIR"

PUB_CACHE="${PUB_CACHE:-$PWD/.dart_tool/pub-cache}" flutter pub get
PUB_CACHE="${PUB_CACHE:-$PWD/.dart_tool/pub-cache}" flutter build web \
  --release \
  --target lib/admin/main.dart \
  --output "$OUTPUT_DIR" \
  --dart-define="SERVICEPAY_API_BASE_URL=$API_BASE_URL" \
  --dart-define="SERVICEPAY_BUILD_VERSION=$BUILD_VERSION" \
  --dart-define="SERVICEPAY_BUILD_COMMIT=$BUILD_COMMIT"

printf 'Admin build created at %s (build %s, commit %s)\n' \
  "$OUTPUT_DIR" "$BUILD_VERSION" "$BUILD_COMMIT"