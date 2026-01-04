const API_BASE = '';
let currentModelSource = 'local';
let selectedNpuDevices = [0];
let allServices = [];
let allContainers = [];
let allModels = { local: [], modelscope: [], popular: [] };
let chatHistory = [];

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    console.log('vLLM Ascend Playground Initializing...');
    initNavigation();
    initEventListeners();
    initNpuSelector();
    loadInitialData();
    startStatusPolling();
    
    // Initialize specific components
    initChat();
    initLogs();
});

function initEventListeners() {
    // --- Global Buttons ---
    
    // Containers Tab
    bindClick('btn-create-container', showCreateContainerModal);
    bindClick('btn-pull-image', showPullImageModal);
    bindClick('btn-refresh-containers', refreshContainers);
    bindInput('container-filter', filterContainers);
    bindChange('show-running-only', filterContainers);

    // Models Tab
    bindClick('btn-download-model', showDownloadModelModal);
    bindClick('btn-refresh-models', refreshModels);
    bindInput('model-filter', filterModels);
    
    // vLLM Tab
    bindClick('stop-vllm-btn', stopVllm);
    
    // Chat Tab
    bindClick('btn-fetch-models', fetchChatModels);
    bindClick('btn-clear-chat', clearChat);
    bindClick('btn-send-chat', sendChatMessage);
    
    // Forms
    bindSubmit('vllm-config-form', startVllm);
    bindSubmit('benchmark-form', runBenchmark);
    bindSubmit('create-container-form', createContainer);
    bindSubmit('pull-image-form', pullImage);
    bindSubmit('download-model-form', downloadModel);
    
    // Modals
    document.querySelectorAll('.close-btn, .btn-secondary[data-modal]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.modal || btn.closest('.modal').id;
            closeModal(modalId);
        });
    });
    
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal.id);
        });
    });

    // Quick Image Buttons
    document.querySelectorAll('.quick-image-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setImageName(btn.dataset.image);
        });
    });

    // Model Tabs
    document.querySelectorAll('.model-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.model-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentModelSource = tab.dataset.source;
            refreshModels();
        });
    });

    // vLLM Config Form Inputs (Auto-update command)
    document.querySelectorAll('#vllm-config-form input, #vllm-config-form select').forEach(input => {
        input.addEventListener('change', updateGeneratedCommand);
        input.addEventListener('input', updateGeneratedCommand);
    });
    
    // Model Source Type Change
    const sourceTypeSelect = document.getElementById('model-source-type');
    if (sourceTypeSelect) {
        sourceTypeSelect.addEventListener('change', (e) => {
            const isLocal = e.target.value === 'local';
            toggleDisplay('local-model-group', isLocal);
            toggleDisplay('modelscope-model-group', !isLocal);
            updateGeneratedCommand();
        });
    }

    // Benchmark Type Change
    const benchTypeSelect = document.getElementById('benchmark-type');
    if (benchTypeSelect) {
        benchTypeSelect.addEventListener('change', (e) => {
            const isEval = e.target.value === 'evalscope';
            document.querySelector('.evalscope-params').style.display = isEval ? 'contents' : 'none'; // Assuming CSS handles .evalscope-params wrapping
            // Actually the HTML has id='evalscope-params' and id='vllm-bench-params'
            toggleDisplay('evalscope-params', isEval);
            toggleDisplay('vllm-bench-params', !isEval);
        });
    }

    // Event Delegations
    bindDelegation('containers-table', 'click', 'button[data-action]', handleContainerAction);
    bindDelegation('models-list', 'click', 'button[data-action]', handleModelAction);
    bindDelegation('benchmark-history', 'click', 'button[data-action]', handleBenchmarkAction);
    bindDelegation('services-list', 'click', 'button[data-action]', handleServiceAction);
}

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(item.dataset.tab);
        });
    });
}

