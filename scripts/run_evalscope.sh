#!/bin/bash
# Run EvalScope Perf benchmark

URL=${1:-http://127.0.0.1:8000/v1/chat/completions}
MODEL=${2:-default-model}
PARALLEL=${3:-1}
NUMBER=${4:-10}
DATASET=${5:-openqa}

evalscope perf \
    --url "$URL" \
    --model "$MODEL" \
    --api openai \
    --parallel "$PARALLEL" \
    --number "$NUMBER" \
    --dataset "$DATASET" \
    --temperature 0 \
    --stream
