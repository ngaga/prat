#!/usr/bin/env sh
# Next must not inherit a preview PORT (e.g. 10000) or it may bind the wrong port.
# Nest still receives PORT from the parent process when run in parallel via pnpm.
cd "$(dirname "$0")/.." || exit 1
export NEXT_PUBLIC_NEST_PORT="${PORT:-3001}"
unset PORT
# Use webpack dev (not Turbopack) to avoid occasional Turbopack panics on some setups.
exec npx next dev --webpack
