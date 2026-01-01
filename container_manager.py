"""Ascend NPU Container Manager"""
import asyncio
import re
import json
import logging
import subprocess
import shutil
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class AscendContainerManager:
    """Ascend NPU container lifecycle manager"""
    
    DEFAULT_IMAGE = "quay.io/ascend/vllm-ascend:v0.13.0rc1"
    NPU_DEVICES = [f"/dev/davinci{i}" for i in range(16)]
    ASCEND_MOUNTS = [
        "/usr/local/dcmi:/usr/local/dcmi",
        "/usr/local/bin/npu-smi:/usr/local/bin/npu-smi",
        "/usr/local/Ascend/driver/lib64/:/usr/local/Ascend/driver/lib64/",
        "/usr/local/Ascend/driver/version.info:/usr/local/Ascend/driver/version.info",
        "/etc/ascend_install.info:/etc/ascend_install.info",
    ]
    MODEL_MOUNTS = [
        "/data2/weights:/data2/weights",
        "/root/.cache/modelscope:/root/.cache/modelscope",
    ]
    
    def __init__(self):
        self.runtime = self._detect_runtime()
    
    def _detect_runtime(self) -> Optional[str]:
        """Detect available container runtime"""
        for rt in ["docker", "podman", "nerdctl"]:
            if shutil.which(rt):
                logger.info(f"Using container runtime: {rt}")
                return rt
        logger.warning("No container runtime found")
        return None

    async def run_command(self, cmd: str, check: bool = True) -> str:
        """Run shell command async"""
        proc = await asyncio.create_subprocess_shell(
            cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        if check and proc.returncode != 0:
            raise Exception(f"Command failed: {stderr.decode()}")
        return stdout.decode()

    async def list_containers(self, keyword: Optional[str] = None, running_only: bool = False) -> List[Dict[str, Any]]:
        """List all containers with optional keyword filter
        
        Args:
            keyword: Filter containers by name, image, or id (case-insensitive)
            running_only: Only return running containers
        """
        if not self.runtime:
            logger.warning("No container runtime available")
            return []
        
        try:
            # List all containers without filtering by image
            cmd = f'{self.runtime} ps -a --format "{{{{json .}}}}"'
            output = await self.run_command(cmd, check=False)
            
            containers = []
            for line in output.strip().split("\n"):
                if not line or line.strip() == "":
                    continue
                try:
                    data = json.loads(line)
                    # Handle different JSON field names between docker versions
                    container_id = data.get("ID", data.get("Id", ""))
                    name = data.get("Names", data.get("Name", ""))
                    image = data.get("Image", "")
                    status = data.get("Status", data.get("State", ""))
                    created = data.get("CreatedAt", data.get("Created", ""))
                    is_running = "Up" in status or status == "running"
                    
                    # Apply running_only filter
                    if running_only and not is_running:
                        continue
                    
                    # Apply keyword filter (case-insensitive match on name, image, or id)
                    if keyword:
                        keyword_lower = keyword.lower()
                        searchable = f"{name} {image} {container_id}".lower()
                        if keyword_lower not in searchable:
                            continue
                    
                    containers.append({
                        "id": container_id,
                        "name": name,
                        "image": image,
                        "status": status,
                        "running": is_running,
                        "created": created,
                    })
                except json.JSONDecodeError as e:
                    logger.debug(f"Failed to parse container JSON: {line}, error: {e}")
                    continue
            
            return containers
        except Exception as e:
            logger.error(f"Error listing containers: {e}")
            return []

    async def create_container(self, config) -> str:
        """Create a new container"""
        if not self.runtime:
            raise Exception("No container runtime available")
        
        npu_opts = " ".join([f"--device /dev/davinci{i}" for i in config.npu_devices])
        mount_opts = " ".join([f"-v {m}" for m in self.ASCEND_MOUNTS + self.MODEL_MOUNTS])
        
        if hasattr(config, 'mount_paths') and config.mount_paths:
            for src, dst in config.mount_paths.items():
                mount_opts += f" -v {src}:{dst}"
        
        cmd = f"""{self.runtime} run -d --name {config.container_name} \
            {npu_opts} \
            --device /dev/davinci_manager \
            --device /dev/devmm_svm \
            --device /dev/hisi_hdc \
            {mount_opts} \
            --shm-size={config.shm_size} \
            --network host \
            {config.image} \
            sleep infinity"""
        
        result = await self.run_command(cmd)
        return result.strip()

    async def start_container(self, container_name: str) -> None:
        """Start a container"""
        if not self.runtime:
            raise Exception("No container runtime available")
        await self.run_command(f"{self.runtime} start {container_name}")

    async def stop_container(self, container_name: str) -> None:
        """Stop a container"""
        if not self.runtime:
            raise Exception("No container runtime available")
        await self.run_command(f"{self.runtime} stop {container_name}")

    async def delete_container(self, container_name: str) -> None:
        """Delete a container"""
        if not self.runtime:
            raise Exception("No container runtime available")
        await self.run_command(f"{self.runtime} rm -f {container_name}")

    async def exec_command(self, container_name: str, command: str, detach: bool = False) -> str:
        """Execute command in container"""
        if not self.runtime:
            raise Exception("No container runtime available")
        detach_flag = "-d" if detach else ""
        cmd = f'{self.runtime} exec {detach_flag} {container_name} bash -c "{command}"'
        return await self.run_command(cmd, check=not detach)

    async def get_container_logs(self, container_name: str, lines: int = 100) -> str:
        """Get container logs"""
        if not self.runtime:
            return "No container runtime available"
        try:
            return await self.run_command(f"{self.runtime} logs --tail {lines} {container_name} 2>&1", check=False)
        except Exception as e:
            return f"Error getting logs: {e}"

    async def get_npu_status(self) -> List[Dict[str, Any]]:
        """Get NPU status using npu-smi info"""
        npus = []
        try:
            # Check if npu-smi exists
            if not shutil.which("npu-smi"):
                # Return mock data for testing
                return [{"id": i, "utilization": 0, "available": True, "occupied": False, "container": None, "process_id": None, "process_name": None, "hbm_used": 0, "hbm_total": 65536, "power": 0, "temperature": 0, "health": "Unknown"} for i in range(8)]
            
            # Get full npu-smi info output
            result = await self.run_command("npu-smi info 2>/dev/null", check=False)
            
            # Parse NPU basic info and process info
            npu_info = {}  # id -> {utilization, hbm_used, hbm_total, power, temp, health}
            npu_processes = {}  # id -> {process_id, process_name, container}
            
            lines = result.split("\n")
            in_process_section = False
            current_npu_id = None
            
            for i, line in enumerate(lines):
                # Detect process section
                if "Process id" in line and "Process name" in line:
                    in_process_section = True
                    continue
                
                # Parse NPU basic info rows
                if not in_process_section:
                    # Match NPU info line: | 0     910B2C              | OK            | 89.5        43 ...
                    if "|" in line and ("910B" in line or "310P" in line or "Ascend" in line):
                        parts = [p.strip() for p in line.split("|")]
                        if len(parts) >= 4:
                            try:
                                npu_part = parts[1].split()
                                if npu_part and npu_part[0].isdigit():
                                    npu_id = int(npu_part[0])
                                    current_npu_id = npu_id
                                    health = parts[2].strip()
                                    power_temp = parts[3].split()
                                    power = float(power_temp[0]) if power_temp else 0
                                    temp = int(power_temp[1]) if len(power_temp) > 1 else 0
                                    
                                    npu_info[npu_id] = {"health": health, "power": power, "temperature": temp, "utilization": 0, "hbm_used": 0, "hbm_total": 65536}
                            except (ValueError, IndexError):
                                pass
                    
                    # Match Chip info line with AICore% and HBM
                    elif "|" in line and "0000:" in line and current_npu_id is not None:
                        parts = [p.strip() for p in line.split("|")]
                        if len(parts) >= 4:
                            try:
                                metrics = parts[3].split()
                                if metrics:
                                    aicore = int(metrics[0])
                                    npu_info[current_npu_id]["utilization"] = aicore
                                    
                                    # Find HBM usage - look for last "number/ number" pattern
                                    full_metrics = parts[3]
                                    # Pattern: "57369/ 65536" or "3413 / 65536"
                                    hbm_match = re.findall(r'(\d+)\s*/\s*(\d+)', full_metrics)
                                    if hbm_match:
                                        # Take the last match (HBM is at the end)
                                        hbm_used, hbm_total = hbm_match[-1]
                                        npu_info[current_npu_id]["hbm_used"] = int(hbm_used)
                                        npu_info[current_npu_id]["hbm_total"] = int(hbm_total)
                            except (ValueError, IndexError):
                                pass
                else:
                    # Parse process info
                    if "|" in line and "No running processes" not in line and "===" not in line:
                        parts = [p.strip() for p in line.split("|")]
                        if len(parts) >= 5:
                            try:
                                npu_chip = parts[1].split()
                                if npu_chip and npu_chip[0].isdigit():
                                    npu_id = int(npu_chip[0])
                                    process_id = parts[2].strip()
                                    process_name = parts[3].strip()
                                    
                                    if process_id.isdigit():
                                        npu_processes[npu_id] = {
                                            "process_id": int(process_id),
                                            "process_name": process_name,
                                            "container": None
                                        }
                            except (ValueError, IndexError):
                                pass
            
            # Get container names for processes
            for npu_id, proc_info in npu_processes.items():
                try:
                    pid = proc_info["process_id"]
                    cgroup_cmd = f"cat /proc/{pid}/cgroup 2>/dev/null | grep -o -E '[0-9a-f]{{64,}}' | head -n 1"
                    container_id = (await self.run_command(cgroup_cmd, check=False)).strip()
                    
                    if container_id and self.runtime:
                        name_cmd = f"{self.runtime} inspect --format '{{{{.Name}}}}' {container_id} 2>/dev/null | sed 's#^/##'"
                        container_name = (await self.run_command(name_cmd, check=False)).strip()
                        if container_name:
                            npu_processes[npu_id]["container"] = container_name
                except Exception as e:
                    logger.debug(f"Error getting container for NPU {npu_id}: {e}")
            
            # Build final NPU list
            for npu_id in sorted(npu_info.keys()):
                info = npu_info[npu_id]
                proc = npu_processes.get(npu_id, {})
                
                npus.append({
                    "id": npu_id,
                    "utilization": info.get("utilization", 0),
                    "available": info.get("health") in ["OK", "Warning"],
                    "occupied": npu_id in npu_processes,
                    "container": proc.get("container"),
                    "process_id": proc.get("process_id"),
                    "process_name": proc.get("process_name"),
                    "hbm_used": info.get("hbm_used", 0),
                    "hbm_total": info.get("hbm_total", 65536),
                    "power": info.get("power", 0),
                    "temperature": info.get("temperature", 0),
                    "health": info.get("health", "Unknown")
                })
            
            if not npus:
                return [{"id": i, "utilization": 0, "available": True, "occupied": False, "container": None, "process_id": None, "process_name": None, "hbm_used": 0, "hbm_total": 65536, "power": 0, "temperature": 0, "health": "Unknown"} for i in range(8)]
            
            return npus
            
        except Exception as e:
            logger.error(f"Error getting NPU status: {e}")
            return [{"id": i, "utilization": 0, "available": True, "occupied": False, "container": None, "process_id": None, "process_name": None, "hbm_used": 0, "hbm_total": 65536, "power": 0, "temperature": 0, "health": "Unknown"} for i in range(8)]


    async def _get_container_from_pid(self, pid: str) -> Optional[str]:
        """根据 PID 获取容器名称 (参考 query_docker 实现)"""
        try:
            # 读取进程的 cgroup 信息获取容器 ID
            cgroup_file = f"/proc/{pid}/cgroup"
            cgroup_output = await self.run_command(f"cat {cgroup_file} 2>/dev/null", check=False)
            
            if not cgroup_output:
                return None
            
            # 从 cgroup 中提取容器 ID
            # 支持两种格式:
            # 1. docker-abc123.scope (systemd cgroup v2)
            # 2. /docker/abc123... (传统格式)
            container_id = None
            
            # 尝试匹配 docker-xxx.scope 格式
            match = re.search(r'docker-([a-f0-9]+)\.scope', cgroup_output)
            if match:
                container_id = match.group(1)[:12]
            else:
                # 尝试传统格式
                for line in cgroup_output.split('\n'):
                    if '/docker/' in line:
                        parts = line.split('/docker/')
                        if len(parts) > 1:
                            container_id = parts[1].split('/')[0][:12]
                            break
            
            if not container_id:
                return None
            
            # 使用 docker inspect 获取容器名称
            cmd = f"{self.runtime} inspect --format '{{{{.Name}}}}' {container_id} 2>/dev/null"
            result = await self.run_command(cmd, check=False)
            
            if result:
                # 去除开头的 / 
                container_name = result.strip().lstrip('/')
                return container_name if container_name else None
            
            return None
        except Exception as e:
            logger.debug(f"Failed to get container from PID {pid}: {e}")
            return None

    async def get_running_vllm_services(self) -> List[Dict[str, Any]]:
        """检测所有容器中正在运行的 vLLM 服务"""
        services = []
        
        try:
            # 使用 query_docker 类似的逻辑获取 NPU 进程信息
            npu_output = await self.run_command("npu-smi info", check=False)
            
            # 解析进程行
            for line in npu_output.split('\n'):
                # 匹配进程行格式: | NPU_ID  CHIP | PID | PROCESS_NAME | MEM |
                match = re.match(r'\|\s*(\d+)\s+\d+\s*\|\s*(\d+)\s*\|\s*(\S*)\s*\|\s*(\d+)\s*\|', line)
                if match:
                    npu_id = int(match.group(1))
                    pid = match.group(2)
                    process_name = match.group(3)
                    mem = match.group(4)
                    
                    # 获取容器信息
                    container_name = await self._get_container_from_pid(pid)
                    
                    if container_name and 'VLLM' in process_name.upper():
                        # 尝试获取 vLLM 端口
                        port = await self._get_vllm_port(container_name)
                        
                        # 检查是否已存在相同容器的服务
                        existing = next((s for s in services if s['container'] == container_name), None)
                        if existing:
                            if npu_id not in existing['npu_devices']:
                                existing['npu_devices'].append(npu_id)
                            existing['memory_mb'] += int(mem) if mem else 0
                        else:
                            services.append({
                                'container': container_name,
                                'pid': pid,
                                'process_name': process_name,
                                'npu_devices': [npu_id],
                                'port': port,
                                'memory_mb': int(mem) if mem else 0
                            })
        except Exception as e:
            logger.error(f"Failed to get running vLLM services: {e}")
        
        return services
    
    async def _get_vllm_port(self, container_name: str) -> int:
        """获取容器中 vLLM 服务的端口"""
        try:
            # 方法1: 从进程命令行获取端口 (适用于 host 网络模式)
            cmd = f"{self.runtime} exec {container_name} bash -c \"ps aux | grep 'vllm serve' | grep -v grep | head -1\""
            result = await self.run_command(cmd, check=False)
            
            port_match = re.search(r'--port\s+(\d+)', result)
            if port_match:
                return int(port_match.group(1))
            
            # 方法2: 从 docker port 获取端口映射 (适用于 bridge 网络模式)
            cmd = f"{self.runtime} port {container_name}"
            result = await self.run_command(cmd, check=False)
            
            for line in result.split('\n'):
                port_match = re.search(r'(\d+)/tcp\s*->\s*0\.0\.0\.0:(\d+)', line)
                if port_match:
                    return int(port_match.group(2))
            
            # 方法3: 检查常见端口
            for port in [8000, 8001, 8002, 8003, 9000, 9001, 9002, 9003]:
                check_cmd = f"{self.runtime} exec {container_name} ss -tlnp 2>/dev/null | grep :{port}"
                result = await self.run_command(check_cmd, check=False)
                if result and str(port) in result:
                    return port
        except Exception:
            pass
        
        return 8000  # 默认端口
    
    async def kill_vllm_service(self, container_name: str, pid: str = None) -> bool:
        """停止容器中的 vLLM 服务"""
        try:
            if pid:
                cmd = f"{self.runtime} exec {container_name} kill -9 {pid}"
            else:
                cmd = f"{self.runtime} exec {container_name} pkill -9 -f vllm"
            
            await self.run_command(cmd, check=False)
            return True
        except Exception as e:
            logger.error(f"Failed to kill vLLM service: {e}")
            return False
