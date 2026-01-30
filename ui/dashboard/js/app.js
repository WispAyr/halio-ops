function deriveDefaultApiBase() {
  try {
    const { protocol, hostname, port } = window.location;
    const apiPort = port && port !== '7002' ? port : '3000';
    const portFragment = apiPort ? `:${apiPort}` : '';
    return `${protocol}//${hostname}${portFragment}`;
  } catch (err) {
    console.warn('Falling back to localhost API base', err);
    return 'http://localhost:3000';
  }
}

const API_BASE = window.localStorage.getItem('halio-api-base') || deriveDefaultApiBase();
const WS_BASE = API_BASE.replace('http', 'ws');

const dom = {
  status: {
    halio: document.querySelector('[data-status="halio"]'),
    api: document.querySelector('[data-status="api"]'),
  },
  pipelines: document.getElementById('pipelines-list'),
  refreshPipelines: document.getElementById('refresh-pipelines'),
  newPipeline: document.getElementById('open-new-pipeline'),
  pipelineDialog: document.getElementById('new-pipeline-dialog'),
  pipelineModelField: document.getElementById('model-path-field'),
  rtmps: document.getElementById('rtmp-list'),
  refreshRtmps: document.getElementById('refresh-rtmp'),
  newIngest: document.getElementById('open-new-ingest'),
  ingestDialog: document.getElementById('new-ingest-dialog'),
  ingestModelField: document.getElementById('ingest-model-path-field'),
  previewSelect: document.getElementById('preview-source'),
  previewPlayer: document.getElementById('preview-player'),
  previewStatus: document.getElementById('preview-status'),
  detectionOverlay: document.getElementById('detection-overlay'),
  detectionSummary: document.getElementById('detection-summary'),
  wsStatus: document.getElementById('ws-status'),
  inferenceLog: document.getElementById('inference-log'),
};

const state = {
  pipelines: [],
  ingests: [],
  previewKey: '',
  hls: null,
};

function resolveUrl(raw) {
  if (!raw) return null;
  try {
    return new URL(raw, API_BASE).href;
  } catch (err) {
    console.warn('Failed to resolve url', raw, err);
    return raw;
  }
}

