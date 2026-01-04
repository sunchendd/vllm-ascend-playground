const API_BASE = '';
let currentModelSource = 'local';
let selectedNpuDevices = [0];
let npuChart = null;
let allServices = [];

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initForms();
    initNpuSelector();
    loadInitialData();
    startStatusPolling();
});

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(item.dataset.tab);
        });
    });
}

function switchTab(tabId) {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.tab === tabId));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.toggle('active', content.id === tabId));
    if (tabId === 'dashboard') { refreshServices(); refreshStatus(); }
    if (tabId === 'containers') refreshContainers();
    if (tabId === 'models') refreshModels();
    if (tabId === 'benchmark') { loadBenchmarkHistory(); loadBenchmarkTemplates(); }
}

function initForms() {
    document.getElementById('vllm-config-form').addEventListener('submit', startVllm);
    document.getElementById('model-source-type').addEventListener('change', (e) => {
        document.getElementById('local-model-group').style.display = e.target.value === 'local' ? 'block' : 'none';
        document.getElementById('modelscope-model-group').style.display = e.target.value === 'modelscope' ? 'block' : 'none';
        updateGeneratedCommand();
    });
    document.querySelectorAll('#vllm-config-form input, #vllm-config-form select').forEach(input => {
        input.addEventListener('change', updateGeneratedCommand);
        input.addEventListener('input', updateGeneratedCommand);
    });
    document.getElementById('benchmark-form').addEventListener('submit', runBenchmark);
    document.getElementById('benchmark-type').addEventListener('change', (e) => {
        document.querySelector('.evalscope-params').style.display = e.target.value === 'evalscope' ? 'contents' : 'none';
        document.querySelector('.vllm-bench-params').style.display = e.target.value === 'vllm_bench' ? 'contents' : 'none';
    });
    document.getElementById('create-container-form').addEventListener('submit', createContainer);
    // Note: download-model form uses inline onsubmit handler in HTML
    document.querySelectorAll('.model-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.model-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentModelSource = tab.dataset.source;
            refreshModels();
        });
    });
    
    // Event delegation for container action buttons
    document.getElementById('containers-table').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;
        
        const action = button.dataset.action;
        const containerName = button.dataset.containerName;
        
        if (action === 'start') {
            startContainer(containerName);
        } else if (action === 'stop') {
            stopContainer(containerName);
        } else if (action === 'delete') {
            deleteContainer(containerName);
        }
    });
    
    // Event delegation for model action buttons
    document.getElementById('models-list').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;
        
        const action = button.dataset.action;
        const modelPath = button.dataset.modelPath;
        const sourceType = button.dataset.sourceType;
        
        if (action === 'use') {
            useModel(modelPath, sourceType);
        } else if (action === 'download') {
            downloadModelById(modelPath);
        }
    });
    
    // Event delegation for benchmark history buttons
    document.getElementById('benchmark-history').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;
        
        if (button.dataset.action === 'view') {
            try {
                const result = JSON.parse(button.dataset.result);
                displayBenchmarkResults(result);
            } catch (error) {
                console.error('Failed to parse benchmark result:', error);
            }
        }
    });
    
    // Event delegation for service action buttons
    document.getElementById('services-list').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;
        
        if (button.dataset.action === 'kill') {
            killVllmService(button.dataset.containerName, button.dataset.pid);
        }
    });
}

function initNpuSelector() {
    const npuSelector = document.getElementById('npu-selector');
    const modalNpuSelector = document.getElementById('modal-npu-selector');
    for (let i = 0; i < 16; i++) {
        const div = document.createElement('div');
        div.className = 'npu-checkbox' + (i === 0 ? ' selected' : '');
        div.innerHTML = '<input type="checkbox" value="' + i + '" ' + (i === 0 ? 'checked' : '') + '> NPU ' + i;
        div.addEventListener('click', () => toggleNpu(i, div));
        npuSelector.appendChild(div);
        const label = document.createElement('label');
        label.innerHTML = '<input type="checkbox" name="modal-npu" value="' + i + '" ' + (i < 8 ? 'checked' : '') + '> NPU ' + i;
        modalNpuSelector.appendChild(label);
    }
}

function toggleNpu(id, element) {
    const index = selectedNpuDevices.indexOf(id);
    if (index === -1) { selectedNpuDevices.push(id); element.classList.add('selected'); }
    else { selectedNpuDevices.splice(index, 1); element.classList.remove('selected'); }
    selectedNpuDevices.sort((a, b) => a - b);
    updateGeneratedCommand();
}

async function fetchApi(endpoint, options = {}) {
    try {
        const response = await fetch(API_BASE + endpoint, { headers: { 'Content-Type': 'application/json', ...options.headers }, ...options });
        if (!response.ok) { const error = await response.json(); throw new Error(error.detail || 'Request failed'); }
        return await response.json();
    } catch (error) { showToast(error.message, 'error'); throw error; }
}

