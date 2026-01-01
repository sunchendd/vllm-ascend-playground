"""Model Manager for local and ModelScope models"""
import os
import logging
import asyncio
from pathlib import Path
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class ModelManager:
    """Manage models from local directories and ModelScope"""
    
    LOCAL_MODEL_PATHS = ["/data2/weights", "/data/weights", "/data2/modelscope-weight"]
    MODELSCOPE_CACHE = os.path.expanduser("~/.cache/modelscope/hub")

    def list_local_models(self) -> List[Dict[str, Any]]:
        models = []
        for base_path in self.LOCAL_MODEL_PATHS:
            path = Path(base_path)
            if not path.exists():
                continue
            for model_dir in path.iterdir():
                if model_dir.is_dir():
                    config_file = model_dir / "config.json"
                    if config_file.exists():
                        size = sum(f.stat().st_size for f in model_dir.rglob("*") if f.is_file())
                        models.append({
                            "name": model_dir.name,
                            "path": str(model_dir),
                            "size": size,
                            "size_human": self._human_readable_size(size),
                            "source": "local"
                        })
        return models

    def list_modelscope_cache(self) -> List[Dict[str, Any]]:
        models = []
        cache_path = Path(self.MODELSCOPE_CACHE)
        
        # ModelScope 缓存结构: ~/.cache/modelscope/hub/models/ORG/MODEL
        models_path = cache_path / "models"
        if models_path.exists():
            cache_path = models_path
        
        if not cache_path.exists():
            return models
        
        for org_dir in cache_path.iterdir():
            if org_dir.is_dir() and not org_dir.name.startswith('.'):
                for model_dir in org_dir.iterdir():
                    if model_dir.is_dir() and not model_dir.name.startswith('.'):
                        # 跳过符号链接，只处理实际目录
                        if model_dir.is_symlink():
                            continue
                        config_file = model_dir / "config.json"
                        if config_file.exists():
                            try:
                                size = sum(f.stat().st_size for f in model_dir.rglob("*") if f.is_file())
                                # 还原 ModelScope 的转义名称 (Qwen3-0___6B -> Qwen3-0.6B)
                                display_name = model_dir.name.replace('___', '.')
                                models.append({
                                    "name": f"{org_dir.name}/{display_name}",
                                    "path": str(model_dir),
                                    "size": size,
                                    "size_human": self._human_readable_size(size),
                                    "source": "modelscope"
                                })
                            except Exception:
                                pass
        return models

    async def download_model(self, model_id: str, source: str = "modelscope", cache_dir: str = None) -> str:
        """Download model from ModelScope or HuggingFace
        
        Args:
            model_id: Model ID like 'Qwen/Qwen3-0.6B'
            source: 'modelscope' or 'huggingface'
            cache_dir: Custom directory to save the model (optional)
        """
        if source == "modelscope":
            venv_python = "/data2/scd/scd/.venv/bin/python"
            if cache_dir:
                cmd = f"{venv_python} -c \"from modelscope import snapshot_download; snapshot_download('{model_id}', cache_dir='{cache_dir}')\""
            else:
                cmd = f"{venv_python} -c \"from modelscope import snapshot_download; snapshot_download('{model_id}')\""
            proc = await asyncio.create_subprocess_shell(
                cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode != 0:
                raise Exception(f"Download failed: {stderr.decode()}")
            save_path = cache_dir if cache_dir else self.MODELSCOPE_CACHE
            return f"Model {model_id} downloaded to {save_path}"
        elif source == "huggingface":
            venv_python = "/data2/scd/scd/.venv/bin/python"
            if cache_dir:
                cmd = f"{venv_python} -c \"from huggingface_hub import snapshot_download; snapshot_download('{model_id}', cache_dir='{cache_dir}')\""
            else:
                cmd = f"{venv_python} -c \"from huggingface_hub import snapshot_download; snapshot_download('{model_id}')\""
            proc = await asyncio.create_subprocess_shell(
                cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode != 0:
                raise Exception(f"Download failed: {stderr.decode()}")
            return f"Model {model_id} downloaded successfully"
        else:
            raise Exception(f"Unsupported source: {source}")

    def _human_readable_size(self, size: int) -> str:
        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} PB"