function setBadge(element, label, status) {
  if (!element) return;
  const state = status || 'idle';
  element.dataset.state = state;
  const dot = element.querySelector('[data-role="status-dot"]');
  const text = element.querySelector('[data-role="status-text"]');
  if (dot) {
    const colors = { ok: 'bg-emerald-400', warn: 'bg-amber-400', error: 'bg-red-500', idle: 'bg-slate-500' };
    dot.className = `status-card__dot ${colors[state] || colors.idle}`;
  }
  if (text) text.textContent = label;
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

async function loadStatus() {
  try {
    const data = await fetchJson('/halio/status');
    setBadge(dom.status.halio, data.available ? 'Halio: Online' : 'Halio: Offline', data.available ? 'ok' : 'warn');
    setBadge(dom.status.api, 'API: Connected', 'ok');
  } catch (err) {
    console.error(err);
    setBadge(dom.status.halio, 'Halio: Unreachable', 'error');
    setBadge(dom.status.api, 'API: Error', 'error');
  }
}

function pipelineCard(p) {
  const href = resolveUrl(p.manifestUrl || p.manifestPath);
  return `
    <article class="flex flex-col gap-3 px-5 py-5 transition hover:bg-slate-900/40">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-lg font-medium text-slate-100">${p.name}</h3>
          <p class="text-xs text-slate-500">${href || p.manifestPath}</p>
        </div>
        <div class="flex items-center gap-2 text-xs text-slate-400">
          ${p.autoInfer ? `<span class="chip bg-emerald-600/20 text-emerald-200 border-emerald-500/30">Inference on (${p.modelPath || 'default'})</span>` : ''}
        </div>
      </div>
      <div class="flex flex-wrap gap-3 text-sm text-slate-400">
        ${href ? `<button class="btn-primary" data-context="pipeline" data-action="preview" data-name="${p.name}" data-label="RTSP • ${p.name}" data-manifest-url="${href}"><span class="material-symbols-rounded text-base">play_circle</span>Preview</button>` : ''}
        <button class="btn-muted" data-context="pipeline" data-action="toggle-inference" data-name="${p.name}" data-enabled="${p.autoInfer}"><span class="material-symbols-rounded text-base">memory</span>${p.autoInfer ? 'Disable Inference' : 'Enable Inference'}</button>
        <button class="btn-muted" data-context="pipeline" data-action="stop" data-name="${p.name}"><span class="material-symbols-rounded text-base">stop_circle</span>Stop Pipeline</button>
        ${href ? `<a class="btn-muted" href="${href}" target="_blank" rel="noreferrer"><span class="material-symbols-rounded text-base">open_in_new</span>Playlist</a>` : ''}
      </div>
    </article>
  `;
}

function ingestCard(p) {
  const href = resolveUrl(p.manifestUrl || p.manifestPath);
  return `
    <article class="flex flex-col gap-3 px-5 py-5 transition hover:bg-slate-900/40">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-lg font-medium text-slate-100">${p.name}</h3>
          <p class="text-xs text-slate-500">${href || p.manifestPath}</p>
        </div>
        <div class="flex items-center gap-2 text-xs text-slate-400">
          ${p.autoInfer ? `<span class="chip bg-purple-600/20 text-purple-200 border-purple-500/30">Inference on (${p.modelPath || 'default'})</span>` : ''}
        </div>
      </div>
      <div class="flex flex-wrap gap-3 text-sm text-slate-400">
        ${href ? `<button class="btn-primary" data-context="rtmp" data-action="preview" data-name="${p.name}" data-label="RTMP • ${p.name}" data-manifest-url="${href}"><span class="material-symbols-rounded text-base">play_circle</span>Preview</button>` : ''}
        <button class="btn-muted" data-context="rtmp" data-action="toggle-inference" data-name="${p.name}" data-enabled="${p.autoInfer}"><span class="material-symbols-rounded text-base">memory</span>${p.autoInfer ? 'Disable Inference' : 'Enable Inference'}</button>
        <button class="btn-muted" data-context="rtmp" data-action="stop" data-name="${p.name}"><span class="material-symbols-rounded text-base">stop_circle</span>Stop Ingest</button>
        ${href ? `<a class="btn-muted" href="${href}" target="_blank" rel="noreferrer"><span class="material-symbols-rounded text-base">open_in_new</span>Playlist</a>` : ''}
      </div>
    </article>
  `;
}

async function loadPipelines() {
  try {
    const { pipelines } = await fetchJson('/pipelines');
    state.pipelines = pipelines || [];
    dom.pipelines.innerHTML = state.pipelines.length
      ? state.pipelines.map(pipelineCard).join('')
      : '<div class="flex items-center justify-center py-12 text-sm text-slate-400">No active pipelines. Launch one to begin.</div>';
    updatePreviewOptions();
  } catch (err) {
    console.error(err);
    dom.pipelines.innerHTML = `<div class=\"flex items-center justify-center py-12 text-sm text-red-400\">Failed to load pipelines: ${err.message}</div>`;
  }
}

async function loadRtmps() {
  try {
    const { ingests } = await fetchJson('/ingest/rtmp');
    state.ingests = ingests || [];
    dom.rtmps.innerHTML = state.ingests.length
      ? state.ingests.map(ingestCard).join('')
      : '<div class="flex items-center justify-center py-12 text-sm text-slate-400">No active RTMP ingests. Launch one to begin.</div>';
    updatePreviewOptions();
  } catch (err) {
    console.error(err);
    dom.rtmps.innerHTML = `<div class=\"flex items-center justify-center py-12 text-sm text-red-400\">Failed to load RTMP ingests: ${err.message}</div>`;
  }
}

function updatePreviewOptions() {
  if (!dom.previewSelect) return;
  const options = [];

  state.pipelines.forEach((p) => {
    const url = resolveUrl(p.manifestUrl || p.manifestPath);
    if (url) options.push({ key: `pipeline:${p.name}`, label: `RTSP • ${p.name}`, url });
  });
  state.ingests.forEach((p) => {
    const url = resolveUrl(p.manifestUrl || p.manifestPath);
    if (url) options.push({ key: `rtmp:${p.name}`, label: `RTMP • ${p.name}`, url });
  });

  if (!options.length) {
    dom.previewSelect.innerHTML = '<option value="" disabled selected>No streams available</option>';
    setPreviewSource(null);
    return;
  }

  dom.previewSelect.innerHTML = options
    .map((opt, idx) => `<option value="${opt.key}" data-url="${opt.url}" ${idx === 0 ? 'selected' : ''}>${opt.label}</option>`)
    .join('');

  const current = options.find((opt) => opt.key === state.previewKey) || options[0];
  dom.previewSelect.value = current.key;
  setPreviewSource(current.url, current.label, current.key, false);
}

function setPreviewSource(url, label = '', key = '', autoPlay = true) {
  state.previewKey = key;

  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }

  if (!dom.previewPlayer) return;

  if (!url) {
    dom.previewPlayer.removeAttribute('src');
    dom.previewPlayer.load();
    if (dom.previewStatus) {
      dom.previewStatus.textContent = 'Select a pipeline or ingest to view its HLS preview.';
      dom.previewStatus.className = 'mt-3 text-xs text-slate-400';
    }
    return;
  }

  const resolved = resolveUrl(url);
  const title = label || resolved;

  if (dom.previewPlayer.canPlayType('application/vnd.apple.mpegurl')) {
    dom.previewPlayer.src = resolved;
    if (autoPlay) dom.previewPlayer.play().catch((err) => console.warn('Autoplay blocked', err));
  } else if (window.Hls && window.Hls.isSupported()) {
    state.hls = new window.Hls({ enableWorker: true, lowLatencyMode: true });
    state.hls.loadSource(resolved);
    state.hls.attachMedia(dom.previewPlayer);
    if (autoPlay) {
      state.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        dom.previewPlayer.play().catch((err) => console.warn('Autoplay blocked', err));
      });
    }
    state.hls.on(window.Hls.Events.ERROR, (event, data) => {
      console.error('HLS.js error', data);
      if (dom.previewStatus) {
        dom.previewStatus.textContent = `Preview error: ${data?.details || data?.type}`;
        dom.previewStatus.className = 'mt-3 text-xs text-red-300';
      }
    });
  } else {
    if (dom.previewStatus) {
      dom.previewStatus.textContent = 'HLS playback is not supported in this browser. Try Safari or install hls.js support.';
      dom.previewStatus.className = 'mt-3 text-xs text-red-300';
    }
    return;
  }

  if (dom.previewStatus) {
    dom.previewStatus.textContent = `Playing ${title}`;
    dom.previewStatus.className = 'mt-3 text-xs text-emerald-200';
  }
}

