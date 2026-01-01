#!/bin/bash
# Create Ascend vLLM container

CONTAINER_NAME=${1:-vllm-ascend}
IMAGE=${2:-quay.io/ascend/vllm-ascend:v0.13.0rc1}
NPU_DEVICES=${3:-0,1,2,3,4,5,6,7}
SHM_SIZE=${4:-60g}

# Build NPU device options
NPU_OPTS=""
IFS=',' read -ra DEVICES <<< "$NPU_DEVICES"
for i in "${DEVICES[@]}"; do
    NPU_OPTS="$NPU_OPTS --device /dev/davinci${i}"
done

docker run -d --name $CONTAINER_NAME \
    $NPU_OPTS \
    --device /dev/davinci_manager \
    --device /dev/devmm_svm \
    --device /dev/hisi_hdc \
    -v /usr/local/dcmi:/usr/local/dcmi \
    -v /usr/local/bin/npu-smi:/usr/local/bin/npu-smi \
    -v /usr/local/Ascend/driver/lib64/:/usr/local/Ascend/driver/lib64/ \
    -v /usr/local/Ascend/driver/version.info:/usr/local/Ascend/driver/version.info \
    -v /etc/ascend_install.info:/etc/ascend_install.info \
    -v /data2/weights:/data2/weights \
    -v ~/.cache/modelscope:/root/.cache/modelscope \
    --shm-size=$SHM_SIZE \
    --network host \
    $IMAGE \
    sleep infinity

echo "Container $CONTAINER_NAME created"