async function loadInitialData() {
    console.log('=== loadInitialData started ===');
    try {
        console.log('1. Calling refreshServices...');
        await refreshServices();
        console.log('2. Calling refreshStatus...');
        await refreshStatus();
        console.log('3. Calling refreshContainers...');
        await refreshContainers();
        console.log('4. Calling refreshModels...');
        await refreshModels();
        console.log('5. Calling initNpuChart...');
        initNpuChart();
        console.log('=== loadInitialData completed ===');
    } catch (error) {
        console.error('loadInitialData error:', error);
    }
}

async function refreshStatus() {
    try {
        console.log('Refreshing status...');
        const status = await fetchApi('/api/status');
        console.log('Status received:', status ? 'OK' : 'null');
        
        const statusDot = document.getElementById('service-status');
        const statusText = document.getElementById('status-text');
        
        // 更新服务状态
        const runningCount = allServices.length;
        if (runningCount > 0) {
            if (statusDot) statusDot.classList.add('online');
            if (statusText) statusText.textContent = `${runningCount} 个服务运行中`;
            const vllmStatus = document.getElementById('vllm-status');
            if (vllmStatus) vllmStatus.textContent = `${runningCount} 个运行中`;
        } else {
            if (statusDot) statusDot.classList.remove('online');
            if (statusText) statusText.textContent = 'vLLM 未运行';
            const vllmStatus = document.getElementById('vllm-status');
            if (vllmStatus) vllmStatus.textContent = '未启动';
        }
        
        // 更新容器数量
        const containerCount = document.getElementById('container-count');
        if (containerCount && status.containers) {
            const runningContainers = status.containers.filter(c => c.running).length;
            containerCount.textContent = runningContainers;
            console.log('Running containers:', runningContainers);
        }
        
        // 更新 NPU 状态
        if (status.npu_status && status.npu_status.length > 0) {
            const npuCount = document.getElementById('npu-count');
            if (npuCount) npuCount.textContent = status.npu_status.length + ' NPU';
            console.log('NPU count:', status.npu_status.length);
            updateNpuChart(status.npu_status);
        }
    } catch (error) {
        console.error('Failed to refresh status:', error);
    }
}

function startStatusPolling() { setInterval(refreshStatus, 5000); }

let allContainers = []; // 存储所有容器数据

async function refreshContainers() {
    try {
        const data = await fetchApi('/api/containers');
        allContainers = data.containers || [];
        renderContainers();

    } catch (error) { console.error('Failed to refresh containers:', error); }
}

async function startContainer(name) { 
    try { 
        showToast('正在启动容器 ' + name + '...', 'info');
        await fetchApi('/api/containers/' + name + '/start', { method: 'POST' }); 
        showToast('容器已启动: ' + name, 'success'); 
        refreshContainers(); 
    } catch (error) { 
        showToast('启动容器失败: ' + error.message, 'error');
        console.error(error); 
    } 
}
async function stopContainer(name) { 
    try { 
        showToast('正在停止容器 ' + name + '...', 'info');
        await fetchApi('/api/containers/' + name + '/stop', { method: 'POST' }); 
        showToast('容器已停止: ' + name, 'success'); 
        refreshContainers(); 
    } catch (error) { 
        showToast('停止容器失败: ' + error.message, 'error');
        console.error(error); 
    } 
}
async function deleteContainer(name) { 
    if (!confirm('确定要删除容器 ' + name + ' 吗？')) return; 
    try { 
        showToast('正在删除容器...', 'info');
        await fetchApi('/api/containers/' + name, { method: 'DELETE' }); 
        showToast('容器已删除: ' + name, 'success'); 
        refreshContainers(); 
    } catch (error) { 
        showToast('删除容器失败: ' + error.message, 'error');
        console.error(error); 
    } 
}

async function createContainer(e) {
    e.preventDefault();
    const name = document.getElementById('new-container-name').value;
    const image = document.getElementById('new-container-image').value;
    const shmSize = document.getElementById('new-container-shm').value;
    const npuDevices = []; document.querySelectorAll('input[name="modal-npu"]:checked').forEach(input => npuDevices.push(parseInt(input.value)));
    try {
        await fetchApi('/api/containers/create', { method: 'POST', body: JSON.stringify({ container_name: name, image: image, npu_devices: npuDevices, shm_size: shmSize }) });
        showToast('Container created', 'success'); closeModal('create-container-modal'); refreshContainers();
    } catch (error) { console.error(error); }
}

let allModels = { local: [], modelscope: [], popular: [] };


async function refreshModels() {
    try {
        const data = await fetchApi('/api/models');
        allModels.local = data.local_models || [];
        allModels.modelscope = data.modelscope_models || [];
        allModels.popular = getPopularModels();
        renderModels();
        renderModels();
        renderModels();
    } catch (error) { console.error('Failed to refresh models:', error); }
}

function filterModels() {
    renderModels();
}