let currentDetections = [];
let currentDetectionSummary = {};

function drawDetectionsOnVideo() {
  if (!dom.detectionOverlay || !dom.previewPlayer) return;
  
  const canvas = dom.detectionOverlay;
  const video = dom.previewPlayer;
  
  // Match canvas size to video
  const rect = video.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (currentDetections.length === 0 || video.videoWidth === 0) return;
  
  // Calculate scale factors
  const scaleX = canvas.width / video.videoWidth;
  const scaleY = canvas.height / video.videoHeight;
  
  // Draw bounding boxes
  currentDetections.forEach(det => {
    if (!det.bbox) return;
    
    const x1 = det.bbox.x1 * scaleX;
    const y1 = det.bbox.y1 * scaleY;
    const x2 = det.bbox.x2 * scaleX;
    const y2 = det.bbox.y2 * scaleY;
    const width = x2 - x1;
    const height = y2 - y1;
    
    const conf = Math.round((det.confidence || 0) * 100);
    const className = det.class_name || 'Unknown';
    
    // Draw bounding box
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.strokeRect(x1, y1, width, height);
    
    // Draw label background
    ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
    const labelText = `${className} ${conf}%`;
    ctx.font = '12px Inter, sans-serif';
    const textMetrics = ctx.measureText(labelText);
    const labelWidth = textMetrics.width + 8;
    const labelHeight = 18;
    
    ctx.fillRect(x1, y1 - labelHeight, labelWidth, labelHeight);
    
    // Draw label text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(labelText, x1 + 4, y1 - 4);
  });
}