function initChat() {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });
    }
    
    const tempInput = document.getElementById('chat-temperature');
    if (tempInput) {
        tempInput.addEventListener('input', (e) => {
            document.getElementById('temp-value').textContent = e.target.value;
        });
    }
}

function initLogs() {
    const logSource = document.getElementById('log-source');
    if (logSource) {
        logSource.addEventListener('change', onLogSourceChange);
    }
}

// --- Helper Functions for Binding ---

function bindClick(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
    else console.warn(`Element #${id} not found for click binding`);
}

function bindSubmit(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('submit', handler);
    else console.warn(`Element #${id} not found for submit binding`);
}

function bindInput(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', handler);
}

function bindChange(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', handler);
}

function bindDelegation(parentId, eventType, selector, handler) {
    const parent = document.getElementById(parentId);
    if (parent) {
        parent.addEventListener(eventType, (e) => {
            const target = e.target.closest(selector);
            if (target) handler(target, e);
        });
    }
}

function toggleDisplay(id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? (el.tagName === 'DIV' && el.classList.contains('form-grid') ? 'grid' : 'block') : 'none';
    // Special handling for form-grid if needed, but block usually works or specific display type
    // The original code used 'contents' for some, 'block' for others.
    // Let's stick to simple display toggling.
    if (el) {
        if (show) {
            // Restore original display if possible, or guess
            if (el.classList.contains('form-grid')) el.style.display = 'grid';
            else el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    }
}

// --- Action Handlers ---

function handleContainerAction(button) {
    const action = button.dataset.action;
    const containerName = button.dataset.containerName;
    
    if (action === 'start') startContainer(containerName);
    else if (action === 'stop') stopContainer(containerName);
    else if (action === 'delete') deleteContainer(containerName);
}

function handleModelAction(button) {
    const action = button.dataset.action;
    const modelPath = button.dataset.modelPath;
    const sourceType = button.dataset.sourceType;
    
    if (action === 'use') useModel(modelPath, sourceType);
    else if (action === 'download') downloadModelById(modelPath);
}

function handleBenchmarkAction(button) {
    if (button.dataset.action === 'view') {
        try {
            const result = JSON.parse(button.dataset.result);
            displayBenchmarkResults(result);
        } catch (error) {
            console.error('Failed to parse benchmark result:', error);
        }
    }
}

function handleServiceAction(button) {
    if (button.dataset.action === 'kill') {
        killVllmService(button.dataset.containerName, button.dataset.pid);
    }
}

// --- Core Logic ---

async function fetchApi(endpoint, options = {}) {
    try {
        const response = await fetch(API_BASE + endpoint, { 
            headers: { 'Content-Type': 'application/json', ...options.headers }, 
            ...options 
        });
        if (!response.ok) { 
            const error = await response.json().catch(() => ({ detail: response.statusText })); 
            throw new Error(error.detail || 'Request failed'); 
        }
        return await response.json();
    } catch (error) { 
        showToast(error.message, 'error'); 
        throw error; 
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function switchTab(tabId) {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.tab === tabId));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.toggle('active', content.id === tabId));
    
    if (tabId === 'dashboard') { refreshServices(); refreshStatus(); }
    if (tabId === 'containers') refreshContainers();
    if (tabId === 'models') refreshModels();
    if (tabId === 'benchmark') { loadBenchmarkHistory(); loadBenchmarkTemplates(); }
    if (tabId === 'vllm') { refreshServices(); refreshContainers(); } // Also refresh containers for the dropdown
}

async function loadInitialData() {
    try {
        await refreshServices();
        await refreshStatus();
        await refreshContainers();
        await refreshModels();
        initNpuChart();
    } catch (error) {
        console.error('loadInitialData error:', error);
    }
}

// --- Status & NPU ---

