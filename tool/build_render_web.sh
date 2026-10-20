#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
component="${1:?Usage: build_render_web.sh customer|admin}"
case "$component" in customer|admin) ;; *) exit 2 ;; esac
export CI=true FLUTTER_SUPPRESS_ANALYTICS=true
if [[ -z "${FLUTTER_BIN:-}" ]]; then
  sdk="${TMPDIR:-/tmp}/servicepay-flutter-3.32.0"
  if [[ ! -x "$sdk/bin/flutter" ]]; then
    git clone --depth 1 --branch 3.32.0 https://github.com/flutter/flutter.git "$sdk"
  fi
  FLUTTER_BIN="$sdk/bin/flutter"
fi
"$FLUTTER_BIN" config --enable-web
"$FLUTTER_BIN" pub get --enforce-lockfile
"$FLUTTER_BIN" build web --release --no-pub --target lib/main.dart \
  --pwa-strategy=none \
  --dart-define=SERVICEPAY_API_BASE_URL=https://api.servicepay.ng/api
python3 tool/stamp_render_web.py build/web "$component" \
  "${RENDER_GIT_COMMIT:-$(git rev-parse HEAD)}"
