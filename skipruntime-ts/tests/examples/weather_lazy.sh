#!/bin/bash
set -e
cd ../../examples
cleanup() {
    jobs -p | xargs kill 2>/dev/null
}
trap cleanup EXIT

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <stdout target> <stderr target> [platform]"
    exit 1
fi

if [ "$3" = "native" ]; then
    echo "Running 'weather_lazy' example on @skipruntime/native"
    SKIP_PLATFORM="native" node dist/weather_lazy.js >/dev/null &
else
    echo "Running 'weather_lazy' example on @skipruntime/wasm"
    node dist/weather_lazy.js >/dev/null &
fi

sleep 1
node dist/weather_lazy-client.js >"$1" 2>"$2"