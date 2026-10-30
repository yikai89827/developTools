// 屏幕录制（复刻自豆豆创作助手）
const { ipcRenderer } = require('electron');

function $(sel) { return document.querySelector(sel); }

const api = {
  getSettings: () => ipcRenderer.invoke('recorder:get-settings'),
  setSettings: (s) => ipcRenderer.invoke('recorder:set-settings', s),
  showOpenDialog: () => ipcRenderer.invoke('recorder:show-open-dialog'),
  selectRegion: () => ipcRenderer.invoke('recorder:select-region'),
  startFfmpeg: (p) => ipcRenderer.invoke('recorder:start-ffmpeg', p),
  stopFfmpeg: () => ipcRenderer.invoke('recorder:stop-ffmpeg'),
  startUI: () => ipcRenderer.invoke('recorder:start-ui'),
  stopUI: () => ipcRenderer.invoke('recorder:stop-ui'),
  updateTime: (elapsed) => ipcRenderer.invoke('recorder:update-time', elapsed),
  toggleCamera: () => ipcRenderer.invoke('recorder:toggle-camera'),
};

let recorderState = {
  isRecording: false,
  recordingFilePath: null,
  recordingTimer: null,
  previewUrl: null,
};

let recorderSettings = {
  audioSource: 'both',
  videoPath: '',
  fileNamePrefix: 'recording',
  enableWatermark: false,
  watermarkText: '豆豆开发者工具',
  hideAppWindow: true,
  quality: 'uhd',
  enableCamera: false,
};

