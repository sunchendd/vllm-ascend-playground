#!/bin/bash
# Run vLLM Bench benchmark

URL=${1:-http://127.0.0.1:8000}
MODEL=${2:-default-model}
RATE=${3:-10}
CONCURRENCY=${4:-16}
NUM_PROMPTS=${5:-100}
INPUT_LEN=${6:-1024}
OUTPUT_LEN=${7:-512}

vllm bench serve \
    --base-url "$URL" \
    --model "$MODEL" \
    --request-rate "$RATE" \
    --max-concurrency "$CONCURRENCY" \
    --num-prompts "$NUM_PROMPTS" \
    --random-input-len "$INPUT_LEN" \
    --random-output-len "$OUTPUT_LEN"
