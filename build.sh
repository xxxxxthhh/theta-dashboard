#!/bin/bash
set -euo pipefail

echo "=== $(date '+%Y-%m-%d %H:%M:%S') Theta Dashboard Build ==="

build_dashboard=false
build_local=false
push_after_build=false

if [ $# -eq 0 ]; then
    build_dashboard=true
fi

for arg in "$@"; do
    case "$arg" in
        --local)
            build_local=true
            ;;
        --all)
            build_dashboard=true
            build_local=true
            ;;
        --push)
            build_dashboard=true
            push_after_build=true
            ;;
        *)
            echo "❌ Error: unknown option $arg"
            echo "   Supported flags: --local, --all, --push"
            exit 1
            ;;
    esac
done

if ! $build_dashboard && ! $build_local; then
    build_dashboard=true
fi

if $build_dashboard; then
    if [ -z "${DASHBOARD_PASS:-}" ]; then
        echo "❌ Error: DASHBOARD_PASS environment variable is not set"
        echo "   Export it first: export DASHBOARD_PASS=\"your-password\""
        exit 1
    fi

    node src/build.js
fi

if $build_local; then
    node src/build-local.js
fi

if $push_after_build; then
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
