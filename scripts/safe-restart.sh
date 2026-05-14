#!/bin/bash
# scripts/safe-restart.sh
# Atomic restart for AIClient2API on port 3000

PORT=3000
LOG_FILE="/tmp/aiclient.log"

echo "Stopping existing proxy on port $PORT..."
PID=$(lsof -t -i:$PORT)
if [ ! -z "$PID" ]; then
    kill $PID
    sleep 0.5
fi

echo "Starting proxy..."
npm start > $LOG_FILE 2>&1 &

echo "Waiting for proxy to be ready..."
for i in $(seq 1 10); do
    if curl -sf http://127.0.0.1:$PORT/api/help -o /dev/null; then
        echo "Proxy is ready!"
        exit 0
    fi
    sleep 0.5
done

echo "Error: Proxy failed to start within 5 seconds."
tail -n 20 $LOG_FILE
exit 1
