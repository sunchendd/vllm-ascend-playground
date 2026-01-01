#!/bin/bash
# Start vLLM service

MODEL_PATH=${1:-/data2/weights/Qwen3-8B}
SERVED_MODEL_NAME=${2:-qwen3-8b}
PORT=${3:-8000}
TP_SIZE=${4:-1}
MAX_MODEL_LEN=${5:-}
DTYPE=${6:-auto}
NPU_DEVICES=${7:-0}

export ASCEND_RT_VISIBLE_DEVICES=$NPU_DEVICES

vllm_cmd="vllm serve $MODEL_PATH \
    --served-model-name $SERVED_MODEL_NAME \
    --host 0.0.0.0 \
    --port $PORT \
    --tensor-parallel-size $TP_SIZE \
    --trust-remote-code \
    --dtype $DTYPE"

if [ -n "$MAX_MODEL_LEN" ]; then
    vllm_cmd="$vllm_cmd --max-model-len $MAX_MODEL_LEN"
fi

echo "Starting vLLM with command:"
echo "$vllm_cmd"
echo "NPU Devices: $NPU_DEVICES"

exec $vllm_cmd