function renderModels() {
    const keyword = (document.getElementById('model-filter')?.value || '').toLowerCase();
    const container = document.getElementById('models-list');
    container.innerHTML = '';
    
    let models = currentModelSource === 'local' ? allModels.local : 
                 currentModelSource === 'modelscope' ? allModels.modelscope : allModels.popular;
    
    // 过滤
    if (keyword) {
        models = models.filter(m => 
            m.name.toLowerCase().includes(keyword) || 
            (m.path && m.path.toLowerCase().includes(keyword)) ||
            (m.id && m.id.toLowerCase().includes(keyword))
        );
    }
    
    if (models.length === 0) { 
        container.innerHTML = '<p class="placeholder">未找到模型</p>'; 
        return; 
    }
    
    models.forEach(model => {
        const card = document.createElement('div'); 
        card.className = 'model-card';
        
        const title = document.createElement('h4');
        title.textContent = model.name;
        card.appendChild(title);
        
        const metaDiv = document.createElement('div');
        metaDiv.className = 'model-meta';
        
        if (currentModelSource === 'popular') {
            const idDiv = document.createElement('div');
            idDiv.textContent = 'ID: ' + model.id;
            metaDiv.appendChild(idDiv);
            
            const sizeDiv = document.createElement('div');
            sizeDiv.textContent = '参数量: ' + model.size;
            metaDiv.appendChild(sizeDiv);
        } else {
            const pathDiv = document.createElement('div');
            pathDiv.textContent = '路径: ' + model.path;
            metaDiv.appendChild(pathDiv);
            
            const sizeDiv = document.createElement('div');
            sizeDiv.textContent = '大小: ' + model.size_human;
            metaDiv.appendChild(sizeDiv);
        }
        
        card.appendChild(metaDiv);
        
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'model-actions';
        
        if (currentModelSource === 'popular') {
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'btn btn-sm btn-primary';
            downloadBtn.textContent = '下载';
            downloadBtn.dataset.action = 'download';
            downloadBtn.dataset.modelPath = model.id;
            actionsDiv.appendChild(downloadBtn);
            
            const useBtn = document.createElement('button');
            useBtn.className = 'btn btn-sm btn-secondary';
            useBtn.textContent = '使用';
            useBtn.dataset.action = 'use';
            useBtn.dataset.modelPath = model.id;
            useBtn.dataset.sourceType = 'modelscope';
            actionsDiv.appendChild(useBtn);
        } else {
            const useBtn = document.createElement('button');
            useBtn.className = 'btn btn-sm btn-primary';
            useBtn.textContent = '使用';
            useBtn.dataset.action = 'use';
            useBtn.dataset.modelPath = model.path;
            useBtn.dataset.sourceType = 'local';
            actionsDiv.appendChild(useBtn);
        }
        
        card.appendChild(actionsDiv);
        container.appendChild(card);
    });
}

function getPopularModels() { return [{id:'Qwen/Qwen3-0.6B',name:'Qwen3-0.6B',size:'0.6B'},{id:'Qwen/Qwen3-4B',name:'Qwen3-4B',size:'4B'},{id:'Qwen/Qwen3-8B',name:'Qwen3-8B',size:'8B'},{id:'Qwen/Qwen3-32B',name:'Qwen3-32B',size:'32B'}]; }

function useModel(modelPath, sourceType) {
    document.getElementById('model-source-type').value = sourceType;
    if (sourceType === 'local') { document.getElementById('local-model-path').value = modelPath; document.getElementById('local-model-group').style.display = 'block'; document.getElementById('modelscope-model-group').style.display = 'none'; }
    else { document.getElementById('modelscope-model-id').value = modelPath; document.getElementById('local-model-group').style.display = 'none'; document.getElementById('modelscope-model-group').style.display = 'block'; }
    updateGeneratedCommand(); switchTab('vllm');
}

async function downloadModelById(modelId) { showToast('Downloading: ' + modelId, 'success'); try { await fetchApi('/api/models/download', { method: 'POST', body: JSON.stringify({ model_id: modelId, source: 'modelscope' }) }); showToast('Download complete', 'success'); refreshModels(); } catch (error) { console.error(error); } }
async function downloadModel(e) { 
    e.preventDefault(); 
    const modelId = document.getElementById('download-model-id').value;
    const source = document.getElementById('download-source').value;
    const cacheDir = document.getElementById('download-cache-dir')?.value || '';
    closeModal('download-model-modal'); 
    
    showToast('正在下载: ' + modelId, 'success');
    try {
        let url = '/api/models/download?model_id=' + encodeURIComponent(modelId) + '&source=' + source;
        if (cacheDir) {
            url += '&cache_dir=' + encodeURIComponent(cacheDir);
        }
        const result = await fetchApi(url, { method: 'POST' });
        showToast(result.message || '下载完成', 'success');
        refreshModels();
    } catch (error) {
        console.error(error);
    }
}