async function refreshStatus() {
    try {
        const status = await fetchApi('/api/status');
        
        const statusDot = document.getElementById('service-status');
        const statusText = document.getElementById('status-text');
        
        const runningCount = allServices.length; // Use local cache or status.vllm_running
        // Better to rely on status API if it returns running count
        
        if (status.vllm_running) {
            if (statusDot) statusDot.classList.add('online');
            if (statusText) statusText.textContent = `服务运行中`;
        } else {
            if (statusDot) statusDot.classList.remove('online');
            if (statusText) statusText.textContent = 'vLLM 未运行';
        }
        
        // Update Dashboard Stats
        const containerCount = document.getElementById('container-count');
        if (containerCount && status.containers) {
            const runningContainers = status.containers.filter(c => c.running).length;
            containerCount.textContent = runningContainers;
        }
        
        if (status.npu_status) {
            const npuCount = document.getElementById('npu-count');
            if (npuCount) npuCount.textContent = status.npu_status.length + ' NPU';
            updateNpuStatusGrid(status.npu_status);
        }
    } catch (error) {
        console.error('Failed to refresh status:', error);
    }
}

function startStatusPolling() { setInterval(refreshStatus, 5000); }

function initNpuSelector() {
    const npuSelector = document.getElementById('npu-selector');
    const modalNpuSelector = document.getElementById('modal-npu-selector');
    if (!npuSelector || !modalNpuSelector) return;
    
    npuSelector.innerHTML = '';
    modalNpuSelector.innerHTML = '';
    
    for (let i = 0; i < 8; i++) { // Assuming 8 NPUs max for now, or 16
        // Main Config Selector
        const div = document.createElement('div');
        div.className = 'npu-checkbox' + (selectedNpuDevices.includes(i) ? ' selected' : '');
        div.innerHTML = `<input type="checkbox" value="${i}" ${selectedNpuDevices.includes(i) ? 'checked' : ''}> NPU ${i}`;
        div.onclick = (e) => {
            e.preventDefault(); // Prevent double toggle if clicking label
            toggleNpu(i, div);
        };
        npuSelector.appendChild(div);
        
        // Modal Selector
        const label = document.createElement('label');
        label.innerHTML = `<input type="checkbox" name="modal-npu" value="${i}" checked> NPU ${i}`;
        modalNpuSelector.appendChild(label);
    }
}

function toggleNpu(id, element) {
    const index = selectedNpuDevices.indexOf(id);
    if (index === -1) { 
        selectedNpuDevices.push(id); 
        element.classList.add('selected'); 
        element.querySelector('input').checked = true;
    } else { 
        selectedNpuDevices.splice(index, 1); 
        element.classList.remove('selected'); 
        element.querySelector('input').checked = false;
    }
    selectedNpuDevices.sort((a, b) => a - b);
    updateGeneratedCommand();
}

function initNpuChart() { updateNpuStatusGrid([]); }

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
        
        let content = `<div class="npu-id">NPU ${npu.id}</div>`;
        if (npu.occupied) {
            content += '<div class="npu-state">已占用</div>';
            content += `<div class="npu-container">${npu.container || '未知容器'}</div>`;
        } else {
            content += '<div class="npu-state">空闲</div>';
        }
        div.innerHTML = content;
        container.appendChild(div);
    });
}

// --- Containers ---

async function refreshContainers() {
    try {
        const data = await fetchApi('/api/containers');
        allContainers = data.containers || [];
        renderContainers();
    } catch (error) { console.error('Failed to refresh containers:', error); }
}