function updateDetectionSummary(summary) {
  if (!dom.detectionSummary) return;
  
  currentDetectionSummary = summary || {};
  
  if (Object.keys(currentDetectionSummary).length === 0) {
    dom.detectionSummary.innerHTML = '';
    return;
  }
  
  let html = '';
  for (const [className, count] of Object.entries(currentDetectionSummary)) {
    html += `<span class="chip bg-blue-600/20 text-blue-200 border-blue-500/30 text-xs">${className}: ${count}</span>`;
  }
  dom.detectionSummary.innerHTML = html;
}

function appendInference(event) {
  const emptyState = dom.inferenceLog.querySelector('div');
  if (emptyState) dom.inferenceLog.innerHTML = '';

  const context = event.context || (event.stream ? 'rtmp' : 'rtsp');
  const source = event.pipeline || event.stream || 'unknown';
  const badgeClass = context === 'rtmp'
    ? 'badge bg-purple-600/20 text-purple-200 border-purple-500/30'
    : context === 'onvif'
      ? 'badge bg-blue-600/20 text-blue-200 border-blue-500/30'
      : 'badge bg-slate-800/80 text-slate-200 border-slate-600/40';

  const data = event.data || {};
  const detections = data.detections || [];
  const detectionCount = data.detectionCount || detections.length;
  const summary = data.detectionSummary || {};
  
  // Update detection overlay if this is for the current preview
  if (state.previewKey && (source === state.previewKey.split(':')[1] || source === state.previewKey)) {
    currentDetections = detections;
    updateDetectionSummary(summary);
    drawDetectionsOnVideo();
  }
  
  // Build detection summary badges
  let summaryHtml = '';
  if (Object.keys(summary).length > 0) {
    summaryHtml = '<div class="flex flex-wrap gap-2 mt-2">';
    for (const [className, count] of Object.entries(summary)) {
      summaryHtml += `<span class="chip bg-blue-600/20 text-blue-200 border-blue-500/30 text-xs">${className}: ${count}</span>`;
    }
    summaryHtml += '</div>';
  }

  // Build detections list
  let detectionsHtml = '';
  if (detections.length > 0) {
    detectionsHtml = '<div class="mt-3 space-y-2">';
    detections.slice(0, 5).forEach(det => {
      const confPercent = Math.round((det.confidence || 0) * 100);
      detectionsHtml += `
        <div class="flex items-center justify-between rounded bg-slate-800/40 px-3 py-2 text-xs">
          <div class="flex items-center gap-2">
            <span class="font-medium text-slate-200">${det.class_name || 'Unknown'}</span>
            <span class="text-slate-400">${confPercent}%</span>
          </div>
          <div class="text-slate-500 text-[10px]">
            ${det.bbox ? `(${Math.round(det.bbox.x1)}, ${Math.round(det.bbox.y1)})` : ''}
          </div>
        </div>
      `;
    });
    if (detections.length > 5) {
      detectionsHtml += `<div class="text-xs text-slate-500 text-center pt-1">+${detections.length - 5} more</div>`;
    }
    detectionsHtml += '</div>';
  }

  const article = document.createElement('article');
  article.className = 'border-b border-slate-800/70 px-6 py-5 hover:bg-slate-900/40 transition';
  article.innerHTML = `
    <header class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <span class="${badgeClass}">${source}</span>
        <span class="text-xs text-slate-500">${new Date(event.timestamp).toLocaleTimeString()}</span>
        ${detectionCount > 0 ? `<span class="chip bg-emerald-600/20 text-emerald-200 border-emerald-500/30 text-xs">${detectionCount} detected</span>` : ''}
      </div>
      <span class="text-xs text-slate-500">${event.segment}</span>
    </header>
    ${summaryHtml}
    ${detectionsHtml}
    ${data.fps ? `<div class="mt-3 text-xs text-slate-400">FPS: ${data.fps.toFixed(1)} | Status: ${data.statusDescription || 'OK'}</div>` : ''}
    <details class="mt-3">
      <summary class="cursor-pointer text-xs text-slate-400 hover:text-slate-300">View raw data</summary>
      <pre class="mt-2 overflow-x-auto rounded-lg bg-black/60 p-4 text-xs text-emerald-200"><code>${JSON.stringify(data, null, 2)}</code></pre>
    </details>
  `;
  dom.inferenceLog.prepend(article);
  const items = dom.inferenceLog.querySelectorAll('article');
  if (items.length > 50) items[items.length - 1].remove();
}

