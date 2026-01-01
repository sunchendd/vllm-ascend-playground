"""
vLLM Ascend Playground - A web interface for managing vLLM on Ascend NPU
"""
import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Optional, List, Dict, Any, Literal
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

from container_manager import AscendContainerManager
from model_manager import ModelManager
from benchmark_manager import BenchmarkManager
from service_manager import ServiceManager
from service_manager import ServiceManager

app = FastAPI(title="vLLM Ascend Playground", version="1.0.0")
BASE_DIR = Path(__file__).parent
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

container_manager = AscendContainerManager()
model_manager = ModelManager()
benchmark_manager = BenchmarkManager()
service_manager = ServiceManager(container_manager)

vllm_running: bool = False
current_container: Optional[str] = None
websocket_connections: List[WebSocket] = []

class ModelSource(BaseModel):
    source_type: Literal["modelscope", "local"] = "local"
    model_id: Optional[str] = None
    local_path: Optional[str] = None

class VLLMConfig(BaseModel):
    model_source: ModelSource
    served_model_name: str = "default-model"
    host: str = "0.0.0.0"
    port: int = 8000
    tensor_parallel_size: int = 1
    max_model_len: Optional[int] = None
    trust_remote_code: bool = True
    dtype: str = "auto"
    npu_devices: List[int] = [0]
    additional_args: Optional[str] = None

class ContainerConfig(BaseModel):
    container_name: str
    image: str = "quay.io/ascend/vllm-ascend:v0.13.0rc1"
    npu_devices: List[int] = [0, 1, 2, 3, 4, 5, 6, 7]
    mount_paths: Dict[str, str] = {}
    shm_size: str = "60g"

class BenchmarkConfig(BaseModel):
    benchmark_type: Literal["evalscope", "vllm_bench"] = "evalscope"
    url: str = "http://localhost:8000/v1/chat/completions"
    model_name: str = "default-model"
    parallel: int = 1
    number: int = 10
    dataset: str = "openqa"
    temperature: float = 0.0
    request_rate: float = 1.0
    max_concurrency: int = 1
    num_prompts: int = 5
    random_input_len: int = 1024
    random_output_len: int = 1024

@app.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/api/status")
async def get_status():
    # 并行获取容器和 NPU 状态
    import asyncio
    containers_task = container_manager.list_containers(running_only=True)
    npu_task = container_manager.get_npu_status()
    containers, npu_status = await asyncio.gather(containers_task, npu_task)
    return {"vllm_running": vllm_running, "current_container": current_container, "containers": containers, "npu_status": npu_status}

@app.get("/api/models")
async def list_models():
    local_models = model_manager.list_local_models()
    modelscope_models = model_manager.list_modelscope_cache()
    return {"local_models": local_models, "modelscope_models": modelscope_models}