function renderContainers() {
    const keyword = (document.getElementById('container-filter')?.value || '').toLowerCase();
    const runningOnly = document.getElementById('show-running-only')?.checked || false;
    
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
    
    if (tbody) {
        tbody.innerHTML = '';
        filtered.forEach(container => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${container.name}</td>
                <td class="image-cell" title="${container.image}">${container.image}</td>
                <td><span class="status-tag ${container.running ? 'running' : 'stopped'}">${container.running ? '运行中' : '已停止'}</span></td>
                <td>${container.created}</td>
                <td>
                    ${container.running ? 
                        `<button class="btn btn-sm btn-secondary" data-action="stop" data-container-name="${container.name}">停止</button>` : 
                        `<button class="btn btn-sm btn-primary" data-action="start" data-container-name="${container.name}">启动</button>`
                    }
                    <button class="btn btn-sm btn-danger" data-action="delete" data-container-name="${container.name}">删除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
    
    if (select) {
        const currentVal = select.value;
        select.innerHTML = '<option value="">选择容器</option>';
        allContainers.filter(c => c.running).forEach(c => {
            const option = document.createElement('option');
            option.value = c.name;
            option.textContent = c.name;
            select.appendChild(option);
        });
        if (currentVal) select.value = currentVal;
    }
    
    const countSpan = document.getElementById('container-count-display');
    if (countSpan) countSpan.textContent = `显示 ${filtered.length} / ${allContainers.length} 个容器`;
}

function filterContainers() { renderContainers(); }

async function startContainer(name) { 
    try { 
        showToast(`正在启动容器 ${name}...`, 'info');
        await fetchApi(`/api/containers/${name}/start`, { method: 'POST' }); 
        showToast(`容器已启动: ${name}`, 'success'); 
        refreshContainers(); 
    } catch (error) { showToast(`启动容器失败: ${error.message}`, 'error'); } 
}

async function stopContainer(name) { 
    try { 
        showToast(`正在停止容器 ${name}...`, 'info');
        await fetchApi(`/api/containers/${name}/stop`, { method: 'POST' }); 
        showToast(`容器已停止: ${name}`, 'success'); 
        refreshContainers(); 
    } catch (error) { showToast(`停止容器失败: ${error.message}`, 'error'); } 
}

async function deleteContainer(name) { 
    if (!confirm(`确定要删除容器 ${name} 吗？`)) return; 
    try { 
        showToast('正在删除容器...', 'info');
        await fetchApi(`/api/containers/${name}`, { method: 'DELETE' }); 
        showToast(`容器已删除: ${name}`, 'success'); 
        refreshContainers(); 
    } catch (error) { showToast(`删除容器失败: ${error.message}`, 'error'); } 
}

async function createContainer(e) {
    e.preventDefault();
    const name = document.getElementById('new-container-name').value;
    const image = document.getElementById('new-container-image').value;
    const shmSize = document.getElementById('new-container-shm').value;
    const npuDevices = []; 
    document.querySelectorAll('input[name="modal-npu"]:checked').forEach(input => npuDevices.push(parseInt(input.value)));
    
    try {
        await fetchApi('/api/containers/create', { 
            method: 'POST', 
            body: JSON.stringify({ container_name: name, image: image, npu_devices: npuDevices, shm_size: shmSize }) 
        });
        showToast('容器创建成功', 'success'); 
        closeModal('create-container-modal'); 
        refreshContainers();
    } catch (error) { console.error(error); }
}

function showCreateContainerModal() { document.getElementById('create-container-modal').classList.add('show'); }

// --- Images ---

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
    if (!imageName) { showToast('请输入镜像地址', 'error'); return; }
    
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
            showToast(`下载失败: ${result.message}`, 'error');
            statusText.textContent = `❌ 下载失败: ${result.message}`;
        }
    } catch (error) {
        showToast(`下载失败: ${error.message}`, 'error');
        statusText.textContent = '❌ 下载失败';
    } finally {
        btn.disabled = false;
        btn.textContent = '📥 开始下载';
    }
}

// --- Models ---

async function refreshModels() {
    try {
        const data = await fetchApi('/api/models');
        allModels.local = data.local_models || [];
        allModels.modelscope = data.modelscope_models || [];
        allModels.popular = getPopularModels();
        renderModels();
    } catch (error) { console.error('Failed to refresh models:', error); }
}

