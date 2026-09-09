#!/usr/bin/env bash
set -euo pipefail

# Keep post-merge setup deterministic and non-interactive. The root lockfile
# owns the shared runtime dependencies used by the backend process.
if [[ -f package-lock.json ]]; then
  npm ci --ignore-scripts --no-audit --no-fund
fi

# The backend has its own manifest and may be run from its directory in a
# workflow, so install its declared dependencies in that package scope too.
if [[ -f backend/package.json ]]; then
  npm --prefix backend install --ignore-scripts --no-audit --no-fund
fi

# Flutter is not installed in every backend/task-agent environment. Run the
# resolver where available, without making backend-only merges fail elsewhere.
if command -v flutter >/dev/null 2>&1 && [[ -f pubspec.yaml ]]; then
  flutter pub get
fi