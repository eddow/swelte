#!/usr/bin/env bash
# e2e.sh — one battery, two configs (dev vs preview).
#   ./scripts/e2e.sh dev      → boots swelte dev, runs shared + dev extras
#   ./scripts/e2e.sh preview  → SERVE=direct then SERVE=preview (same battery)
#   ./scripts/e2e.sh all      → preview + dev (CI full)
# Bash owns boot order/teardown sequencing; node:test files stay assert-only
# (pool-free helpers.js + detached group-kill, no fetch keep-alive).
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-preview}"
case "$mode" in
  dev)
    node --test --test-reporter=spec "tests/e2e/dev.test.js"
    ;;
  preview)
    if [ ! -x dist/server ] || [ ! -f dist/index.html ]; then
      echo "e2e preview needs dist/server — run 'swelte build' first" >&2
      exit 1
    fi
    SERVE=direct node --test --test-reporter=spec "tests/e2e/preview.test.js"
    SERVE=preview node --test --test-reporter=spec "tests/e2e/preview.test.js"
    ;;
  all)
    "$0" preview
    "$0" dev
    ;;
  *)
    echo "usage: e2e.sh [dev|preview|all]" >&2
    exit 2
    ;;
esac