async function startVllm(e) {
    e.preventDefault();
    const containerName = document.getElementById('vllm-container').value;
    if (!containerName) { showToast('请选择一个容器', 'error'); return; }
    const sourceType = document.getElementById('model-source-type').value;
    const modelPath = sourceType === 'local' ? document.getElementById('local-model-path').value : document.getElementById('modelscope-model-id').value;
    if (!modelPath) { showToast('请选择或输入模型', 'error'); return; }
    
    const config = { 
        model_source: { 
            source_type: sourceType, 
            model_id: sourceType === 'modelscope' ? modelPath : null, 
            local_path: sourceType === 'local' ? modelPath : null 
        }, 
        served_model_name: document.getElementById('served-model-name').value, 
        host: '0.0.0.0', 
        port: parseInt(document.getElementById('vllm-port').value), 
        tensor_parallel_size: parseInt(document.getElementById('tensor-parallel-size').value), 
        max_model_len: document.getElementById('max-model-len').value ? parseInt(document.getElementById('max-model-len').value) : null, 
        dtype: document.getElementById('dtype').value, 
        trust_remote_code: document.getElementById('trust-remote-code').checked, 
        npu_devices: selectedNpuDevices, 
        additional_args: document.getElementById('additional-args').value || null 
    };
    
    showToast('正在启动 vLLM 服务...', 'info');
    
    try { 
        const result = await fetchApi('/api/vllm/start?container_name=' + containerName, { method: 'POST', body: JSON.stringify(config) }); 
        if (result.service_id) {
            showToast(`服务启动成功! ID: ${result.service_id}`, 'success');
        } else {
            showToast('服务启动中...', 'success');
        }
        // 刷新服务列表
        await refreshServices();
        refreshStatus(); 
    } catch (error) { 
        showToast('启动失败: ' + error.message, 'error');
        console.error(error); 
    }
}

async function stopVllm() { 
    if (allServices.length === 0) {
        showToast('没有运行中的服务', 'info');
        return;
    }
    if (!confirm('确定要停止所有 vLLM 服务吗？')) return;
    
    try { 
        await fetchApi('/api/vllm/stop', { method: 'POST' }); 
        showToast('所有服务已停止', 'success'); 
        await refreshServices();
        refreshStatus(); 
    } catch (error) { 
        showToast('停止失败: ' + error.message, 'error');
        console.error(error); 
    } 
}

function updateGeneratedCommand() {
    const sourceType = document.getElementById('model-source-type').value;
    const modelPath = sourceType === 'local' ? document.getElementById('local-model-path').value : document.getElementById('modelscope-model-id').value;
    let cmd = [];
    if (selectedNpuDevices.length > 0) cmd.push('export ASCEND_RT_VISIBLE_DEVICES=' + selectedNpuDevices.join(','));
    if (sourceType === 'modelscope') cmd.push('export VLLM_USE_MODELSCOPE="True"');
    let vllmCmd = 'vllm serve ' + (modelPath || '<model_path>');
    vllmCmd += ' \\\n  --served-model-name ' + (document.getElementById('served-model-name').value || 'default-model');
    vllmCmd += ' \\\n  --host 0.0.0.0';
    vllmCmd += ' \\\n  --port ' + (document.getElementById('vllm-port').value || 8000);
    vllmCmd += ' \\\n  --tensor-parallel-size ' + (document.getElementById('tensor-parallel-size').value || 1);
    if (document.getElementById('max-model-len').value) vllmCmd += ' \\\n  --max-model-len ' + document.getElementById('max-model-len').value;
    if (document.getElementById('trust-remote-code').checked) vllmCmd += ' \\\n  --trust-remote-code';
    const dtype = document.getElementById('dtype').value; if (dtype && dtype !== 'auto') vllmCmd += ' \\\n  --dtype ' + dtype;
    const additionalArgs = document.getElementById('additional-args').value; if (additionalArgs) vllmCmd += ' \\\n  ' + additionalArgs;
    cmd.push(vllmCmd);
    document.getElementById('generated-command').textContent = cmd.join('\n\n');
}

async function runBenchmark(e) {
    e.preventDefault();
    const benchmarkType = document.getElementById('benchmark-type').value;
    const config = { benchmark_type: benchmarkType, url: document.getElementById('benchmark-url').value, model_name: document.getElementById('benchmark-model-name').value };
    if (benchmarkType === 'evalscope') { config.parallel = parseInt(document.getElementById('eval-parallel').value); config.number = parseInt(document.getElementById('eval-number').value); config.dataset = document.getElementById('eval-dataset').value; config.temperature = parseFloat(document.getElementById('eval-temperature')?.value || 0); }
    else { config.request_rate = parseFloat(document.getElementById('bench-request-rate').value); config.max_concurrency = parseInt(document.getElementById('bench-max-concurrency').value); config.num_prompts = parseInt(document.getElementById('bench-num-prompts').value); config.random_input_len = parseInt(document.getElementById('bench-input-len').value); config.random_output_len = parseInt(document.getElementById('bench-output-len').value); }
    showToast('Running benchmark...', 'success');
    try { const result = await fetchApi('/api/benchmark/run', { method: 'POST', body: JSON.stringify(config) }); displayBenchmarkResults(result); loadBenchmarkHistory(); } catch (error) { console.error(error); }
}

