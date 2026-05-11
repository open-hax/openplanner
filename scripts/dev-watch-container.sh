#!/bin/sh
set -eu

cleanup() {
  kill ${CLJS_PID:-} ${TSC_PID:-} ${NODE_PID:-} 2>/dev/null || true
}
trap cleanup INT TERM EXIT

mkdir -p dist packages/stores/document-hydration/dist

./node_modules/.bin/shadow-cljs \
  -c packages/stores/document-hydration/shadow-cljs.edn \
  watch lib &
CLJS_PID=$!

./node_modules/.bin/tsc -w --preserveWatchOutput &
TSC_PID=$!

until [ -f dist/main.js ]; do
  ./node_modules/.bin/tsc || true
  sleep 1
done

node --watch dist/main.js &
NODE_PID=$!

wait "$NODE_PID"
