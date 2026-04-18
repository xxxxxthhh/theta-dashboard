#!/bin/bash
set -euo pipefail

echo "=== $(date '+%Y-%m-%d %H:%M:%S') Theta Dashboard Build ==="

# Validate environment
if [ -z "${DASHBOARD_PASS:-}" ]; then
    echo "❌ Error: DASHBOARD_PASS environment variable is not set"
    echo "   Export it first: export DASHBOARD_PASS=\"your-password\""
    exit 1
fi

# Run full build pipeline
node src/build.js

# Optional: git commit and push with --push flag
if [[ "${1:-}" == "--push" ]]; then
    git add index.html
    if ! git diff --cached --quiet; then
        git commit -m "build: update dashboard $(date '+%Y-%m-%d')"
        git push
        echo "✅ Pushed to remote"
    else
        echo "ℹ️  No changes to push"
    fi
fi

echo "=== Done ==="
