#!/bin/bash
# scripts/safe-restart.sh
# Atomic restart for AIClient2API on port 3000

PORT=3000
MASTER_PORT=3100
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

# Also clear any orphaned master process on the management port (3100).
# safe-restart.sh kills port 3000 only — a stale master.js can survive and
# block the new process from binding port 3100, causing a fatal crash.
MASTER_PID=$(lsof -nP -iTCP:$MASTER_PORT -sTCP:LISTEN -t 2>/dev/null)
if [ ! -z "$MASTER_PID" ]; then
    echo "Clearing orphaned master process on port $MASTER_PORT (PID $MASTER_PID)..."
    kill $MASTER_PID 2>/dev/null
    sleep 1
    MASTER_REMAIN=$(lsof -nP -iTCP:$MASTER_PORT -sTCP:LISTEN -t 2>/dev/null)
    if [ ! -z "$MASTER_REMAIN" ]; then
        kill -9 $MASTER_REMAIN 2>/dev/null
        sleep 0.5
    fi
fi

# Rotate log if it exceeds 10MB to prevent I/O contention
if [ -f "$LOG_FILE" ]; then
    LOG_SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$LOG_SIZE" -gt 10485760 ]; then
        echo "Rotating large log file (${LOG_SIZE} bytes)..."
        mv "$LOG_FILE" "${LOG_FILE}.old"
    fi
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
