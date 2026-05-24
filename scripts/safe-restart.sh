#!/bin/bash
# scripts/safe-restart.sh
# Atomic restart for AIClient2API (3000) and LiteLLM (4000)

PORT=3000
MASTER_PORT=3100
LITELLM_PORT=4000
LOG_FILE="/tmp/aiclient.log"
LITELLM_LOG="/tmp/litellm.log"

kill_listening_port() {
    local target_port=$1
    local name=$2
    echo "Stopping existing $name on port $target_port..."
    # Find the actual listening process, not the established connections.
    # Using -iTCP:$PORT -sTCP:LISTEN avoids killing the parent Claude process.
    local PID=$(lsof -nP -iTCP:$target_port -sTCP:LISTEN -t 2>/dev/null)
    if [ ! -z "$PID" ]; then
        echo "Found listening PID for $name: $PID. Killing..."
        kill $PID 2>/dev/null
        for i in $(seq 1 16); do
            if [ -z "$(lsof -nP -iTCP:$target_port -sTCP:LISTEN -t 2>/dev/null)" ]; then
                break
            fi
            sleep 0.5
        done
        local REMAIN=$(lsof -nP -iTCP:$target_port -sTCP:LISTEN -t 2>/dev/null)
        if [ ! -z "$REMAIN" ]; then
            echo "Process $REMAIN still listening on $target_port, sending SIGKILL..."
            kill -9 $REMAIN 2>/dev/null
            sleep 1
        fi
    fi
}

kill_listening_port $PORT "AIClient2API Proxy"
kill_listening_port $MASTER_PORT "AIClient2API Master"
kill_listening_port $LITELLM_PORT "LiteLLM Gateway"

if [ ! -z "$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null)" ] || [ ! -z "$(lsof -nP -iTCP:$LITELLM_PORT -sTCP:LISTEN -t 2>/dev/null)" ]; then
    echo "Error: Ports are still being listened on after kill."
    exit 1
fi

# Rotate log if it exceeds 10MB to prevent I/O contention
for lf in "$LOG_FILE" "$LITELLM_LOG"; do
    if [ -f "$lf" ]; then
        LOG_SIZE=$(stat -f%z "$lf" 2>/dev/null || echo 0)
        if [ "$LOG_SIZE" -gt 10485760 ]; then
            echo "Rotating large log file $lf..."
            mv "$lf" "${lf}.old"
        fi
    fi
done

echo "Starting LiteLLM Gateway..."
cd /Users/ilialiston/LiteLLM-Gateway && nohup venv/bin/litellm --config litellm_config.yaml --port $LITELLM_PORT > $LITELLM_LOG 2>&1 &

echo "Starting AIClient2API Proxy..."
cd /Users/ilialiston/AIClient2API && nohup npm start > $LOG_FILE 2>&1 &

echo "Waiting for services to be ready..."
PROXY_READY=0
LITELLM_READY=0

for i in $(seq 1 30); do
    if [ $PROXY_READY -eq 0 ] && curl -sf http://127.0.0.1:$PORT/api/help -o /dev/null; then
        echo "AIClient2API Proxy is ready!"
        PROXY_READY=1
    fi
    
    # Use netcat to check if the port is open instead of curling /health, 
    # because LiteLLM enforces auth on /health and returns 401.
    if [ $LITELLM_READY -eq 0 ] && nc -z 127.0.0.1 $LITELLM_PORT 2>/dev/null; then
        echo "LiteLLM Gateway is ready!"
        LITELLM_READY=1
    fi
    
    if [ $PROXY_READY -eq 1 ] && [ $LITELLM_READY -eq 1 ]; then
        echo "Both services are securely restarted and ready!"
        exit 0
    fi
    sleep 0.5
done

echo "Error: Services failed to start within 15 seconds."
tail -n 15 $LOG_FILE
tail -n 15 $LITELLM_LOG
exit 1
