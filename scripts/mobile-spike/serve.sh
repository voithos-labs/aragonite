#!/usr/bin/env bash
# Builds the e2e harness and serves it on 127.0.0.1:1430 in the background, returning once
# /test/editor answers. The server outlives this step and stops with the job.
set -euo pipefail
PORT=1430
export E2E_BUILD_DIR=".svelte-kit/e2e-$PORT"
npm run build:e2e
nohup npm run preview:e2e -- --host 127.0.0.1 --port "$PORT" --strictPort > preview.log 2>&1 &
for _ in $(seq 1 90); do
	if curl -sf "http://127.0.0.1:$PORT/test/editor" > /dev/null; then exit 0; fi
	sleep 2
done
cat preview.log
exit 1