function getPopularModels() { 
    return [
        {id:'Qwen/Qwen3-0.6B',name:'Qwen3-0.6B',size:'0.6B'},
        {id:'Qwen/Qwen3-4B',name:'Qwen3-4B',size:'4B'},
        {id:'Qwen/Qwen3-8B',name:'Qwen3-8B',size:'8B'},
        {id:'Qwen/Qwen3-32B',name:'Qwen3-32B',size:'32B'}
    ]; 
}

function renderModels() {
    const keyword = (document.getElementById('model-filter')?.value || '').toLowerCase();
    const container = document.getElementById('models-list');
    if (!container) return;
    container.innerHTML = '';
    
    let models = currentModelSource === 'local' ? allModels.local : 
                 currentModelSource === 'modelscope' ? allModels.modelscope : allModels.popular;
    
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
        
        let metaHtml = '';
        let actionsHtml = '';
        
        if (currentModelSource === 'popular') {
            metaHtml = `<div>ID: ${model.id}</div><div>参数量: ${model.size}</div>`;
            actionsHtml = `
                <button class="btn btn-sm btn-primary" data-action="download" data-model-path="${model.id}">下载</button>
                <button class="btn btn-sm btn-secondary" data-action="use" data-model-path="${model.id}" data-source-type="modelscope">使用</button>
            `;
        } else {
            metaHtml = `<div>路径: ${model.path}</div><div>大小: ${model.size_human}</div>`;
            actionsHtml = `
                <button class="btn btn-sm btn-primary" data-action="use" data-model-path="${model.path}" data-source-type="local">使用</button>
            `;
        }
        
        card.innerHTML = `
            <h4>${model.name}</h4>
            <div class="model-meta">${metaHtml}</div>
            <div class="model-actions">${actionsHtml}</div>
        `;
        container.appendChild(card);
    });
}

function filterModels() { renderModels(); }

function useModel(modelPath, sourceType) {
    document.getElementById('model-source-type').value = sourceType;
    
    const isLocal = sourceType === 'local';
    toggleDisplay('local-model-group', isLocal);
    toggleDisplay('modelscope-model-group', !isLocal);
    
    if (isLocal) document.getElementById('local-model-path').value = modelPath;
    else document.getElementById('modelscope-model-id').value = modelPath;
    
    updateGeneratedCommand(); 
    switchTab('vllm');
}

function showDownloadModelModal() { document.getElementById('download-model-modal').classList.add('show'); }

async function downloadModelById(modelId) { 
    showToast(`Downloading: ${modelId}`, 'success'); 
    try { 
        await fetchApi('/api/models/download', { method: 'POST', body: JSON.stringify({ model_id: modelId, source: 'modelscope' }) }); 
        showToast('Download complete', 'success'); 
        refreshModels(); 
    } catch (error) { console.error(error); } 
}

async function downloadModel(e) { 
    e.preventDefault(); 
    const modelId = document.getElementById('download-model-id').value;
    const source = document.getElementById('download-source').value;
    const cacheDir = document.getElementById('download-cache-dir')?.value || '';
    closeModal('download-model-modal'); 
    
    showToast(`正在下载: ${modelId}`, 'success');
    try {
        let url = `/api/models/download?model_id=${encodeURIComponent(modelId)}&source=${source}`;
        if (cacheDir) url += `&cache_dir=${encodeURIComponent(cacheDir)}`;
        
        const result = await fetchApi(url, { method: 'POST' });
        showToast(result.message || '下载完成', 'success');
        refreshModels();
    } catch (error) { console.error(error); }
}

// --- vLLM Service ---

