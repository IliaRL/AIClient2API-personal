#!/bin/bash
# scripts/safe-restart.sh
# Atomic restart for AIClient2API on port 3000

PORT=3000
LOG_FILE="/tmp/aiclient.log"

echo "Stopping existing proxy on port $PORT..."
# Find the actual listening process, not the established connections.
# Using -iTCP:$PORT -sTCP:LISTEN avoids killing the parent Claude process,
# and only checking LISTEN avoids confusion with lingering CLOSE_WAIT/TIME_WAIT.
PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t)
if [ ! -z "$PID" ]; then
    echo "Found listening PID: $PID. Killing..."
    kill $PID 2>/dev/null
    # Wait up to 8 seconds for the LISTEN socket to go away.
    for i in $(seq 1 16); do
        if [ -z "$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t)" ]; then
            break
        fi
        sleep 0.5
    done
    # If still listening, escalate to SIGKILL.
    REMAIN=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t)
    if [ ! -z "$REMAIN" ]; then
        echo "Process $REMAIN still listening, sending SIGKILL..."
        kill -9 $REMAIN 2>/dev/null
        sleep 1
    fi
fi

if [ ! -z "$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t)" ]; then
    echo "Error: Port $PORT is still being listened on after kill."
    exit 1
fi

echo "Starting proxy..."
npm start > $LOG_FILE 2>&1 &

echo "Waiting for proxy to be ready..."
for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:$PORT/api/help -o /dev/null; then
        echo "Proxy is ready!"
        exit 0
    fi
    sleep 0.5
done

echo "Error: Proxy failed to start within 15 seconds."
tail -n 30 $LOG_FILE
exit 1