function displayBenchmarkResults(result) {
    const container = document.getElementById('benchmark-results');
    if (result.error) { container.innerHTML = '<p class="placeholder" style="color: var(--danger-color);">Failed: ' + result.error + '</p>'; return; }
    container.innerHTML = '<div class="stats-grid"><div class="stat-card"><div class="stat-info"><h3>Throughput</h3><div>' + (result.throughput ? result.throughput.toFixed(2) : 'N/A') + ' req/s</div></div></div><div class="stat-card"><div class="stat-info"><h3>Avg Latency</h3><div>' + (result.avg_latency ? result.avg_latency.toFixed(2) : 'N/A') + ' ms</div></div></div><div class="stat-card"><div class="stat-info"><h3>P95 Latency</h3><div>' + (result.p95_latency ? result.p95_latency.toFixed(2) : 'N/A') + ' ms</div></div></div><div class="stat-card"><div class="stat-info"><h3>P99 Latency</h3><div>' + (result.p99_latency ? result.p99_latency.toFixed(2) : 'N/A') + ' ms</div></div></div></div>';
    if (result.raw_output) container.innerHTML += '<details style="margin-top:16px;"><summary style="cursor:pointer;color:var(--text-secondary);">Raw Output</summary><pre class="command-preview" style="margin-top:8px;">' + result.raw_output + '</pre></details>';
}

async function loadBenchmarkHistory() {
    try {
        const data = await fetchApi('/api/benchmark/results');
        const tbody = document.getElementById('benchmark-history');
        document.getElementById('benchmark-count').textContent = (data || []).length;
        tbody.innerHTML = '';
        if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="placeholder">No records</td></tr>'; return; }
        data.slice().reverse().forEach(result => {
            const tr = document.createElement('tr');
            
            const timeCell = document.createElement('td');
            timeCell.textContent = new Date(result.timestamp).toLocaleString();
            tr.appendChild(timeCell);
            
            const typeCell = document.createElement('td');
            typeCell.textContent = result.benchmark_type;
            tr.appendChild(typeCell);
            
            const throughputCell = document.createElement('td');
            throughputCell.textContent = result.throughput ? result.throughput.toFixed(2) : 'N/A';
            tr.appendChild(throughputCell);
            
            const avgLatencyCell = document.createElement('td');
            avgLatencyCell.textContent = result.avg_latency ? result.avg_latency.toFixed(2) : 'N/A';
            tr.appendChild(avgLatencyCell);
            
            const p99LatencyCell = document.createElement('td');
            p99LatencyCell.textContent = result.p99_latency ? result.p99_latency.toFixed(2) : 'N/A';
            tr.appendChild(p99LatencyCell);
            
            const actionCell = document.createElement('td');
            const viewBtn = document.createElement('button');
            viewBtn.className = 'btn btn-secondary';
            viewBtn.textContent = 'View';
            viewBtn.dataset.action = 'view';
            viewBtn.dataset.result = JSON.stringify(result);
            actionCell.appendChild(viewBtn);
            tr.appendChild(actionCell);
            
            tbody.appendChild(tr);
        });
    } catch (error) { console.error('Failed to load benchmark history:', error); }
}

function loadBenchmarkTemplates() {
    const templates = [{name:'Quick Test',desc:'Fast validation',type:'evalscope',parallel:1,number:5},{name:'Standard Test',desc:'Standard benchmark',type:'evalscope',parallel:4,number:50},{name:'Stress Test',desc:'High concurrency',type:'evalscope',parallel:16,number:100},{name:'Long Text',desc:'Long context test',type:'vllm_bench',inputLen:4096,outputLen:2048},{name:'Throughput',desc:'Max throughput',type:'vllm_bench',rate:100,concurrency:64}];
    const container = document.getElementById('benchmark-templates'); container.innerHTML = '';
    templates.forEach(tpl => { const card = document.createElement('div'); card.className = 'template-card'; card.innerHTML = '<h4>' + tpl.name + '</h4><p>' + tpl.desc + '</p>'; card.onclick = () => applyTemplate(tpl); container.appendChild(card); });
}

function applyTemplate(template) {
    document.getElementById('benchmark-type').value = template.type;
    if (template.type === 'evalscope') { document.querySelector('.evalscope-params').style.display = 'contents'; document.querySelector('.vllm-bench-params').style.display = 'none'; if (template.parallel) document.getElementById('eval-parallel').value = template.parallel; if (template.number) document.getElementById('eval-number').value = template.number; }
    else { document.querySelector('.evalscope-params').style.display = 'none'; document.querySelector('.vllm-bench-params').style.display = 'contents'; if (template.rate) document.getElementById('bench-request-rate').value = template.rate; if (template.concurrency) document.getElementById('bench-max-concurrency').value = template.concurrency; if (template.inputLen) document.getElementById('bench-input-len').value = template.inputLen; if (template.outputLen) document.getElementById('bench-output-len').value = template.outputLen; }
    showToast('Template applied: ' + template.name, 'success');
}