function updateGeneratedCommand() {
    const sourceType = document.getElementById('model-source-type').value;
    const modelPath = sourceType === 'local' ? document.getElementById('local-model-path').value : document.getElementById('modelscope-model-id').value;
    
    let cmd = [];
    if (selectedNpuDevices.length > 0) cmd.push(`export ASCEND_RT_VISIBLE_DEVICES=${selectedNpuDevices.join(',')}`);
    if (sourceType === 'modelscope') cmd.push('export VLLM_USE_MODELSCOPE="True"');
    
    let vllmCmd = `vllm serve ${modelPath || '<model_path>'}`;
    vllmCmd += ` \\\n  --served-model-name ${document.getElementById('served-model-name').value || 'default-model'}`;
    vllmCmd += ` \\\n  --host 0.0.0.0`;
    vllmCmd += ` \\\n  --port ${document.getElementById('vllm-port').value || 8000}`;
    vllmCmd += ` \\\n  --tensor-parallel-size ${document.getElementById('tensor-parallel-size').value || 1}`;
    
    const maxLen = document.getElementById('max-model-len').value;
    if (maxLen) vllmCmd += ` \\\n  --max-model-len ${maxLen}`;
    
    if (document.getElementById('trust-remote-code').checked) vllmCmd += ` \\\n  --trust-remote-code`;
    
    const dtype = document.getElementById('dtype').value; 
    if (dtype && dtype !== 'auto') vllmCmd += ` \\\n  --dtype ${dtype}`;
    
    const additionalArgs = document.getElementById('additional-args').value; 
    if (additionalArgs) vllmCmd += ` \\\n  ${additionalArgs}`;
    
    cmd.push(vllmCmd);
    document.getElementById('generated-command').textContent = cmd.join('\n\n');
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
        const result = await fetchApi(`/api/vllm/start?container_name=${containerName}`, { method: 'POST', body: JSON.stringify(config) });
        if (result.service_id) showToast(`服务启动成功! ID: ${result.service_id}`, 'success');
        else showToast('服务启动中...', 'success');
        
        await refreshServices();
        refreshStatus(); 
    } catch (error) { 
        showToast(`启动失败: ${error.message}`, 'error');
        console.error(error); 
    }
}

async function stopVllm() { 
    if (allServices.length === 0) { showToast('没有运行中的服务', 'info'); return; }
    if (!confirm('确定要停止所有 vLLM 服务吗？')) return;
    
    try { 
        await fetchApi('/api/vllm/stop', { method: 'POST' }); 
        showToast('所有服务已停止', 'success'); 
        await refreshServices();
        refreshStatus(); 
    } catch (error) { showToast(`停止失败: ${error.message}`, 'error'); } 
}

async function refreshServices() {
    try {
        const result = await fetchApi('/api/vllm/running');
        allServices = result.services || [];
        renderServices();
        
        const runningCount = result.count || 0;
        const statusEl = document.getElementById('vllm-status');
        if (statusEl) {
            statusEl.textContent = runningCount > 0 ? `${runningCount} 个运行中` : '未启动';
            statusEl.style.color = runningCount > 0 ? 'var(--success)' : 'var(--text-secondary)';
        }
        
        const countEl = document.getElementById('running-service-count');
        if (countEl) countEl.textContent = runningCount;
        
    } catch (error) { console.error('Failed to refresh services:', error); }
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
        serviceDiv.innerHTML = `
            <div class="service-info">
                <div class="service-header">
                    <span class="service-id">🟢 ${service.container}</span>
                    <span class="badge badge-success">运行中</span>
                </div>
                <div class="service-details">
                    <div><strong>进程:</strong> ${service.process_name || 'vLLM'}</div>
                    <div><strong>端口:</strong> ${service.port}</div>
                    <div><strong>PID:</strong> ${service.pid}</div>
                    <div><strong>NPU:</strong> ${npuDevices}</div>
                    <div><strong>显存:</strong> ${memoryMB}</div>
                </div>
            </div>
            <div class="service-actions">
                <button class="btn btn-danger btn-sm" data-action="kill" data-container-name="${service.container}" data-pid="${service.pid}">⏹ 停止</button>
            </div>
        `;
        container.appendChild(serviceDiv);
    });
}

