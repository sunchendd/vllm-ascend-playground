"""Service Manager for managing multiple vLLM services"""
import asyncio
import logging
import uuid
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field, asdict

logger = logging.getLogger(__name__)

@dataclass
class VLLMService:
    """Represents a running vLLM service"""
    id: str
    container_name: str
    model: str
    port: int
    npu_devices: List[int]
    status: str = "starting"  # starting, running, stopped, error
    start_time: str = ""
    command: str = ""
    pid: Optional[int] = None
    error_message: str = ""
    
    def to_dict(self):
        return asdict(self)


class ServiceManager:
    """Manage multiple vLLM services"""
    
    def __init__(self, container_manager):
        self.container_manager = container_manager
        self.services: Dict[str, VLLMService] = {}
    
    async def start_service(self, container_name: str, command: str, model: str, 
                           port: int, npu_devices: List[int]) -> VLLMService:
        """Start a new vLLM service"""
        service_id = str(uuid.uuid4())[:8]
        
        service = VLLMService(
            id=service_id,
            container_name=container_name,
            model=model,
            port=port,
            npu_devices=npu_devices,
            status="starting",
            start_time=datetime.now().isoformat(),
            command=command
        )
        
        self.services[service_id] = service
        
        try:
            # 在容器内执行启动命令 (后台运行)
            await self.container_manager.exec_command(container_name, command, detach=True)
            # 保持 starting 状态，等待后续检测确认运行
            service.status = "starting"
            
            # 启动后台任务检测服务状态
            asyncio.create_task(self._wait_for_service_ready(service))
            
        except Exception as e:
            service.status = "error"
            service.error_message = str(e)
            logger.error(f"Failed to start service {service_id}: {e}")
        
        return service
    
    async def stop_service(self, service_id: str) -> bool:
        """Stop a running vLLM service"""
        if service_id not in self.services:
            return False
        
        service = self.services[service_id]
        try:
            # 使用端口号精确杀进程
            kill_cmd = f"pkill -f 'vllm.*--port.*{service.port}' || kill -9 $(lsof -t -i:{service.port}) 2>/dev/null || true"
            await self.container_manager.exec_command(service.container_name, kill_cmd)
            service.status = "stopped"
            return True
        except Exception as e:
            logger.error(f"Failed to stop service {service_id}: {e}")
            service.error_message = str(e)
            return False
    
    async def remove_service(self, service_id: str) -> bool:
        """Remove a service from tracking (must be stopped first)"""
        if service_id not in self.services:
            return False
        
        service = self.services[service_id]
        if service.status == "running":
            await self.stop_service(service_id)
        
        del self.services[service_id]
        return True
    
    async def refresh_status(self) -> None:
        """Refresh status of all services"""
        for service in self.services.values():
            if service.status in ["running", "starting"]:
                await self._check_service_status(service)
    
    async def _check_service_status(self, service: VLLMService) -> None:
        """Check if a service is still running"""
        try:
            # 检查端口是否在监听
            check_cmd = f"ss -tlnp | grep ':{service.port}' || echo 'NOT_LISTENING'"
            result = await self.container_manager.exec_command(service.container_name, check_cmd)
            
            if "NOT_LISTENING" in result:
                if service.status == "running":
                    service.status = "stopped"
            else:
                service.status = "running"
                
        except Exception as e:
            logger.error(f"Failed to check service status: {e}")
    
    async def _wait_for_service_ready(self, service: VLLMService, max_wait: int = 120) -> None:
        """Wait for service to be ready (port listening) or timeout"""
        import time
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            await asyncio.sleep(5)  # 每5秒检查一次
            
            try:
                # 检查端口是否在监听
                check_cmd = f"ss -tlnp 2>/dev/null | grep ':{service.port}' || netstat -tlnp 2>/dev/null | grep ':{service.port}'"
                result = await self.container_manager.exec_command(service.container_name, check_cmd)
                
                if result and str(service.port) in result:
                    service.status = "running"
                    logger.info(f"Service {service.id} is now running on port {service.port}")
                    return
                    
            except Exception as e:
                logger.debug(f"Check failed: {e}")
        
        # 超时后检查进程是否还在
        try:
            proc_cmd = f"pgrep -f 'vllm.*--port.*{service.port}'"
            result = await self.container_manager.exec_command(service.container_name, proc_cmd)
            if not result or not result.strip():
                service.status = "error"
                service.error_message = "服务启动超时或已退出"
        except Exception:
            service.status = "error"
            service.error_message = "无法检测服务状态"
    
    async def _wait_for_service_ready(self, service: VLLMService, max_wait: int = 120) -> None:
        """Wait for service to be ready (port listening) or timeout"""
        import time
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            await asyncio.sleep(5)  # 每5秒检查一次
            
            try:
                # 检查端口是否在监听
                check_cmd = f"ss -tlnp 2>/dev/null | grep ':{service.port}' || netstat -tlnp 2>/dev/null | grep ':{service.port}'"
                result = await self.container_manager.exec_command(service.container_name, check_cmd)
                
                if result and str(service.port) in result:
                    service.status = "running"
                    logger.info(f"Service {service.id} is now running on port {service.port}")
                    return
                    
            except Exception as e:
                logger.debug(f"Check failed: {e}")
        
        # 超时后检查进程是否还在
        try:
            proc_cmd = f"pgrep -f 'vllm.*--port.*{service.port}'"
            result = await self.container_manager.exec_command(service.container_name, proc_cmd)
            if not result or not result.strip():
                service.status = "error"
                service.error_message = "服务启动超时或已退出"
        except Exception:
            service.status = "error"
            service.error_message = "无法检测服务状态"
    
    async def _update_service_pid(self, service: VLLMService) -> None:
        """Try to get the PID of the vLLM process"""
        try:
            await asyncio.sleep(2)  # 等待进程启动
            pid_cmd = f"pgrep -f 'vllm.*--port.*{service.port}' | head -1"
            result = await self.container_manager.exec_command(service.container_name, pid_cmd)
            if result and result.strip().isdigit():
                service.pid = int(result.strip())
        except Exception:
            pass
    
    def list_services(self) -> List[Dict[str, Any]]:
        """List all tracked services"""
        return [s.to_dict() for s in self.services.values()]
    
    def get_service(self, service_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific service"""
        if service_id in self.services:
            return self.services[service_id].to_dict()
        return None
    
    def get_running_count(self) -> int:
        """Get count of running services"""
        return sum(1 for s in self.services.values() if s.status == "running")