async function refreshLogs() {
    const source = document.getElementById('log-source')?.value || 'playground';
    const logContainer = document.getElementById('log-container');
    
    try {
        let url = '/api/logs/playground';
        
        if (source === 'container') {
            const containerName = document.getElementById('log-container-select')?.value;
            if (!containerName) {
                logContainer.textContent = '请选择一个容器';
                return;
            }
            url = `/api/logs/container/${containerName}?lines=200`;
        } else if (source === 'system') {
            url = '/api/logs/system?lines=100';
        }
        
        const data = await fetchApi(url);
        logContainer.textContent = data.logs || '暂无日志';
        
        if (document.getElementById('auto-scroll')?.checked) {
            logContainer.scrollTop = logContainer.scrollHeight;
        }
    } catch (error) {
        logContainer.textContent = '获取日志失败: ' + error.message;
    }
}

function onLogSourceChange() {
    const source = document.getElementById('log-source')?.value;
    const containerSelect = document.getElementById('log-container-select');
    
    if (source === 'container') {
        containerSelect.style.display = 'inline-block';
        // 填充容器列表
        containerSelect.innerHTML = '<option value="">选择容器...</option>';
        allContainers.filter(c => c.status === 'running').forEach(c => {
            const option = document.createElement('option');
            option.value = c.name;
            option.textContent = c.name;
            containerSelect.appendChild(option);
        });
    } else {
        containerSelect.style.display = 'none';
    }
    
    refreshLogs();
}

// 绑定日志来源切换事件
document.addEventListener('DOMContentLoaded', () => {
    const logSource = document.getElementById('log-source');
    if (logSource) {
        logSource.addEventListener('change', onLogSourceChange);
    }
});
function clearLogDisplay() { document.getElementById('log-container').textContent = ''; }

function initNpuChart() {
    // NPU chart replaced with status grid
    updateNpuStatusGrid([]);
}

function updateNpuStatusGrid(npuData) {
    const container = document.getElementById('npu-status-grid');
    if (!container) return;
    
    if (!npuData || npuData.length === 0) {
        container.innerHTML = '<p class="placeholder">检测 NPU 状态中...</p>';
        return;
    }
    
    container.innerHTML = '';
    npuData.forEach(npu => {
        const div = document.createElement('div');
        div.className = 'npu-status-item ' + (npu.occupied ? 'occupied' : 'free');
        
        let content = '<div class="npu-id">NPU ' + npu.id + '</div>';
        if (npu.occupied) {
            content += '<div class="npu-state">已占用</div>';
            content += '<div class="npu-container">' + (npu.container || '未知容器') + '</div>';
        } else {
            content += '<div class="npu-state">空闲</div>';
        }
        div.innerHTML = content;
        container.appendChild(div);
    });
}

function updateNpuChart(npuData) { updateNpuStatusGrid(npuData); }

function showCreateContainerModal() { document.getElementById('create-container-modal').classList.add('show'); }
function showDownloadModelModal() { document.getElementById('download-model-modal').classList.add('show'); }
function closeModal(modalId) { document.getElementById(modalId).classList.remove('show'); }
document.querySelectorAll('.modal').forEach(modal => { modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); }); });

function showToast(message, type = 'success') { const container = document.getElementById('toast-container'); const toast = document.createElement('div'); toast.className = 'toast ' + type; toast.textContent = message; container.appendChild(toast); setTimeout(() => toast.remove(), 3000); }

function filterContainers() {
    renderContainers();
}

function renderContainers() {
    const keyword = (document.getElementById('container-filter')?.value || '').toLowerCase();
    const runningOnly = document.getElementById('show-running-only')?.checked || false;
    
    // 前端过滤
    let filtered = allContainers;
    if (keyword) {
        filtered = filtered.filter(c => 
            c.name.toLowerCase().includes(keyword) || 
            c.image.toLowerCase().includes(keyword) ||
            c.id.toLowerCase().includes(keyword)
        );
    }
    if (runningOnly) {
        filtered = filtered.filter(c => c.running);
    }
    
    const tbody = document.getElementById('containers-table');
    const select = document.getElementById('vllm-container');
    tbody.innerHTML = '';
    select.innerHTML = '<option value="">选择容器</option>';
    
    filtered.forEach(container => {
        const tr = document.createElement('tr');
        
        // Create cells
        const nameCell = document.createElement('td');
        nameCell.textContent = container.name;
        
        const imageCell = document.createElement('td');
        imageCell.className = 'image-cell';
        imageCell.title = container.image;
        imageCell.textContent = container.image;
        
        const statusCell = document.createElement('td');
        const statusTag = document.createElement('span');
        statusTag.className = 'status-tag ' + (container.running ? 'running' : 'stopped');
        statusTag.textContent = container.running ? '运行中' : '已停止';
        statusCell.appendChild(statusTag);
        
        const createdCell = document.createElement('td');
        createdCell.textContent = container.created;
        
        const actionsCell = document.createElement('td');
        
        // Create start/stop button
        if (container.running) {
            const stopBtn = document.createElement('button');
            stopBtn.className = 'btn btn-sm btn-secondary';
            stopBtn.textContent = '停止';
            stopBtn.dataset.containerName = container.name;
            stopBtn.dataset.action = 'stop';
            actionsCell.appendChild(stopBtn);
        } else {
            const startBtn = document.createElement('button');
            startBtn.className = 'btn btn-sm btn-primary';
            startBtn.textContent = '启动';
            startBtn.dataset.containerName = container.name;
            startBtn.dataset.action = 'start';
            actionsCell.appendChild(startBtn);
        }
        
        actionsCell.appendChild(document.createTextNode(' '));
        
        // Create delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-sm btn-danger';
        deleteBtn.textContent = '删除';
        deleteBtn.dataset.containerName = container.name;
        deleteBtn.dataset.action = 'delete';
        actionsCell.appendChild(deleteBtn);
        
        tr.appendChild(nameCell);
        tr.appendChild(imageCell);
        tr.appendChild(statusCell);
        tr.appendChild(createdCell);
        tr.appendChild(actionsCell);
        tbody.appendChild(tr);
        
        if (container.running) {
            const option = document.createElement('option');
            option.value = container.name;
            option.textContent = container.name;
            select.appendChild(option);
        }
    });
    
    // 显示过滤结果数量
    const countSpan = document.getElementById('container-count-display');
    if (countSpan) {
        countSpan.textContent = '显示 ' + filtered.length + ' / ' + allContainers.length + ' 个容器';
    }
}


