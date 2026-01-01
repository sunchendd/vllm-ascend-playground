#!/bin/bash
# vLLM Ascend Playground 启动脚

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-7860}"
RELOAD="${RELOAD:-false}"

echo "========================================="
echo "  vLLM Ascend Playground"
echo "========================================="

pip show fastapi &> /dev/null || pip install -r "${SCRIPT_DIR}/requirements.txt"
mkdir -p "${SCRIPT_DIR}/results"

while [[ $# -gt 0 ]]; do
    case $1 in
        --host) HOST="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        --reload) RELOAD="true"; shift ;;
        *) shift ;;
    esac
done

echo "启动服务器: http://${HOST}:${PORT}"
cd "${SCRIPT_DIR}"

if [ "$RELOAD" = "true" ]; then
    /data2/scd/scd/.venv/bin/python -m uvicorn app:app --host "$HOST" --port "$PORT" --reload
else
    /data2/scd/scd/.venv/bin/python -m uvicorn app:app --host "$HOST" --port "$PORT"
fi