function connectWebSocket() {
  let ws;
  let retry = 0;

  const setState = (status, message) => {
    const dot = dom.wsStatus.querySelector('span:first-child');
    const text = dom.wsStatus.querySelector('span:nth-child(2)');
    if (dot) {
      const colors = { connected: 'bg-emerald-500', connecting: 'bg-amber-400', closed: 'bg-red-500' };
      dot.className = `status-dot ${colors[status] || 'bg-slate-500'}`;
    }
    if (text) text.textContent = message;
  };

  const open = () => {
    ws = new WebSocket(`${WS_BASE}/events`);
    setState('connecting', 'Connecting…');

    ws.onopen = () => {
      retry = 0;
      setState('connected', 'Live');
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'inference-result') {
          appendInference(payload);
        }
      } catch (err) {
        console.warn('Failed to parse ws payload', err);
      }
    };

    ws.onclose = () => {
      setState('closed', 'Disconnected');
      if (retry < 5) {
        setTimeout(open, Math.min(5000, 1000 * 2 ** retry));
        retry += 1;
      }
    };

    ws.onerror = (err) => {
      console.error('WS error', err);
      ws.close();
    };
  };

  open();
}

function handleAction(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;

  const name = btn.dataset.name;
  const context = btn.dataset.context;
  const action = btn.dataset.action;

  if (action === 'preview') {
    setPreviewSource(btn.dataset.manifestUrl, btn.dataset.label, `${context}:${name}`);
    if (dom.previewSelect) dom.previewSelect.value = `${context}:${name}`;
    return;
  }

  btn.disabled = true;
  (async () => {
    if (context === 'pipeline') {
      if (action === 'stop') {
        await fetchJson(`/pipelines/${encodeURIComponent(name)}`, { method: 'DELETE' });
        await loadPipelines();
      } else if (action === 'toggle-inference') {
        const enabled = btn.dataset.enabled === 'true';
        const path = enabled
          ? `/pipelines/${encodeURIComponent(name)}/inference`
          : `/pipelines/${encodeURIComponent(name)}/inference/start`;
        await fetchJson(path, { method: enabled ? 'DELETE' : 'POST', body: enabled ? null : JSON.stringify({}) });
        await loadPipelines();
      }
    }

    if (context === 'rtmp') {
      if (action === 'stop') {
        await fetchJson(`/ingest/rtmp/${encodeURIComponent(name)}`, { method: 'DELETE' });
        await loadRtmps();
      } else if (action === 'toggle-inference') {
        const enabled = btn.dataset.enabled === 'true';
        const path = enabled
          ? `/ingest/rtmp/${encodeURIComponent(name)}/inference`
          : `/ingest/rtmp/${encodeURIComponent(name)}/inference/start`;
        await fetchJson(path, { method: enabled ? 'DELETE' : 'POST', body: enabled ? null : JSON.stringify({}) });
        await loadRtmps();
      }
    }
  })()
    .catch((err) => alert(`Action failed: ${err.message}`))
    .finally(() => {
      btn.disabled = false;
    });
}

async function loadAvailableModels() {
  try {
    const data = await fetchJson('/halio/models/available');
    const select = document.getElementById('pipeline-model-select');
    if (select && data.models) {
      // Clear existing options except default
      while (select.children.length > 1) {
        select.removeChild(select.lastChild);
      }
      // Add model options
      data.models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.path;
        option.textContent = model.displayName;
        select.appendChild(option);
      });
    }
  } catch (err) {
    console.warn('Failed to load models:', err);
  }
}