function showToast(message, type = 'info') {
  let el = document.getElementById('recorder-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'recorder-toast';
    el.className = 'recorder-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), type === 'loading' ? 12000 : 2800);
}

async function loadRecorderSettings() {
  try {
    const settings = await api.getSettings();
    recorderSettings = { ...recorderSettings, ...settings };
    updateSettingsUI();
  } catch (e) {
    console.error('[screen-recorder] load settings failed:', e.message);
  }
}

async function saveRecorderSettings() {
  try {
    await api.setSettings(recorderSettings);
  } catch (e) {
    console.error('[screen-recorder] save settings failed:', e.message);
  }
}

function updateSettingsUI() {
  const audioSourceSelect = $('#recorder-audio-source');
  const videoPathInput = $('#recorder-video-path');
  const fileNameInput = $('#recorder-file-name');
  const qualitySelect = $('#recorder-quality');
  const enableCameraCheckbox = $('#recorder-enable-camera');
  const watermarkCheckbox = $('#recorder-enable-watermark');
  const watermarkTextInput = $('#recorder-watermark-text');
  const hideAppCheckbox = $('#recorder-hide-app');

  if (audioSourceSelect) audioSourceSelect.value = recorderSettings.audioSource;
  if (videoPathInput) videoPathInput.value = recorderSettings.videoPath;
  if (fileNameInput) fileNameInput.value = recorderSettings.fileNamePrefix;
  if (qualitySelect) qualitySelect.value = recorderSettings.quality || 'uhd';
  if (enableCameraCheckbox) enableCameraCheckbox.checked = !!recorderSettings.enableCamera;
  if (watermarkCheckbox) watermarkCheckbox.checked = !!recorderSettings.enableWatermark;
  if (watermarkTextInput) {
    watermarkTextInput.value = recorderSettings.watermarkText || '豆豆开发者工具';
    watermarkTextInput.disabled = recorderState.isRecording;
  }
  if (hideAppCheckbox) hideAppCheckbox.checked = recorderSettings.hideAppWindow !== false;
}

async function selectVideoPath() {
  try {
    const dir = await api.showOpenDialog();
    if (dir) {
      recorderSettings.videoPath = dir;
      $('#recorder-video-path').value = dir;
      await saveRecorderSettings();
    }
  } catch (e) {
    showToast('选择目录失败: ' + e.message, 'err');
  }
}

async function startRecording() {
  if (recorderState.isRecording) {
    showToast('正在录制中', 'warn');
    return;
  }
  if (!recorderSettings.videoPath) {
    showToast('请先设置视频保存路径', 'warn');
    return;
  }

  const watermarkTextInput = $('#recorder-watermark-text');
  if (watermarkTextInput) {
    recorderSettings.watermarkText = watermarkTextInput.value.trim() || '豆豆开发者工具';
    watermarkTextInput.value = recorderSettings.watermarkText;
    await saveRecorderSettings();
  }

  try {
    let regionResult;
    try {
      regionResult = await api.selectRegion();
    } catch (e) {
      showToast('区域选择失败: ' + e.message, 'err');
      return;
    }
    if (!regionResult) {
      showToast('已取消选择录制区域', 'info');
      return;
    }

    const { bounds, fullscreen } = regionResult;
    const enableWatermark = !!recorderSettings.enableWatermark;
    const rawWatermarkText = (recorderSettings.watermarkText || '').trim();
    if (enableWatermark && !rawWatermarkText) {
      showToast('请填写水印文字', 'warn');
      return;
    }
    const watermarkText = rawWatermarkText || '豆豆开发者工具';

    let res;
    try {
      res = await api.startFfmpeg({
        bounds,
        fullscreen,
        enableWatermark,
        watermarkText,
        quality: recorderSettings.quality || 'uhd',
      });
    } catch (e) {
      showToast('开始录制失败: ' + e.message, 'err');
      try { await api.stopUI(); } catch (_) { /* ignore */ }
      return;
    }

    recorderState.isRecording = true;
    recorderState.recordingFilePath = res.filePath;
    await api.startUI();

    const startTime = Date.now();
    recorderState.recordingTimer = setInterval(() => {
      if (!recorderState.isRecording) {
        clearInterval(recorderState.recordingTimer);
        return;
      }
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      updateRecordingTime(elapsed);
      api.updateTime(elapsed).catch(() => {});
    }, 1000);

    updateRecordingUI();
    if (res.audioDevices && res.audioDevices.length > 0) {
      showToast(enableWatermark ? '开始录制（已开启动态水印）' : '开始录制', 'success');
    } else {
      showToast(enableWatermark ? '开始录制（已开水印，未检测到音频设备）' : '开始录制（未检测到音频，仅画面）', 'warn');
    }
  } catch (e) {
    showToast('开始录制失败: ' + e.message, 'err');
  }
}

async function stopRecording() {
  if (!recorderState.isRecording) {
    showToast('未在录制', 'warn');
    return;
  }
  try {
    recorderState.isRecording = false;
    if (recorderState.recordingTimer) {
      clearInterval(recorderState.recordingTimer);
      recorderState.recordingTimer = null;
    }
    showToast('正在保存录制文件...', 'loading');
    const filePath = await api.stopFfmpeg();
    await api.stopUI();
    updateRecordingTime(0);
    updateRecordingUI();
    if (filePath) {
      previewRecording(filePath);
      showToast('录制完成', 'success');
    } else {
      showToast('录制已停止', 'info');
    }
  } catch (e) {
    showToast('停止录制失败: ' + e.message, 'err');
    try { await api.stopUI(); } catch (_) { /* ignore */ }
    updateRecordingUI();
  }
}

function previewRecording(filePath) {
  const videoEl = $('#recorder-preview-video');
  const placeholderEl = $('#recorder-video-placeholder');
  const filenameEl = $('#recorder-preview-filename');
  if (!videoEl) return;

  if (recorderState.previewUrl) {
    URL.revokeObjectURL(recorderState.previewUrl);
    recorderState.previewUrl = null;
  }

  const previewUrl = 'file:///' + filePath.replace(/\\/g, '/') + '?t=' + Date.now();
  videoEl.src = previewUrl;
  videoEl.classList.add('visible');
  videoEl.load();
  if (placeholderEl) placeholderEl.classList.add('hidden');
  if (filenameEl) {
    filenameEl.textContent = filePath.split(/[\\/]/).pop();
    filenameEl.title = filePath;
  }
  videoEl.play().catch(() => {});
}

function updateRecordingUI() {
  const startBtn = $('#btn-recorder-start');
  const stopBtn = $('#btn-recorder-stop');
  const statusEl = $('#recorder-status');
  const qualitySelect = $('#recorder-quality');
  const enableCameraCheckbox = $('#recorder-enable-camera');
  const cameraPreviewBtn = $('#btn-recorder-camera-preview');
  const watermarkCheckbox = $('#recorder-enable-watermark');
  const watermarkTextInput = $('#recorder-watermark-text');
  const hideAppCheckbox = $('#recorder-hide-app');

  if (recorderState.isRecording) {
    startBtn?.classList.add('hidden');
    stopBtn?.classList.remove('hidden');
    if (qualitySelect) qualitySelect.disabled = true;
    if (enableCameraCheckbox) enableCameraCheckbox.disabled = true;
    if (cameraPreviewBtn) cameraPreviewBtn.disabled = true;
    if (watermarkCheckbox) watermarkCheckbox.disabled = true;
    if (watermarkTextInput) watermarkTextInput.disabled = true;
    if (hideAppCheckbox) hideAppCheckbox.disabled = true;
    if (statusEl) {
      statusEl.textContent = '录制中...';
      statusEl.className = 'recorder-status recording';
    }
  } else {
    startBtn?.classList.remove('hidden');
    stopBtn?.classList.add('hidden');
    if (qualitySelect) qualitySelect.disabled = false;
    if (enableCameraCheckbox) enableCameraCheckbox.disabled = false;
    if (cameraPreviewBtn) cameraPreviewBtn.disabled = false;
    if (watermarkCheckbox) watermarkCheckbox.disabled = false;
    if (watermarkTextInput) watermarkTextInput.disabled = false;
    if (hideAppCheckbox) hideAppCheckbox.disabled = false;
    if (statusEl) {
      statusEl.textContent = '就绪';
      statusEl.className = 'recorder-status ready';
    }
  }
}

function updateRecordingTime(elapsed) {
  const timeEl = $('#recorder-time');
  if (!timeEl) return;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  timeEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function bindEvents() {
  $('#btn-recorder-start')?.addEventListener('click', startRecording);
  $('#btn-recorder-stop')?.addEventListener('click', stopRecording);
  $('#btn-recorder-select-path')?.addEventListener('click', selectVideoPath);

  $('#recorder-audio-source')?.addEventListener('change', async (e) => {
    recorderSettings.audioSource = e.target.value;
    await saveRecorderSettings();
  });
  $('#recorder-file-name')?.addEventListener('change', async (e) => {
    recorderSettings.fileNamePrefix = e.target.value;
    await saveRecorderSettings();
  });
  $('#recorder-quality')?.addEventListener('change', async (e) => {
    recorderSettings.quality = e.target.value;
    await saveRecorderSettings();
  });
  $('#recorder-enable-camera')?.addEventListener('change', async (e) => {
    recorderSettings.enableCamera = e.target.checked;
    await saveRecorderSettings();
  });
  $('#btn-recorder-camera-preview')?.addEventListener('click', async () => {
    try {
      await api.toggleCamera();
    } catch (e) {
      showToast('摄像头预览失败: ' + e.message, 'err');
    }
  });
  $('#recorder-enable-watermark')?.addEventListener('change', async (e) => {
    recorderSettings.enableWatermark = e.target.checked;
    await saveRecorderSettings();
  });
  $('#recorder-watermark-text')?.addEventListener('change', async (e) => {
    recorderSettings.watermarkText = e.target.value.trim() || '豆豆开发者工具';
    e.target.value = recorderSettings.watermarkText;
    await saveRecorderSettings();
  });
  $('#recorder-watermark-text')?.addEventListener('input', (e) => {
    recorderSettings.watermarkText = e.target.value;
  });
  $('#recorder-hide-app')?.addEventListener('change', async (e) => {
    recorderSettings.hideAppWindow = e.target.checked;
    await saveRecorderSettings();
  });

  ipcRenderer.on('recorder:stop-recording', () => {
    stopRecording();
  });
}

function initScreenRecorder() {
  if (!$('#recorder-tool')) return;
  loadRecorderSettings();
  bindEvents();
}

module.exports = { initScreenRecorder };