async function killVllmService(containerName, pid) {
    if (!confirm(`确定要停止容器 ${containerName} 中的 vLLM 服务吗？`)) return;
    try {
        showToast('正在停止服务...', 'info');
        await fetchApi(`/api/vllm/kill?container_name=${containerName}&pid=${pid}`, { method: 'POST' });
        showToast('服务已停止', 'success');
        setTimeout(refreshServices, 2000);
    } catch (error) { showToast(`停止服务失败: ${error.message}`, 'error'); }
}

// --- Benchmark ---

async function runBenchmark(e) {
    e.preventDefault();
    const benchmarkType = document.getElementById('benchmark-type').value;
    const config = { 
        benchmark_type: benchmarkType, 
        url: document.getElementById('benchmark-url').value, 
        model_name: document.getElementById('benchmark-model-name').value 
    };
    
    if (benchmarkType === 'evalscope') { 
        config.parallel = parseInt(document.getElementById('eval-parallel').value);
        config.number = parseInt(document.getElementById('eval-number').value); 
        config.dataset = document.getElementById('eval-dataset').value; 
        config.temperature = parseFloat(document.getElementById('eval-temperature')?.value || 0); 
    } else { 
        config.request_rate = parseFloat(document.getElementById('bench-request-rate').value); 
        config.max_concurrency = parseInt(document.getElementById('bench-max-concurrency').value); 
        config.num_prompts = parseInt(document.getElementById('bench-num-prompts').value); 
        config.random_input_len = parseInt(document.getElementById('bench-input-len').value); 
        config.random_output_len = parseInt(document.getElementById('bench-output-len').value); 
    }
    
    showToast('Running benchmark...', 'success');
    try { 
        const result = await fetchApi('/api/benchmark/run', { method: 'POST', body: JSON.stringify(config) }); 
        displayBenchmarkResults(result); 
        loadBenchmarkHistory(); 
    } catch (error) { console.error(error); }
}