// ==================== 服务管理 ====================

async function refreshServices() {
    try {
        const result = await fetchApi('/api/vllm/running');
        allServices = result.services || [];
        renderServices();
        
        // 更新仪表盘状态
        const runningCount = result.count || 0;
        const statusEl = document.getElementById('vllm-status');
        if (statusEl) {
            statusEl.textContent = runningCount > 0 ? `${runningCount} 个运行中` : '未启动';
            statusEl.style.color = runningCount > 0 ? 'var(--success)' : 'var(--text-secondary)';
        }
        
        const countEl = document.getElementById('running-service-count');
        if (countEl) countEl.textContent = runningCount;
        
    } catch (error) {
        console.error('Failed to refresh services:', error);
    }
}

function renderServices() {
    const container = document.getElementById('services-list');
    if (!container) return;
    
    if (allServices.length === 0) {
        container.innerHTML = '<p class="placeholder">暂无运行中的 vLLM 服务</p>';
        return;
    }
    
    container.innerHTML = '';
    
    allServices.forEach(service => {
        const npuDevices = service.npu_devices ? service.npu_devices.join(', ') : '';
        const memoryMB = service.memory_mb ? (service.memory_mb / 1024).toFixed(1) + ' GB' : 'N/A';
        
        const serviceDiv = document.createElement('div');
        serviceDiv.className = 'service-item';
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'service-info';
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'service-header';
        
        const idSpan = document.createElement('span');
        idSpan.className = 'service-id';
        idSpan.textContent = '🟢 ' + service.container;
        headerDiv.appendChild(idSpan);
        
        const badge = document.createElement('span');
        badge.className = 'badge badge-success';
        badge.textContent = '运行中';
        headerDiv.appendChild(badge);
        
        infoDiv.appendChild(headerDiv);
        
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'service-details';
        
        const processDiv = document.createElement('div');
        const processLabel = document.createElement('strong');
        processLabel.textContent = '进程:';
        processDiv.appendChild(processLabel);
        processDiv.appendChild(document.createTextNode(' ' + (service.process_name || 'vLLM')));
        detailsDiv.appendChild(processDiv);
        
        const portDiv = document.createElement('div');
        const portLabel = document.createElement('strong');
        portLabel.textContent = '端口:';
        portDiv.appendChild(portLabel);
        portDiv.appendChild(document.createTextNode(' ' + service.port));
        detailsDiv.appendChild(portDiv);
        
        const pidDiv = document.createElement('div');
        const pidLabel = document.createElement('strong');
        pidLabel.textContent = 'PID:';
        pidDiv.appendChild(pidLabel);
        pidDiv.appendChild(document.createTextNode(' ' + service.pid));
        detailsDiv.appendChild(pidDiv);
        
        const npuDiv = document.createElement('div');
        const npuLabel = document.createElement('strong');
        npuLabel.textContent = 'NPU:';
        npuDiv.appendChild(npuLabel);
        npuDiv.appendChild(document.createTextNode(' ' + npuDevices));
        detailsDiv.appendChild(npuDiv);
        
        const memDiv = document.createElement('div');
        const memLabel = document.createElement('strong');
        memLabel.textContent = '显存:';
        memDiv.appendChild(memLabel);
        memDiv.appendChild(document.createTextNode(' ' + memoryMB));
        detailsDiv.appendChild(memDiv);
        
        infoDiv.appendChild(detailsDiv);
        serviceDiv.appendChild(infoDiv);
        
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'service-actions';
        
        const stopBtn = document.createElement('button');
        stopBtn.className = 'btn btn-danger btn-sm';
        stopBtn.textContent = '⏹ 停止';
        stopBtn.dataset.action = 'kill';
        stopBtn.dataset.containerName = service.container;
        stopBtn.dataset.pid = service.pid;
        actionsDiv.appendChild(stopBtn);
        
        serviceDiv.appendChild(actionsDiv);
        container.appendChild(serviceDiv);
    });
}

