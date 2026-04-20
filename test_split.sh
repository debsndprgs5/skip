#!/bin/bash
cd /workspace
killall -9 node 2>/dev/null
sleep 1

node skipruntime-ts/examples/dist/weather_lazy.js &
SERVER_PID=$!
sleep 1

node /workspace/test_external_query.js

kill $SERVER_PID 2>/dev/null