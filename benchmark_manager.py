"""Benchmark Manager for EvalScope and vLLM Bench"""
import asyncio
import json
import re
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class BenchmarkManager:
    """Run and manage performance benchmarks"""
    
    def __init__(self):
        self.history: List[Dict[str, Any]] = []

    async def run_evalscope(self, config, container_name: Optional[str] = None) -> Dict[str, Any]:
        # 构建 evalscope perf 命令
        cmd = f"evalscope perf --url {config.url} --model {config.model_name} --api openai -n {config.number} --parallel {config.parallel} --dataset {config.dataset} --temperature {config.temperature} --stream"
        
        result = await self._run_benchmark(cmd, container_name)
        parsed = self._parse_evalscope_output(result.get("output", ""))
        result.update(parsed)
        result["benchmark_type"] = "evalscope"
        result["timestamp"] = datetime.now().isoformat()
        self.history.append(result)
        return result

    async def run_vllm_bench(self, config, container_name: Optional[str] = None) -> Dict[str, Any]:
        cmd = f"""vllm bench serve \
            --base-url {config.url.replace('/v1/chat/completions', '')} \
            --model {config.model_name} \
            --request-rate {config.request_rate} \
            --max-concurrency {config.max_concurrency} \
            --num-prompts {config.num_prompts} \
            --random-input-len {config.random_input_len} \
            --random-output-len {config.random_output_len}"""
        
        result = await self._run_benchmark(cmd, container_name)
        parsed = self._parse_vllm_bench_output(result.get("output", ""))
        result.update(parsed)
        result["benchmark_type"] = "vllm_bench"
        result["timestamp"] = datetime.now().isoformat()
        self.history.append(result)
        return result

    async def _run_benchmark(self, cmd: str, container_name: Optional[str] = None) -> Dict[str, Any]:
        try:
            if container_name:
                full_cmd = f"docker exec {container_name} bash -c '{cmd}'"
            else:
                # 激活虚拟环境后运行命令
                venv_activate = "source /data2/scd/scd/.venv/bin/activate"
                full_cmd = f"bash -c '{venv_activate} && {cmd}'"
            
            proc = await asyncio.create_subprocess_shell(
                full_cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
            )
            stdout, _ = await proc.communicate()
            output = stdout.decode()
            
            return {"success": proc.returncode == 0, "output": output, "raw_output": output}
        except Exception as e:
            return {"success": False, "error": str(e), "output": "", "raw_output": ""}

    def _parse_evalscope_output(self, output: str) -> Dict[str, Any]:
        result = {}
        patterns = [
            (r"Throughput:\s*([\d.]+)", "throughput"),
            (r"Average Latency:\s*([\d.]+)", "avg_latency"),
            (r"P50 Latency:\s*([\d.]+)", "p50_latency"),
            (r"P95 Latency:\s*([\d.]+)", "p95_latency"),
            (r"P99 Latency:\s*([\d.]+)", "p99_latency"),
            (r"Tokens/s:\s*([\d.]+)", "tokens_per_second"),
        ]
        for pattern, key in patterns:
            match = re.search(pattern, output, re.IGNORECASE)
            if match:
                result[key] = float(match.group(1))
        return result

    def _parse_vllm_bench_output(self, output: str) -> Dict[str, Any]:
        result = {}
        patterns = [
            (r"Request throughput:\s*([\d.]+)", "throughput"),
            (r"Mean TTFT:\s*([\d.]+)", "avg_latency"),
            (r"P50 TTFT:\s*([\d.]+)", "p50_latency"),
            (r"P95 TTFT:\s*([\d.]+)", "p95_latency"),
            (r"P99 TTFT:\s*([\d.]+)", "p99_latency"),
            (r"Output token throughput:\s*([\d.]+)", "tokens_per_second"),
        ]
        for pattern, key in patterns:
            match = re.search(pattern, output, re.IGNORECASE)
            if match:
                result[key] = float(match.group(1))
        return result

    def get_history(self) -> List[Dict[str, Any]]:
        return self.history