async function killVllmService(containerName, pid) {
    if (!confirm(`确定要停止容器 ${containerName} 中的 vLLM 服务吗？`)) return;
    
    try {
        showToast('正在停止服务...', 'info');
        await fetchApi(`/api/vllm/kill?container_name=${containerName}&pid=${pid}`, { method: 'POST' });
        showToast('服务已停止', 'success');
        setTimeout(refreshServices, 2000);  // 等待进程退出后刷新
    } catch (error) {
        showToast('停止服务失败: ' + error.message, 'error');
    }
}



// 定期刷新服务状态
setInterval(refreshServices, 10000);


// ==================== AI 对话 ====================
let chatHistory = [];

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;
    
    input.value = '';
    
    // 添加用户消息到界面
    appendChatMessage('user', message);
    chatHistory.push({ role: 'user', content: message });
    
    const url = document.getElementById('chat-url').value;
    const model = document.getElementById('chat-model').value;
    const temperature = parseFloat(document.getElementById('chat-temperature').value);
    const maxTokens = parseInt(document.getElementById('chat-max-tokens').value);
    
    try {
        const response = await fetchApi('/api/chat', {
            method: 'POST',
            body: JSON.stringify({
                messages: chatHistory,
                model: model,
                temperature: temperature,
                max_tokens: maxTokens,
                url: url
            })
        });
        
        if (response.choices && response.choices[0]) {
            const assistantMessage = response.choices[0].message.content;
            appendChatMessage('assistant', assistantMessage);
            chatHistory.push({ role: 'assistant', content: assistantMessage });
        } else {
            appendChatMessage('error', '无法获取回复');
        }
    } catch (error) {
        appendChatMessage('error', '错误: ' + error.message);
    }
}

function appendChatMessage(role, content) {
    const container = document.getElementById('chat-messages');
    
    // 移除占位符
    const placeholder = container.querySelector('.placeholder');
    if (placeholder) placeholder.remove();
    
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message chat-' + role;
    
    const roleLabel = role === 'user' ? '👤 用户' : role === 'assistant' ? '🤖 助手' : '⚠️ 错误';
    msgDiv.innerHTML = '<div class="chat-role">' + roleLabel + '</div><div class="chat-content">' + escapeHtml(content) + '</div>';
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
}

function clearChat() {
    chatHistory = [];
    document.getElementById('chat-messages').innerHTML = '<p class="placeholder">输入消息开始对话...</p>';
}

async function fetchChatModels() {
    const url = document.getElementById('chat-url').value;
    try {
        const result = await fetchApi('/api/chat/models?url=' + encodeURIComponent(url));
        if (result.data && result.data.length > 0) {
            const modelId = result.data[0].id;
            document.getElementById('chat-model').value = modelId;
            showToast('获取到模型: ' + modelId, 'success');
        } else if (result.error) {
            showToast('获取失败: ' + result.error, 'error');
        } else {
            showToast('未找到可用模型', 'info');
        }
    } catch (error) {
        showToast('获取模型列表失败: ' + error.message, 'error');
    }
}

// ==================== 镜像下载 ====================
function showPullImageModal() {
    document.getElementById('pull-image-modal').classList.add('show');
    document.getElementById('pull-image-name').value = '';
    document.getElementById('pull-progress').style.display = 'none';
    document.getElementById('pull-image-btn').disabled = false;
}

function setImageName(imageName) {
    document.getElementById('pull-image-name').value = imageName;
}

async function pullImage(event) {
    event.preventDefault();
    
    const imageName = document.getElementById('pull-image-name').value.trim();
    if (!imageName) {
        showToast('请输入镜像地址', 'error');
        return;
    }
    
    const btn = document.getElementById('pull-image-btn');
    const progressDiv = document.getElementById('pull-progress');
    const statusText = document.getElementById('pull-status');
    
    btn.disabled = true;
    btn.textContent = '⏳ 下载中...';
    progressDiv.style.display = 'block';
    statusText.textContent = `正在下载 ${imageName}...`;
    
    try {
        const result = await fetchApi(`/api/images/pull?image=${encodeURIComponent(imageName)}`, { method: 'POST' });
        
        if (result.success) {
            showToast(result.message, 'success');
            statusText.textContent = '✅ 下载完成！';
            setTimeout(() => closeModal('pull-image-modal'), 2000);
        } else {
            showToast('下载失败: ' + result.message, 'error');
            statusText.textContent = '❌ 下载失败: ' + result.message;
        }
    } catch (error) {
        showToast('下载失败: ' + error.message, 'error');
        statusText.textContent = '❌ 下载失败';
    } finally {
        btn.disabled = false;
        btn.textContent = '📥 开始下载';
    }
}
