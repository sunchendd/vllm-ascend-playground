# vLLM Ascend Playground



## 功能特性

### 🖥️ 仪表盘
- 实时查看服务状态
- NPU 利用
- 容器和模型统计

### 📦 容器管理
- 创建/启动/停止/删除 Ascend 容>
- 支持选择 NPU 设备 (0-15)
- 预置多个 vLLM-Ascend 镜像版本

### 🤖 模型管理
- 支持本地模型目录 (/data2/weights)
- 支持 ModelScope 模型下载
- 热门模型快捷下载

### ⚙️ vLLM 配置
- 可视化配置 vLLM 参
- 实时生成启动命令
- 支持自定义额外参数
- NPU 设备选择

### 📊 性能测试
- **EvalScope Perf**: 支持多种数据集的综合测试
- **vLLM Bench**: 吞吐量和延迟测试
- 预置测试模板
- 历史结果记录

### 📝 日志查看
- 实时查看 vLLM 服务日志
- 自动滚动支持

## 快速开始

### 环境要求
- Python 3.8+
- Docker
- Ascend NPU 及驱动
- ModelScope (可选)

#### 'MDEOF' 


```bash
cd /data2/scd/scd/vllm-ascend-playground

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

### 运行

```bash
# 使用启动脚本
./run.sh

# 或手动运行
python app.py
```

'MDEOF''MDEOF' http://localhost:7860

## 配置说明

### 默认模型目录
- 本地模型: `/data2/weights`
cat > /data2/scd/scd/vllm-ascend-playground/model_manager.py << 'EOF': `~/.cache/modelscope/hub`

### 支持的镜像
- `quay.io/ascend/vllm-ascend:v0.13.0rc1`
- `quay.io/ascend/vllm-ascend:v0.12.0`
- `quay.io/ascend/vllm-ascend:latest`

### NPU 设备
 16 个 NPU 设备 (/dev/davinci0 - /dev/davinci15)

## API 接口

### 状态
- `GET /api/status` - 获取服务状态

### 容器
- `GET /api/containers` - 列出容器
- `POST /api/containers/create` - 创建容器
- `POST /api/containers/{name}/start` - 启动容器
- `POST /api/containers/{name}/stop` - 停止容器
- `DELETE /api/containers/{name}` - 删除容器

### 模型
- `GET /api/models` - 列出模型
- `POST /api/models/download` - 下载模型

### vLLM
- `POST /api/vllm/start` - 启动 vLLM
- `POST /api/vllm/stop` - 停止 vLLM
- `GET /api/vllm/logs` - 获取日志

### 性能测试
- `POST /api/benchmark/run` - 运行测
- `GET /api/benchmark/results` - 获取历史结果

## 项目结构

```
vllm-ascend-playground/
 app.py                  # FastAPI 主应用
 container_manager.py    # 容器管理模块
 model_manager.py        # 模型管理模块
 benchmark_manager.py    # 性能测试模块
 requirements.txt        # Python 依赖
 run.sh                  # 启动脚本
 config/
   └── presets.json       # 预MDEOF'MDEOF'
 scripts/
   ├── create_container.sh
 start_vllm.sh   ├
   ├── run_evalscope.sh
   └── run_vllm_bench.sh
 static/
   ├── css/
   │   └── style.css
   └── js/
       └── app.js
 templates/
    └── index.html
```

## 许可证

MIT License