function displayBenchmarkResults(result) {
    const container = document.getElementById('benchmark-results');
    if (result.error) { 
        container.innerHTML = `<p class="placeholder" style="color: var(--danger-color);">Failed: ${result.error}</p>`; 
        return; 
    }
    
    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-info"><h3>Throughput</h3><div>${result.throughput ? result.throughput.toFixed(2) : 'N/A'} req/s</div></div></div>
            <div class="stat-card"><div class="stat-info"><h3>Avg Latency</h3><div>${result.avg_latency ? result.avg_latency.toFixed(2) : 'N/A'} ms</div></div></div>
            <div class="stat-card"><div class="stat-info"><h3>P95 Latency</h3><div>${result.p95_latency ? result.p95_latency.toFixed(2) : 'N/A'} ms</div></div></div>
            <div class="stat-card"><div class="stat-info"><h3>P99 Latency</h3><div>${result.p99_latency ? result.p99_latency.toFixed(2) : 'N/A'} ms</div></div></div>
        </div>
    `;
    
    if (result.raw_output) {
        container.innerHTML += `
            <details style="margin-top:16px;">
                <summary style="cursor:pointer; color:var(--text-secondary);">Raw Output</summary>
                <pre class="command-preview" style="margin-top:8px;">${result.raw_output}</pre>
            </details>
        `;
    }
}

async function loadBenchmarkHistory() {
    try {
        const data = await fetchApi('/api/benchmark/results');
        const tbody = document.getElementById('benchmark-history');
        document.getElementById('benchmark-count').textContent = (data || []).length;
        tbody.innerHTML = '';
        
        if (!data || data.length === 0) { 
            tbody.innerHTML = '<tr><td colspan="6" class="placeholder">No records</td></tr>'; 
            return; 
        }
        
        data.slice().reverse().forEach(result => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(result.timestamp).toLocaleString()}</td>
                <td>${result.benchmark_type}</td>
                <td>${result.throughput ? result.throughput.toFixed(2) : 'N/A'}</td>
                <td>${result.avg_latency ? result.avg_latency.toFixed(2) : 'N/A'}</td>
                <td>${result.p99_latency ? result.p99_latency.toFixed(2) : 'N/A'}</td>
                <td><button class="btn btn-secondary" data-action="view" data-result='${JSON.stringify(result)}'>View</button></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) { console.error('Failed to load benchmark history:', error); }
}

function loadBenchmarkTemplates() {
    const templates = [
        {name:'Quick Test',desc:'Fast validation',type:'evalscope',parallel:1,number:5},
        {name:'Standard Test',desc:'Standard benchmark',type:'evalscope',parallel:4,number:50},
        {name:'Stress Test',desc:'High concurrency',type:'evalscope',parallel:16,number:100},
        {name:'Long Text',desc:'Long context test',type:'vllm_bench',inputLen:4096,outputLen:2048},
        {name:'Throughput',desc:'Max throughput',type:'vllm_bench',rate:100,concurrency:64}
    ];
    
    const container = document.getElementById('benchmark-templates');
    container.innerHTML = '';
    templates.forEach(tpl => { 
        const card = document.createElement('div'); 
        card.className = 'template-card'; 
        card.innerHTML = `<h4>${tpl.name}</h4><p>${tpl.desc}</p>`; 
        card.onclick = () => applyTemplate(tpl); 
        container.appendChild(card); 
    });
}

function applyTemplate(template) {
    document.getElementById('benchmark-type').value = template.type;
    
    const isEval = template.type === 'evalscope';
    toggleDisplay('evalscope-params', isEval);
    toggleDisplay('vllm-bench-params', !isEval);
    
    if (isEval) {
        if (template.parallel) document.getElementById('eval-parallel').value = template.parallel;
        if (template.number) document.getElementById('eval-number').value = template.number;
    } else {
        if (template.rate) document.getElementById('bench-request-rate').value = template.rate;
        if (template.concurrency) document.getElementById('bench-max-concurrency').value = template.concurrency;
        if (template.inputLen) document.getElementById('bench-input-len').value = template.inputLen;
        if (template.outputLen) document.getElementById('bench-output-len').value = template.outputLen;
    }
    showToast(`Template applied: ${template.name}`, 'success');
}

// --- Chat ---

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;
    
    input.value = '';
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
        appendChatMessage('error', `错误: ${error.message}`);
    }
}

function appendChatMessage(role, content) {
    const container = document.getElementById('chat-messages');
    const placeholder = container.querySelector('.placeholder');
    if (placeholder) placeholder.remove();
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message chat-${role}`;
    const roleLabel = role === 'user' ? '👤 用户' : role === 'assistant' ? '🤖 助手' : '⚠️ 错误';
    msgDiv.innerHTML = `<div class="chat-role">${roleLabel}</div><div class="chat-content">${escapeHtml(content)}</div>`;
    
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
        const result = await fetchApi(`/api/chat/models?url=${encodeURIComponent(url)}`);
        if (result.data && result.data.length > 0) {
            const modelId = result.data[0].id;
            document.getElementById('chat-model').value = modelId;
            showToast(`获取到模型: ${modelId}`, 'success');
        } else if (result.error) {
            showToast(`获取失败: ${result.error}`, 'error');
        } else {
            showToast('未找到可用模型', 'info');
        }
    } catch (error) { showToast(`获取模型列表失败: ${error.message}`, 'error'); }
}

// --- Logs ---

async function refreshLogs() {
    const source = document.getElementById('log-source')?.value || 'playground';
    const logContainer = document.getElementById('log-container');
    if (!logContainer) return;
    
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
        logContainer.textContent = `获取日志失败: ${error.message}`;
    }
}

function onLogSourceChange() {
    const source = document.getElementById('log-source')?.value;
    const containerSelect = document.getElementById('log-container-select');
    
    if (source === 'container') {
        containerSelect.style.display = 'inline-block';
        containerSelect.innerHTML = '<option value="">选择容器...</option>';
        allContainers.filter(c => c.running).forEach(c => {
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

function closeModal(modalId) { 
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('show'); 
}