@app.post("/api/models/download")
async def download_model(model_id: str, source: str = "modelscope", cache_dir: Optional[str] = None):
    try:
        result = await model_manager.download_model(model_id, source, cache_dir)
        return {"success": True, "message": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/containers")
async def list_containers(keyword: Optional[str] = None, running_only: bool = False):
    """List containers with optional filters
    
    Args:
        keyword: Filter by container name, image, or id (case-insensitive)
        running_only: Only return running containers
    """
    containers = await container_manager.list_containers(keyword=keyword, running_only=running_only)
    return {"containers": containers}

@app.post("/api/containers/create")
async def create_container(config: ContainerConfig):
    try:
        container_id = await container_manager.create_container(config)
        return {"success": True, "container_id": container_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/containers/{container_name}/start")
async def start_container(container_name: str):
    try:
        await container_manager.start_container(container_name)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/containers/{container_name}/stop")
async def stop_container(container_name: str):
    try:
        await container_manager.stop_container(container_name)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/containers/{container_name}")
async def delete_container(container_name: str):
    try:
        await container_manager.delete_container(container_name)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/vllm/start")
async def start_vllm(config: VLLMConfig, container_name: str):
    global vllm_running, current_container
    try:
        cmd = build_vllm_command(config)
        # 使用 service_manager 启动并跟踪服务
        model_name = config.model_source.local_path or config.model_source.model_id or "unknown"
        service = await service_manager.start_service(
            container_name=container_name,
            command=cmd,
            model=model_name,
            port=config.port,
            npu_devices=config.npu_devices
        )
        vllm_running = True
        current_container = container_name
        return {"success": True, "command": cmd, "service_id": service.id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/vllm/stop")
async def stop_vllm(service_id: str = None):
    global vllm_running, current_container
    if service_id:
        # 停止指定服务
        success = await service_manager.stop_service(service_id)
        if service_manager.get_running_count() == 0:
            vllm_running = False
            current_container = None
        return {"success": success}
    else:
        # 兼容旧逻辑：停止所有服务
        for service in service_manager.list_services():
            if service["status"] == "running":
                await service_manager.stop_service(service["id"])
        vllm_running = False
        current_container = None
        return {"success": True}

@app.delete("/api/services/{service_id}")
async def remove_service(service_id: str):
    """Remove a service from tracking"""
    success = await service_manager.remove_service(service_id)
    if not success:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"success": True}

@app.get("/api/services")
async def list_services():
    """List all tracked services"""
    await service_manager.refresh_status()
    return {
        "services": service_manager.list_services(),
        "running_count": service_manager.get_running_count()
    }

@app.get("/api/services/{service_id}")
async def get_service(service_id: str):
    """Get a specific service"""
    service = service_manager.get_service(service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    return service

@app.get("/api/vllm/logs")
async def get_vllm_logs(lines: int = 100):
    if not current_container:
        return {"logs": ""}
    try:
        logs = await container_manager.get_container_logs(current_container, lines)
        return {"logs": logs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/logs/playground")
async def get_playground_logs(lines: int = 200):
    """Get Playground service logs"""
    import subprocess
    try:
        # 读取 uvicorn 进程的最近输出（如果有日志文件）
        log_file = Path(__file__).parent / "playground.log"
        if log_file.exists():
            result = subprocess.run(["tail", "-n", str(lines), str(log_file)], 
                                   capture_output=True, text=True)
            return {"logs": result.stdout}
        else:
            return {"logs": "Playground 日志文件不存在。服务正常运行中。\n\n提示: 可以使用 --reload 参数启动服务以获取实时日志。"}
    except Exception as e:
        return {"logs": f"读取日志失败: {str(e)}"}

@app.get("/api/logs/container/{container_name}")
async def get_container_logs_api(container_name: str, lines: int = 200):
    """Get logs from a specific container"""
    try:
        logs = await container_manager.get_container_logs(container_name, lines)
        return {"logs": logs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/logs/system")
async def get_system_logs(lines: int = 100):
    """Get system logs (dmesg)"""
    import subprocess
    try:
        result = subprocess.run(["dmesg", "-T"], capture_output=True, text=True)
        log_lines = result.stdout.strip().split('\n')
        return {"logs": '\n'.join(log_lines[-lines:])}
    except Exception as e:
        return {"logs": f"读取系统日志失败: {str(e)}"}

@app.get("/api/logs/playground")
async def get_playground_logs(lines: int = 200):
    """Get Playground service logs"""
    import subprocess
    try:
        # 读取 uvicorn 进程的最近输出（如果有日志文件）
        log_file = Path(__file__).parent / "playground.log"
        if log_file.exists():
            result = subprocess.run(["tail", "-n", str(lines), str(log_file)], 
                                   capture_output=True, text=True)
            return {"logs": result.stdout}
        else:
            return {"logs": "Playground 日志文件不存在。服务正常运行中。\n\n提示: 可以使用 --reload 参数启动服务以获取实时日志。"}
    except Exception as e:
        return {"logs": f"读取日志失败: {str(e)}"}

@app.get("/api/logs/container/{container_name}")
async def get_container_logs_api(container_name: str, lines: int = 200):
    """Get logs from a specific container"""
    try:
        logs = await container_manager.get_container_logs(container_name, lines)
        return {"logs": logs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/logs/system")
async def get_system_logs(lines: int = 100):
    """Get system logs (dmesg)"""
    import subprocess
    try:
        result = subprocess.run(["dmesg", "-T"], capture_output=True, text=True)
        log_lines = result.stdout.strip().split('\n')
        return {"logs": '\n'.join(log_lines[-lines:])}
    except Exception as e:
        return {"logs": f"读取系统日志失败: {str(e)}"}

def build_vllm_command(config: VLLMConfig) -> str:
    env_vars = []
    npu_devices = ",".join(map(str, config.npu_devices))
    env_vars.append(f"export ASCEND_RT_VISIBLE_DEVICES={npu_devices}")
    
    if config.model_source.source_type == "modelscope":
        env_vars.append('export VLLM_USE_MODELSCOPE="True"')
        model_path = config.model_source.model_id
    else:
        model_path = config.model_source.local_path
    
    cmd_parts = [f"vllm serve {model_path}", f"--served-model-name {config.served_model_name}",
                 f"--host {config.host}", f"--port {config.port}",
                 f"--tensor-parallel-size {config.tensor_parallel_size}"]
    
    if config.max_model_len:
        cmd_parts.append(f"--max-model-len {config.max_model_len}")
    if config.trust_remote_code:
        cmd_parts.append("--trust-remote-code")
    if config.dtype != "auto":
        cmd_parts.append(f"--dtype {config.dtype}")
    if config.additional_args:
        cmd_parts.append(config.additional_args)
    
    vllm_cmd = " \\\n".join(cmd_parts)
    return " && ".join(env_vars) + " && " + vllm_cmd



# ==================== 运行中的 vLLM 服务 API ====================
@app.get("/api/vllm/running")
async def get_running_vllm_services():
    """获取所有正在运行的 vLLM 服务"""
    try:
        services = await container_manager.get_running_vllm_services()
        return {"services": services, "count": len(services)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/vllm/kill")
async def kill_vllm_service(container_name: str, pid: str = None):
    """停止指定容器中的 vLLM 服务"""
    try:
        success = await container_manager.kill_vllm_service(container_name, pid)
        return {"success": success}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/benchmark/run")
async def run_benchmark(config: BenchmarkConfig, container_name: Optional[str] = None):
    try:
        if config.benchmark_type == "evalscope":
            result = await benchmark_manager.run_evalscope(config, container_name)
        else:
            result = await benchmark_manager.run_vllm_bench(config, container_name)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/benchmark/results")
async def get_benchmark_results():
    return benchmark_manager.get_history()

@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    await websocket.accept()
    websocket_connections.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        websocket_connections.remove(websocket)

@app.get("/api/presets")
async def get_presets():
    presets_file = BASE_DIR / "config" / "presets.json"
    if presets_file.exists():
        with open(presets_file) as f:
            return json.load(f)
    return {"presets": []}

@app.post("/api/presets")
async def save_preset(name: str, config: Dict[str, Any]):
    presets_file = BASE_DIR / "config" / "presets.json"
    presets = {"presets": []}
    if presets_file.exists():
        with open(presets_file) as f:
            presets = json.load(f)
    preset = {"name": name, "config": config, "created_at": datetime.now().isoformat()}
    presets["presets"] = [p for p in presets["presets"] if p["name"] != name]
    presets["presets"].append(preset)
    with open(presets_file, "w") as f:
        json.dump(presets, f, indent=2)
    return {"success": True}

@app.get("/api/npu/status")
async def get_npu_status():
    status = await container_manager.get_npu_status()
    return {"npu_status": status}



# ==================== AI 对话 API ====================
class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    model: str = "default-model"
    temperature: float = 0.7
    max_tokens: int = 2048
    stream: bool = False
    url: str = "http://localhost:8000"

@app.post("/api/chat")
async def chat_completion(request: ChatRequest):
    """调用 vLLM 服务进行对话"""
    import httpx
    
    try:
        api_url = f"{request.url.rstrip('/')}/v1/chat/completions"
        payload = {
            "model": request.model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": request.stream
        }
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(api_url, json=payload)
            response.raise_for_status()
            return response.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail=f"无法连接到 vLLM 服务: {request.url}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/chat/models")
async def list_chat_models(url: str = "http://localhost:8000"):
    """获取 vLLM 服务的可用模型列表"""
    import httpx
    
    try:
        api_url = f"{url.rstrip('/')}/v1/models"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(api_url)
            response.raise_for_status()
            return response.json()
    except Exception as e:
        return {"data": [], "error": str(e)}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="vLLM Ascend Playground")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind")
    parser.add_argument("--port", type=int, default=7860, help="Port to bind")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    args = parser.parse_args()
    uvicorn.run("app:app", host=args.host, port=args.port, reload=args.reload)

# ==================== 镜像管理 API ====================
@app.get("/api/images")
async def list_images():
    """列出本地镜像"""
    try:
        output = await container_manager.run_command("docker images --format '{{json .}}'", check=False)
        images = []
        for line in output.strip().split('\n'):
            if line:
                try:
                    import json
                    data = json.loads(line)
                    images.append({
                        "id": data.get("ID", ""),
                        "repository": data.get("Repository", ""),
                        "tag": data.get("Tag", ""),
                        "size": data.get("Size", ""),
                        "created": data.get("CreatedAt", data.get("CreatedSince", ""))
                    })
                except:
                    pass
        return {"images": images}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/images/pull")
async def pull_image(image: str):
    """下载镜像"""
    try:
        # 使用后台任务执行 docker pull
        import asyncio
        process = await asyncio.create_subprocess_shell(
            f"docker pull {image}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        
        if process.returncode == 0:
            return {"success": True, "message": f"镜像 {image} 下载成功"}
        else:
            return {"success": False, "message": stderr.decode()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