function setupPipelineDialog() {
  if (!dom.pipelineDialog) return;
  const form = dom.pipelineDialog.querySelector('form');
  form.addEventListener('reset', () => {
    dom.pipelineModelField.hidden = true;
  });
  form.autoInfer.addEventListener('change', (event) => {
    dom.pipelineModelField.hidden = !event.target.checked;
    if (event.target.checked) {
      loadAvailableModels();
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      name: formData.get('name'),
      rtspUrl: formData.get('rtspUrl') || undefined,
      autoInfer: formData.get('autoInfer') === 'on',
    };
    // Use selected model or custom path
    const modelSelect = formData.get('modelPath');
    const modelCustom = formData.get('modelPathCustom');
    if (modelCustom) {
      payload.modelPath = modelCustom;
    } else if (modelSelect) {
      payload.modelPath = modelSelect;
    }

    try {
      await fetchJson('/pipelines/rtsp-to-hls', { method: 'POST', body: JSON.stringify(payload) });
      dom.pipelineDialog.close();
      form.reset();
      await loadPipelines();
    } catch (err) {
      alert(`Failed to create pipeline: ${err.message}`);
    }
  });

  dom.newPipeline?.addEventListener('click', () => {
    dom.pipelineDialog.showModal();
    loadAvailableModels();
  });
}

function setupIngestDialog() {
  if (!dom.ingestDialog) return;
  const form = dom.ingestDialog.querySelector('form');
  form.addEventListener('reset', () => {
    dom.ingestModelField.hidden = true;
  });
  form.autoInfer.addEventListener('change', (event) => {
    dom.ingestModelField.hidden = !event.target.checked;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      name: formData.get('name'),
      rtmpUrl: formData.get('rtmpUrl'),
      autoInfer: formData.get('autoInfer') === 'on',
    };
    const segmentTime = formData.get('segmentTime');
    if (segmentTime) payload.segmentTime = Number(segmentTime);
    const modelPath = formData.get('modelPath');
    if (modelPath) payload.modelPath = modelPath;

    try {
      await fetchJson('/ingest/rtmp', { method: 'POST', body: JSON.stringify(payload) });
      dom.ingestDialog.close();
      form.reset();
      await loadRtmps();
    } catch (err) {
      alert(`Failed to create ingest: ${err.message}`);
    }
  });

  dom.newIngest?.addEventListener('click', () => dom.ingestDialog.showModal());
}

function setupPreviewListeners() {
  // Redraw detections when video resizes or plays
  if (dom.previewPlayer) {
    dom.previewPlayer.addEventListener('loadedmetadata', drawDetectionsOnVideo);
    dom.previewPlayer.addEventListener('resize', drawDetectionsOnVideo);
    window.addEventListener('resize', drawDetectionsOnVideo);
    // Redraw periodically to keep detections visible
    setInterval(drawDetectionsOnVideo, 100);
  }
  
  if (dom.previewSelect) {
    dom.previewSelect.addEventListener('change', () => {
      const option = dom.previewSelect.selectedOptions[0];
      if (!option) {
        setPreviewSource(null);
        currentDetections = [];
        updateDetectionSummary({});
        return;
      }
      setPreviewSource(option.dataset.url, option.textContent.trim(), option.value);
    });
  }

  if (dom.previewPlayer) {
    dom.previewPlayer.crossOrigin = 'anonymous';
    dom.previewPlayer.addEventListener('error', () => {
      const error = dom.previewPlayer.error;
      if (dom.previewStatus) {
        dom.previewStatus.textContent = `Playback error: ${error?.message || 'Unknown error'}`;
        dom.previewStatus.className = 'mt-3 text-xs text-red-300';
      }
    });
    dom.previewPlayer.addEventListener('loadeddata', () => {
      if (dom.previewStatus && state.previewKey) {
        const option = dom.previewSelect?.selectedOptions[0];
        dom.previewStatus.textContent = `Streaming ${option?.textContent.trim() || state.previewKey}`;
        dom.previewStatus.className = 'mt-3 text-xs text-emerald-200';
      }
    });
  }
}

function initEventHandlers() {
  dom.refreshPipelines?.addEventListener('click', loadPipelines);
  dom.refreshRtmps?.addEventListener('click', loadRtmps);
  dom.pipelines?.addEventListener('click', handleAction);
  dom.rtmps?.addEventListener('click', handleAction);
}

async function init() {
  await loadStatus();
  await Promise.all([loadPipelines(), loadRtmps()]);
  setupPipelineDialog();
  setupIngestDialog();
  setupPreviewListeners();
  initEventHandlers();
  connectWebSocket();
}

init().catch((err) => console.error('Dashboard failed to initialise', err));
