const {
  BrowserWindow,
  screen,
  desktopCapturer,
  ipcMain,
  app,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let regionSelectWins = []; // 多屏：每块显示器一个框选覆盖层
let recordingWin = null;
let cameraWin = null;
let isRecording = false;
let recordingSettings = {
  audioSource: 'both',
  videoPath: path.join(os.homedir(), 'Documents', 'DevTools', 'Recordings'),
  fileNamePrefix: 'recording',
  enableWatermark: false,
  watermarkText: '豆豆开发者工具',
  hideAppWindow: true,
  quality: 'uhd',
  enableCamera: false,
  cameraBounds: null,
};

// 画质预设：maxWidth/maxHeight 为输出上限（不会超分），crf 越小画质越高
const QUALITY_PRESETS = {
  '4k':  { label: '4K (2160p)',   maxWidth: 3840, maxHeight: 2160, crf: 18 },
  '2k':  { label: '2K (1440p)',   maxWidth: 2560, maxHeight: 1440, crf: 20 },
  'uhd': { label: '超清 (1080p)', maxWidth: 1920, maxHeight: 1080, crf: 20 },
  'hd':  { label: '高清 (720p)',  maxWidth: 1280, maxHeight: 720,  crf: 23 },
  'sd':  { label: '标清 (480p)',  maxWidth: 854,  maxHeight: 480,  crf: 26 },
};

// 根据采集分辨率与画质预设计算目标输出尺寸（不超分，保持宽高比，保证偶数维度）
function computeTargetDimensions(srcW, srcH, preset) {
  let targetW = srcW;
  let targetH = srcH;
  if (targetW > preset.maxWidth) {
    targetW = preset.maxWidth;
    targetH = Math.round((targetW * srcH) / srcW);
  }
  if (targetH > preset.maxHeight) {
    targetH = preset.maxHeight;
    targetW = Math.round((targetH * srcW) / srcH);
  }
  targetW -= targetW % 2;
  targetH -= targetH % 2;
  return { targetW, targetH };
}
let selectRegionCallback = null;
let mainWindow = null;
let settingsFilePath = null;
let ffmpegProc = null;
let currentRecordingPath = null;
let watermarkTextFilePath = null;

function initSettingsFile() {
  const userDataPath = app.getPath('userData');
  settingsFilePath = path.join(userDataPath, 'recorder-settings.json');
  try {
    if (fs.existsSync(settingsFilePath)) {
      const saved = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
      recordingSettings = { ...recordingSettings, ...saved };
      console.log('[screenRecorder] 加载已保存的设置:', recordingSettings);
    }
  } catch (e) {
    console.warn('[screenRecorder] 加载设置文件失败:', e.message);
  }
}

function saveSettingsToFile() {
  if (!settingsFilePath) return;
  try {
    fs.writeFileSync(settingsFilePath, JSON.stringify(recordingSettings, null, 2));
  } catch (e) {
    console.warn('[screenRecorder] 保存设置文件失败:', e.message);
  }
}

function setMainWindow(window) {
  mainWindow = window;
}

function getTodayDateFolder() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generateFileName() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${recordingSettings.fileNamePrefix}-${timestamp}.mp4`;
}

function resolveFfmpegPath() {
  // 1. 用户自定义路径（环境变量）
  const envPath = process.env.DEVTOOLS_FFMPEG_PATH || process.env.WRITE_ASSISTANT_FFMPEG_PATH || '';
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  // 2. 工作区本地路径
  const localPath = path.join(__dirname, '../../ffmpeg/ffmpeg.exe');
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // 3. 优先尝试 ffmpeg-static 模块
  try {
    let ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
      if (ffmpegPath.includes('app.asar')) {
        ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
      }
      return ffmpegPath;
    }
  } catch (e) {
    // ffmpeg-static 未安装
  }

  // 4. 常见系统路径
  const candidates = [
    // Trae IDE 内置
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Trae CN', 'resources', 'app', 'bin', 'ffmpeg.exe'),
    // 常见安装位置
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'ffmpeg.exe'),
    path.join(process.env.USERPROFILE || '', 'Chocolatey', 'bin', 'ffmpeg.exe'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      console.log('[screenRecorder] 使用本地 ffmpeg:', p);
      return p;
    }
  }

  // 5. 尝试 PATH 查找
  try {
    const { execSync } = require('child_process');
    const whereCmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    const result = execSync(whereCmd, { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0];
    if (result && fs.existsSync(result)) {
      console.log('[screenRecorder] PATH 中找到 ffmpeg:', result);
      return result;
    }
  } catch {
    // PATH 中没找到
  }

  console.warn('[screenRecorder] ffmpeg 不可用：未找到 ffmpeg 可执行文件。');
  console.warn('[screenRecorder] 解决方法: 1) npm install ffmpeg-static  2) 或设置环境变量 DEVTOOLS_FFMPEG_PATH  3) 或把 ffmpeg.exe 放入项目根目录的 ffmpeg/ 目录');
  return null;
}

let cachedCaptureType = null;

/**
 * 检测 ffmpeg 支持的桌面采集方式
 * 优先 dxgigrab（Desktop Duplication API，可捕获 GPU 覆盖层，解决微信截图黑屏）
 * 回退 gdigrab（GDI 采集）
 */
async function detectCaptureType() {
  if (cachedCaptureType) return cachedCaptureType;

  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    cachedCaptureType = 'gdigrab';
    return cachedCaptureType;
  }
  if (process.platform !== 'win32') {
    cachedCaptureType = 'gdigrab';
    return cachedCaptureType;
  }

  try {
    return await new Promise((resolve) => {
      const proc = spawn(ffmpegPath, ['-hide_banner', '-demuxers'], { windowsHide: true });
      let all = '';
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        try { proc.kill(); } catch (_) {}
        cachedCaptureType = result;
        console.log('[screenRecorder] 桌面采集方式检测结果:', result);
        resolve(result);
      };
      proc.stdout.on('data', (c) => { all += c.toString(); });
      proc.stderr.on('data', (c) => { all += c.toString(); });
      proc.on('error', () => finish('gdigrab'));
      proc.on('close', () => {
        if (/dxgigrab/i.test(all)) finish('dxgigrab');
        else finish('gdigrab');
      });
      setTimeout(() => finish(cachedCaptureType || 'gdigrab'), 3000);
    });
  } catch (e) {
    console.warn('[screenRecorder] 采集方式检测异常，回退 gdigrab:', e.message);
    cachedCaptureType = 'gdigrab';
    return cachedCaptureType;
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) {
      reject(new Error('ffmpeg 不可用'));
      return;
    }
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg 转换失败 (${code}): ${stderr.slice(-500)}`));
    });
  });
}

async function convertWebmToMp4(inputPath, outputPath) {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    throw new Error('ffmpeg 不可用，无法转换视频格式');
  }
  await runFfmpeg([
    '-y',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    // 明确标记为 bt709 SDR，避免播放器按 bt601 解读导致偏色
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '128k',
    outputPath,
  ]);
}

// 枚举当前可见的顶层窗口及其可视边界（按 Z 序，从上到下），
// 供录制区域选择界面在鼠标悬停时自动识别所在窗口轮廓。
function getVisibleWindows() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }

    const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WA_Win {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int i);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int a, out RECT r, int c);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int a, out int v, int c);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<string> Enum() {
    SetProcessDPIAware();
    var list = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      int len = GetWindowTextLength(h);
      if (len == 0) return true;
      int style = GetWindowLong(h, -16);
      if ((style & 0x10000000) == 0) return true; // WS_VISIBLE
      if ((style & 0x20000000) != 0) return true;  // WS_MINIMIZE
      int cloaked = 0;
      DwmGetWindowAttribute(h, 14, out cloaked, 4); // DWMWA_CLOAKED
      if (cloaked != 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(h, sb, sb.Capacity);
      RECT r;
      if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) {
        GetWindowRect(h, out r);
      }
      int w = r.Right - r.Left, hh = r.Bottom - r.Top;
      if (w < 40 || hh < 40) return true;
      list.Add(r.Left + "|" + r.Top + "|" + r.Right + "|" + r.Bottom + "|" + sb.ToString().Replace("|", " "));
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
[WA_Win]::Enum() | ForEach-Object { $_ }
`;

    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    );
    let stdout = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.on('error', () => resolve([]));
    proc.on('close', () => {
      const windows = [];
      for (const line of stdout.split(/\r?\n/)) {
        const parts = line.split('|');
        if (parts.length < 5) continue;
        const left = parseInt(parts[0], 10);
        const top = parseInt(parts[1], 10);
        const right = parseInt(parts[2], 10);
        const bottom = parseInt(parts[3], 10);
        if ([left, top, right, bottom].some((n) => Number.isNaN(n))) continue;
        windows.push({
          title: parts.slice(4).join('|'),
          left, top, right, bottom,
        });
      }
      resolve(windows);
    });
  });
}

function findDisplayById(displayId) {
  const id = Number(displayId);
  const displays = screen.getAllDisplays();
  return displays.find((d) => d.id === id) || screen.getPrimaryDisplay();
}

// 将物理像素窗口矩形转换为指定显示器覆盖层的局部 DIP 坐标
function getWindowsForOverlay(displayId) {
  return getVisibleWindows().then((windows) => {
    const display = findDisplayById(displayId);
    const b = display.bounds;
    const result = [];
    for (const w of windows) {
      let dip;
      try {
        dip = screen.screenToDipRect(null, {
          x: w.left,
          y: w.top,
          width: Math.max(1, w.right - w.left),
          height: Math.max(1, w.bottom - w.top),
        });
      } catch (_) {
        const scale = display.scaleFactor || 1;
        dip = {
          x: Math.round(w.left / scale),
          y: Math.round(w.top / scale),
          width: Math.round((w.right - w.left) / scale),
          height: Math.round((w.bottom - w.top) / scale),
        };
      }
      const x = Math.round(dip.x - b.x);
      const y = Math.round(dip.y - b.y);
      const width = Math.round(dip.width);
      const height = Math.round(dip.height);
      if (width < 20 || height < 20) continue;
      // 只保留与本屏相交的窗口
      if (x + width <= 0 || y + height <= 0 || x >= b.width || y >= b.height) continue;
      result.push({ x, y, width, height, title: w.title });
    }
    return result;
  });
}

/** DIP 矩形 → 虚拟桌面物理像素（支持负坐标副屏） */
function dipRectToPhysical(dipRect) {
  try {
    const phys = screen.dipToScreenRect(null, {
      x: Math.round(dipRect.x),
      y: Math.round(dipRect.y),
      width: Math.max(2, Math.round(dipRect.width)),
      height: Math.max(2, Math.round(dipRect.height)),
    });
    return {
      x: Math.round(phys.x),
      y: Math.round(phys.y),
      width: Math.round(phys.width),
      height: Math.round(phys.height),
    };
  } catch (_) {
    const display = screen.getDisplayMatching({
      x: Math.round(dipRect.x),
      y: Math.round(dipRect.y),
      width: Math.max(1, Math.round(dipRect.width)),
      height: Math.max(1, Math.round(dipRect.height)),
    });
    const scale = display.scaleFactor || 1;
    return {
      x: Math.round(dipRect.x * scale),
      y: Math.round(dipRect.y * scale),
      width: Math.round(dipRect.width * scale),
      height: Math.round(dipRect.height * scale),
    };
  }
}

function isRectOnPrimary(dipRect) {
  const primary = screen.getPrimaryDisplay().bounds;
  return (
    dipRect.x >= primary.x - 1 &&
    dipRect.y >= primary.y - 1 &&
    dipRect.x + dipRect.width <= primary.x + primary.width + 1 &&
    dipRect.y + dipRect.height <= primary.y + primary.height + 1
  );
}

// 枚举 DirectShow 音频输入设备名称（用于 ffmpeg 录音）
function enumerateDshowAudioDevices() {
  return new Promise((resolve) => {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) {
      resolve([]);
      return;
    }
    const proc = spawn(
      ffmpegPath,
      ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
      { windowsHide: true }
    );
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    proc.on('error', () => resolve([]));
    proc.on('close', () => {
      const devices = [];
      const re = /"([^"]+)"\s*\(audio\)/g;
      let m;
      while ((m = re.exec(stderr)) !== null) {
        devices.push(m[1]);
      }
      console.log('[screenRecorder] 检测到音频设备:', devices);
      resolve(devices);
    });
  });
}

// ffmpeg 滤镜路径转义（Windows 盘符冒号需写成 C\:）
function escapeFfmpegFilterPath(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/').replace(/:/g, '\\:');
}

// 解析可用于 drawtext 的中文字体路径（Windows，优先单文件 TTF）
function resolveWatermarkFontPath() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/msyhbd.ttc',
    'C:/Windows/Fonts/simsun.ttc',
    'C:/Windows/Fonts/simkai.ttf',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return escapeFfmpegFilterPath(candidate);
    }
  }
  return null;
}

// 将水印文字写入 UTF-8 临时文件，避免 Windows 命令行中文乱码导致方块
function prepareWatermarkTextFile(text) {
  cleanupWatermarkTextFile();
  const filePath = path.join(app.getPath('temp'), `wa-wm-${Date.now()}.txt`);
  const content = String(text || '').trim() || '豆豆开发者工具';
  fs.writeFileSync(filePath, `\uFEFF${content}`, 'utf8');
  watermarkTextFilePath = filePath;
  return filePath;
}

function cleanupWatermarkTextFile() {
  if (!watermarkTextFilePath) return;
  try {
    if (fs.existsSync(watermarkTextFilePath)) fs.unlinkSync(watermarkTextFilePath);
  } catch (_) {
    /* ignore */
  }
  watermarkTextFilePath = null;
}

// 构建随机动态位置的半透明文字水印滤镜
function buildWatermarkDrawtext(vidW, vidH, textFilePath) {
  if (!textFilePath) return null;
  const fontSize = Math.max(18, Math.round(Math.min(vidW, vidH) * 0.032));
  const margin = Math.max(16, Math.round(fontSize * 0.6));
  const interval = 45; // 约每 1.5 秒（30fps）变换一次位置
  const seedX = Math.floor(Math.random() * 80) + 20;
  const seedY = Math.floor(Math.random() * 80) + 20;
  const xExpr = `mod(floor(n/${interval})*${seedX + 97}+${seedX}\\,w-tw-${margin})`;
  const yExpr = `mod(floor(n/${interval})*${seedY + 131}+${seedY}\\,h-th-${margin})`;

  const fontPath = resolveWatermarkFontPath();
  if (!fontPath) {
    console.warn('[screenRecorder] 未找到中文字体文件，水印可能显示为方块');
  }
  const fontOpt = fontPath ? `fontfile='${fontPath}':` : '';
  const textOpt = `textfile='${escapeFfmpegFilterPath(textFilePath)}'`;
  return `${fontOpt}${textOpt}:fontsize=${fontSize}:fontcolor=white@0.35:x='${xExpr}':y='${yExpr}'`;
}

function buildVideoFilter(vidW, vidH, targetW, targetH, enableWatermark, textFilePath) {
  const parts = [];
  // 按画质预设缩放到目标尺寸（不超分时 target 即采集尺寸，此时跳过缩放）
  if (targetW !== vidW || targetH !== vidH) {
    parts.push(`scale=${targetW}:${targetH}:flags=lanczos`);
  }
  parts.push('scale=out_color_matrix=bt709:out_range=tv');
  if (enableWatermark) {
    const wm = buildWatermarkDrawtext(targetW, targetH, textFilePath);
    if (wm) parts.push(`drawtext=${wm}`);
  }
  parts.push('format=yuv420p');
  return parts.join(',');
}

// 使用 ffmpeg gdigrab 直接采集桌面（RGB，无 HDR/宽色域偏色问题），dshow 采集音频
async function startFfmpegRecording({ bounds, fullscreen, enableWatermark = false, watermarkText = '', quality = 'uhd' }) {
  console.log('[screenRecorder] === 开始录制流程 ===');
  console.log('[screenRecorder] 入参:', {
    fullscreen,
    bounds: bounds ? { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height } : null,
    enableWatermark,
    watermarkText: watermarkText ? watermarkText.slice(0, 20) : '',
    quality,
    audioSource: recordingSettings.audioSource,
    videoPath: recordingSettings.videoPath,
    fileNamePrefix: recordingSettings.fileNamePrefix,
    hideAppWindow: recordingSettings.hideAppWindow,
    enableCamera: recordingSettings.enableCamera,
  });

  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    console.error('[screenRecorder] ❌ ffmpeg 路径解析失败，无法录制');
    throw new Error('ffmpeg 不可用');
  }
  console.log('[screenRecorder] ffmpeg 路径:', ffmpegPath);
  if (ffmpegProc) {
    console.warn('[screenRecorder] ❌ 已有录制进行中，拒绝重复启动');
    throw new Error('已有录制进行中');
  }

  // bounds 为虚拟桌面 DIP 坐标（可跨屏、可负坐标）；fullscreen 表示整块目标屏
  const primary = screen.getPrimaryDisplay();
  let dipRect = null;
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    dipRect = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  } else {
    dipRect = { ...primary.bounds };
  }

  const phys = dipRectToPhysical(dipRect);
  let offsetX = phys.x;
  let offsetY = phys.y;
  let vidW = phys.width;
  let vidH = phys.height;
  vidW -= vidW % 2;
  vidH -= vidH % 2;
  if (vidW < 2) vidW = 2;
  if (vidH < 2) vidH = 2;

  console.log('[screenRecorder] 采集区域 DIP=', dipRect, '物理像素=', { offsetX, offsetY, vidW, vidH });

  // 根据画质预设计算输出尺寸（不超分）
  const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.uhd;
  const { targetW, targetH } = computeTargetDimensions(vidW, vidH, preset);
  console.log('[screenRecorder] 画质配置:', {
    quality,
    preset: { maxWidth: preset.maxWidth, maxHeight: preset.maxHeight, crf: preset.crf },
    采集尺寸: `${vidW}x${vidH}`,
    输出尺寸: `${targetW}x${targetH}`,
    是否缩放: targetW !== vidW || targetH !== vidH,
  });

  let wmTextFile = null;
  if (enableWatermark) {
    wmTextFile = prepareWatermarkTextFile(watermarkText);
    console.log('[screenRecorder] 水印配置:', {
      textFile: wmTextFile,
      font: resolveWatermarkFontPath(),
      text: String(watermarkText || '').trim() || '豆豆开发者工具',
    });
  } else {
    console.log('[screenRecorder] 水印: 未启用');
  }

  // dxgigrab 默认只抓主输出；副屏 / 跨屏区域改用 gdigrab（支持虚拟桌面负坐标）
  let captureType = await detectCaptureType();
  if (!isRectOnPrimary(dipRect)) {
    console.log('[screenRecorder] 目标区域不在主屏，强制使用 gdigrab 以支持多显示器');
    captureType = 'gdigrab';
  }
  console.log('[screenRecorder] 使用视频采集方式:', captureType,
    captureType === 'dxgigrab' ? '（支持 GPU/覆盖层）' : '（GDI，兼容多屏）');

  const args = ['-hide_banner', '-y'];
  if (captureType === 'dxgigrab') {
    // dxgigrab: 仅主屏可靠；区域用 crop（相对主屏物理原点）
    args.push('-f', 'dxgigrab', '-framerate', '30', '-draw_mouse', '1');
    args.push('-i', 'desktop');
    const primaryPhys = dipRectToPhysical(primary.bounds);
    const cx = Math.max(0, offsetX - primaryPhys.x);
    const cy = Math.max(0, offsetY - primaryPhys.y);
    if (cx !== 0 || cy !== 0 || vidW !== primaryPhys.width || vidH !== primaryPhys.height) {
      console.log('[screenRecorder] dxgigrab 区域模式: crop', { cx, cy, vidW, vidH });
      args.__crop = `crop=${vidW}:${vidH}:${cx}:${cy}`;
    }
  } else {
    // gdigrab：offset 使用虚拟桌面物理坐标，副屏可为负
    args.push('-f', 'gdigrab', '-framerate', '30', '-draw_mouse', '1');
    args.push('-offset_x', String(offsetX), '-offset_y', String(offsetY));
    args.push('-video_size', `${vidW}x${vidH}`, '-i', 'desktop');
  }

  const audioDevices = await enumerateDshowAudioDevices();
  console.log('[screenRecorder] 检测到的 DirectShow 音频设备:', audioDevices);
  const src = recordingSettings.audioSource;
  const chosen = [];
  const findMic = () => audioDevices.find((n) => /microphone|麦克风|麦|mic/i.test(n));
  const findSys = () => audioDevices.find((n) => /stereo mix|立体声混音|混音|loopback/i.test(n));
  if (src === 'microphone' || src === 'both') {
    const d = findMic();
    if (d) chosen.push(d);
    else console.warn('[screenRecorder] ⚠️ 未找到麦克风设备 (audioSource=' + src + ')');
  }
  if (src === 'system' || src === 'both') {
    const d = findSys();
    if (d && !chosen.includes(d)) chosen.push(d);
    else console.warn('[screenRecorder] ⚠️ 未找到系统音频设备 (audioSource=' + src + ')');
  }
  chosen.forEach((name) => args.push('-f', 'dshow', '-i', `audio=${name}`));
  console.log('[screenRecorder] 选择的音频设备:', chosen, '(audioSource=' + src + ')');

  if (chosen.length >= 2) {
    args.push('-filter_complex', '[1:a][2:a]amix=inputs=2:duration=longest[aout]');
    args.push('-map', '0:v', '-map', '[aout]');
  } else if (chosen.length === 1) {
    args.push('-map', '0:v', '-map', '1:a');
  } else {
    args.push('-map', '0:v');
    console.log('[screenRecorder] 无音频输入，仅录制视频');
  }

  // 视频滤镜链：dxgigrab 区域模式先 crop，再缩放/水印/格式转换
  // gdigrab 输出 RGB（full range）；显式按 bt709 limited 转换为 yuv420p，并打上一致的色彩标签
  const vfParts = [];
  if (args.__crop) {
    vfParts.push(args.__crop);
    delete args.__crop;
  }
  // 注意：dxgigrab 是全屏采集，当区域录制时先 crop，之后尺寸已是 vidW×vidH
  // 所以 buildVideoFilter 的源尺寸应该用当前实际流尺寸
  const srcW = captureType === 'dxgigrab' && !fullscreen ? vidW : vidW;
  const srcH = captureType === 'dxgigrab' && !fullscreen ? vidH : vidH;
  vfParts.push(buildVideoFilter(srcW, srcH, targetW, targetH, enableWatermark, wmTextFile));
  args.push('-vf', vfParts.filter(Boolean).join(','));
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(preset.crf), '-pix_fmt', 'yuv420p');
  args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
  if (chosen.length > 0) args.push('-c:a', 'aac', '-b:a', '128k');
  args.push('-movflags', '+faststart');

  const outputDir = path.join(recordingSettings.videoPath, getTodayDateFolder());
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, generateFileName());
  args.push(filePath);
  console.log('[screenRecorder] 输出目录:', outputDir);
  console.log('[screenRecorder] 输出文件:', filePath);

  console.log('[screenRecorder] 启动 ffmpeg 进程, 参数:', args.join(' '));
  const proc = spawn(ffmpegPath, args, { windowsHide: true });
  console.log('[screenRecorder] ffmpeg 进程已启动, PID:', proc.pid);
  let stderr = '';
  proc.stderr.on('data', (c) => {
    stderr += c.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-4000);
  });
  proc.on('error', (e) => console.error('[screenRecorder] ❌ ffmpeg 进程错误:', e.message));
  proc.on('close', (code) => {
    console.log('[screenRecorder] ffmpeg 进程退出, 退出码:', code, '(PID:', proc.pid + ')');
    if (code !== 0 && code !== 255) {
      console.error('[screenRecorder] ❌ ffmpeg 非正常退出, stderr 尾部:', stderr.slice(-1000));
    } else {
      console.log('[screenRecorder] ✅ ffmpeg 正常退出');
    }
    if (ffmpegProc === proc) ffmpegProc = null;
  });

  ffmpegProc = proc;
  currentRecordingPath = filePath;

  // 稍等片刻，若参数错误 ffmpeg 会立即退出
  console.log('[screenRecorder] 等待 400ms 确认 ffmpeg 是否正常启动...');
  await new Promise((r) => setTimeout(r, 400));
  if (proc.exitCode !== null && proc.exitCode !== 0) {
    console.error('[screenRecorder] ❌ ffmpeg 启动后立即退出, exitCode:', proc.exitCode);
    ffmpegProc = null;
    currentRecordingPath = null;
    cleanupWatermarkTextFile();
    throw new Error('ffmpeg 启动失败: ' + stderr.slice(-300));
  }
  console.log('[screenRecorder] ✅ ffmpeg 录制已启动, PID:', proc.pid, '文件:', filePath);
  console.log('[screenRecorder] === 录制启动流程结束 ===');
  return { filePath, audioDevices: chosen };
}

function stopFfmpegRecording() {
  console.log('[screenRecorder] === 停止录制流程开始 ===');
  return new Promise((resolve) => {
    if (!ffmpegProc) {
      console.warn('[screenRecorder] ⚠️ 无正在运行的 ffmpeg 进程，直接返回文件路径:', currentRecordingPath);
      resolve(currentRecordingPath);
      return;
    }
    const proc = ffmpegProc;
    const filePath = currentRecordingPath;
    console.log('[screenRecorder] 准备停止 ffmpeg, PID:', proc.pid, '文件:', filePath);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ffmpegProc = null;
      currentRecordingPath = null;
      cleanupWatermarkTextFile();
      console.log('[screenRecorder] ✅ 停止录制完成, 文件:', filePath);
      console.log('[screenRecorder] === 停止录制流程结束 ===');
      resolve(filePath);
    };
    proc.on('close', (code) => {
      console.log('[screenRecorder] 停止时收到 ffmpeg close 事件, 退出码:', code);
      finish();
    });
    try {
      console.log('[screenRecorder] 向 ffmpeg stdin 发送 "q" 优雅停止...');
      proc.stdin.write('q');
      proc.stdin.end();
    } catch (e) {
      console.warn('[screenRecorder] ⚠️ 发送 q 失败:', e.message, '将等待超时强杀');
    }
    // 兜底：8 秒仍未退出则强制结束（可能导致文件未正常收尾）
    setTimeout(() => {
      if (!done) {
        console.warn('[screenRecorder] ⚠️ 8 秒超时仍未退出，强制 kill ffmpeg 进程, PID:', proc.pid);
        try { proc.kill(); } catch (_) { /* ignore */ }
        finish();
      }
    }, 8000);
  });
}

async function getScreenSources() {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 1920, height: 1080 },
  });
  return sources;
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
}

function openRegionSelectWindow(onSelect) {
  if (regionSelectWins.some(({ win }) => win && !win.isDestroyed())) {
    regionSelectWins.forEach(({ win }) => {
      if (win && !win.isDestroyed()) win.focus();
    });
    return;
  }

  selectRegionCallback = onSelect;
  if (recordingSettings.hideAppWindow) {
    hideMainWindow();
  }

  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  regionSelectWins = [];

  displays.forEach((display) => {
    const { x, y, width, height } = display.bounds;
    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload-recording-overlay.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    try {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch (_) { /* ignore */ }

    win.loadFile(path.join(__dirname, '../../recorder/recording-overlay.html'), {
      query: { displayId: String(display.id) },
    });

    win.webContents.on('did-finish-load', () => {
      if (display.id === primaryId) {
        win.show();
        win.focus();
      } else {
        win.showInactive();
      }
    });

    win.on('closed', () => {
      const stillTracked = regionSelectWins.some((item) => item.win === win);
      regionSelectWins = regionSelectWins.filter((item) => item.win !== win);
      // 用户关掉任一屏覆盖层时，取消整次框选（程序主动 close 前会先清空列表）
      if (stillTracked && selectRegionCallback) {
        const cb = selectRegionCallback;
        selectRegionCallback = null;
        closeRegionSelectWindow();
        cb(null);
      }
    });

    regionSelectWins.push({ win, displayId: display.id });
  });
}

function closeRegionSelectWindow() {
  const wins = regionSelectWins.slice();
  regionSelectWins = [];
  wins.forEach(({ win }) => {
    if (win && !win.isDestroyed()) {
      try { win.close(); } catch (_) { /* ignore */ }
    }
  });
}

function openRecordingIndicator() {
  if (recordingWin && !recordingWin.isDestroyed()) {
    recordingWin.close();
  }

  const displays = screen.getAllDisplays();
  const primaryDisplay = displays[0];
  const screenWidth = primaryDisplay.bounds.width;
  const workAreaHeight = primaryDisplay.workAreaSize.height;
  const taskbarHeight = primaryDisplay.bounds.height - workAreaHeight;

  recordingWin = new BrowserWindow({
    width: 180,
    height: 32,
    x: screenWidth - 200,
    y: 50,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    acceptFirstMouse: false,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-recorder.js'),
    },
  });

  // 提高层级到 screen-saver 级别，高于普通窗口和微信截图界面
  try {
    recordingWin.setAlwaysOnTop(true, 'screen-saver');
    recordingWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Windows 下 setSkipTaskbar 为 true 也可进一步提升
  } catch (e) {
    console.warn('[screenRecorder] 提升悬浮窗层级失败：', e.message);
  }

  recordingWin.loadFile(path.join(__dirname, '../../recorder/recording-indicator.html'));

  recordingWin.on('closed', () => {
    recordingWin = null;
  });
}

function closeRecordingIndicator() {
  if (recordingWin && !recordingWin.isDestroyed()) {
    recordingWin.close();
    recordingWin = null;
  }
}

// ---- 摄像头悬浮窗 ----
let cameraBoundsSaveTimer = null;

function openCameraOverlay() {
  if (cameraWin && !cameraWin.isDestroyed()) {
    cameraWin.focus();
    return;
  }

  const primaryDisplay = screen.getAllDisplays()[0];
  const defaultW = 320;
  const defaultH = 240;
  const margin = 20;

  // 从持久化设置恢复位置/大小，否则默认右下角
  let bounds = recordingSettings.cameraBounds;
  if (!bounds || typeof bounds.x !== 'number') {
    bounds = {
      x: primaryDisplay.bounds.x + primaryDisplay.bounds.width - defaultW - margin,
      y: primaryDisplay.bounds.y + primaryDisplay.bounds.height - defaultH - margin,
      width: defaultW,
      height: defaultH,
    };
  }

  cameraWin = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 160,
    minHeight: 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  cameraWin.loadFile(path.join(__dirname, '../../recorder/camera-overlay.html'));

  // 防抖保存窗口位置/大小
  const saveCameraBounds = () => {
    if (cameraBoundsSaveTimer) clearTimeout(cameraBoundsSaveTimer);
    cameraBoundsSaveTimer = setTimeout(() => {
      if (!cameraWin || cameraWin.isDestroyed()) return;
      const b = cameraWin.getBounds();
      recordingSettings.cameraBounds = b;
      saveSettingsToFile();
    }, 500);
  };

  cameraWin.on('resize', saveCameraBounds);
  cameraWin.on('move', saveCameraBounds);

  cameraWin.on('closed', () => {
    cameraWin = null;
  });

  console.log('[screenRecorder] 摄像头悬浮窗已打开');
}

function closeCameraOverlay() {
  if (cameraWin && !cameraWin.isDestroyed()) {
    cameraWin.close();
    cameraWin = null;
  }
}

function isCameraOverlayOpen() {
  return !!(cameraWin && !cameraWin.isDestroyed());
}

function updateRecordingTime(elapsedSeconds) {
  if (recordingWin && !recordingWin.isDestroyed()) {
    recordingWin.webContents.send('recording:update-time', { elapsed: elapsedSeconds });
  }
}

function startRecordingUI() {
  isRecording = true;
  openRecordingIndicator();
  console.log('[screenRecorder] 开始录制');
}

function stopRecordingUI() {
  isRecording = false;
  closeRecordingIndicator();
  showMainWindow();
  console.log('[screenRecorder] 停止录制');
}

function sendRecordingTime(elapsedSeconds) {
  if (recordingWin && !recordingWin.isDestroyed()) {
    recordingWin.webContents.send('recording:update-time', { elapsed: elapsedSeconds });
  }
}

async function saveRecordingFile(buffer, mimeType = '') {
  const todayFolder = getTodayDateFolder();
  const outputDir = path.join(recordingSettings.videoPath, todayFolder);
  fs.mkdirSync(outputDir, { recursive: true });

  const fileName = generateFileName();
  const filePath = path.join(outputDir, fileName);
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  if (mimeType.includes('mp4')) {
    fs.writeFileSync(filePath, data);
    console.log(`[screenRecorder] 录制完成，保存到: ${filePath}`);
    return filePath;
  }

  const tempWebm = path.join(outputDir, `${fileName}.webm.tmp`);
  fs.writeFileSync(tempWebm, data);
  try {
    console.log('[screenRecorder] 正在转换为 MP4...');
    await convertWebmToMp4(tempWebm, filePath);
    console.log(`[screenRecorder] 录制完成，保存到: ${filePath}`);
    return filePath;
  } finally {
    try {
      fs.unlinkSync(tempWebm);
    } catch (_) {
      /* ignore */
    }
  }
}

function setRecordingSettings(settings) {
  recordingSettings = { ...recordingSettings, ...settings };
  fs.mkdirSync(recordingSettings.videoPath, { recursive: true });
  saveSettingsToFile();
  console.log('[screenRecorder] 设置已更新:', recordingSettings);
}

function getRecordingSettings() {
  return { ...recordingSettings };
}

function registerIpcHandlers() {
  initSettingsFile();

  ipcMain.handle('recorder:get-screen-sources', async () => {
    return getScreenSources();
  });

  ipcMain.handle('recorder:start-ui', () => {
    console.log('[screenRecorder] [IPC] recorder:start-ui 被调用');
    isRecording = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setBackgroundThrottling(false);
    }
    openRecordingIndicator();
    console.log('[screenRecorder] 录制 UI 已启动（录制指示器已打开）');
    return true;
  });

  ipcMain.handle('recorder:request-stop', () => {
    console.log('[screenRecorder] [IPC] recorder:request-stop 被调用');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder:stop-recording');
    }
    closeRecordingIndicator();
    return true;
  });

  ipcMain.handle('recorder:stop-ui', async () => {
    console.log('[screenRecorder] [IPC] recorder:stop-ui 被调用');
    isRecording = false;
    closeRecordingIndicator();
    closeCameraOverlay();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setBackgroundThrottling(true);
      mainWindow.show();
      console.log('[screenRecorder] 主窗口已恢复显示');
    }
    console.log('[screenRecorder] 录制 UI 已停止');
    return true;
  });

  ipcMain.handle('recorder:update-time', (_, elapsedSeconds) => {
    sendRecordingTime(elapsedSeconds);
    return true;
  });

  ipcMain.handle('recorder:is-recording', () => isRecording);

  ipcMain.handle('recorder:select-region', async () => {
    console.log('[screenRecorder] [IPC] recorder:select-region 被调用，打开区域选择窗口');
    return new Promise((resolve) => {
      openRegionSelectWindow(resolve);
    });
  });

  ipcMain.handle('recorder:start-ffmpeg', async (_, payload) => {
    console.log('[screenRecorder] [IPC] recorder:start-ffmpeg 被调用, payload:', JSON.stringify({
      hasBounds: !!payload?.bounds,
      fullscreen: !!payload?.fullscreen,
      enableWatermark: !!payload?.enableWatermark,
      quality: payload?.quality,
    }));
    const bounds = payload?.bounds || null;
    const fullscreen = !!payload?.fullscreen;
    const enableWatermark = !!payload?.enableWatermark;
    const watermarkText = payload?.watermarkText || '';
    const quality = payload?.quality || recordingSettings.quality || 'uhd';
    try {
      const result = await startFfmpegRecording({ bounds, fullscreen, enableWatermark, watermarkText, quality });
      // 录制启动成功后，若启用了摄像头则自动打开悬浮窗
      if (recordingSettings.enableCamera) {
        console.log('[screenRecorder] 录制启动成功，自动打开摄像头悬浮窗');
        openCameraOverlay();
      } else {
        console.log('[screenRecorder] 摄像头未启用，跳过悬浮窗');
      }
      console.log('[screenRecorder] [IPC] recorder:start-ffmpeg 成功, 返回:', JSON.stringify({ filePath: result.filePath, audioDevices: result.audioDevices }));
      return result;
    } catch (e) {
      console.error('[screenRecorder] [IPC] recorder:start-ffmpeg 失败:', e.message);
      // 录制启动失败时恢复主窗口显示，避免用户感知为"闪退"
      showMainWindow();
      throw e;
    }
  });

  ipcMain.handle('recorder:stop-ffmpeg', async () => {
    console.log('[screenRecorder] [IPC] recorder:stop-ffmpeg 被调用');
    const result = await stopFfmpegRecording();
    console.log('[screenRecorder] [IPC] recorder:stop-ffmpeg 完成, 返回文件:', result);
    return result;
  });

  ipcMain.handle('recorder:toggle-camera', async () => {
    console.log('[screenRecorder] [IPC] recorder:toggle-camera 被调用');
    if (isCameraOverlayOpen()) {
      console.log('[screenRecorder] 摄像头悬浮窗已打开，执行关闭');
      closeCameraOverlay();
      return false;
    }
    console.log('[screenRecorder] 摄像头悬浮窗未打开，执行打开');
    openCameraOverlay();
    return true;
  });

  ipcMain.handle('recorder:close-camera', async () => {
    console.log('[screenRecorder] [IPC] recorder:close-camera 被调用');
    closeCameraOverlay();
    return true;
  });

  ipcMain.handle('recorder:camera-status', async () => {
    return isCameraOverlayOpen();
  });

  ipcMain.handle('recorder:get-windows', async (_event, displayId) => {
    try {
      return await getWindowsForOverlay(displayId);
    } catch (e) {
      console.warn('[screenRecorder] 获取窗口列表失败:', e.message);
      return [];
    }
  });

  ipcMain.handle('recorder:select-region-result', (_, payload) => {
    const { bounds, fullscreen, displayId } = payload || {};
    const display = findDisplayById(displayId);
    const cb = selectRegionCallback;
    selectRegionCallback = null;
    closeRegionSelectWindow();

    if (!cb) return true;

    // 「全屏」= 当前这块显示器整屏；区域 = 覆盖层局部坐标转虚拟桌面 DIP
    let result = { bounds: null, fullscreen: false, displayId: display.id };
    if (fullscreen) {
      result.bounds = {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        screenX: display.bounds.x,
        screenY: display.bounds.y,
        screenWidth: display.bounds.width,
        screenHeight: display.bounds.height,
        scaleFactor: display.scaleFactor,
      };
      result.fullscreen = true;
    } else if (bounds) {
      result.bounds = {
        x: display.bounds.x + Number(bounds.x || 0),
        y: display.bounds.y + Number(bounds.y || 0),
        width: Number(bounds.width || 0),
        height: Number(bounds.height || 0),
        screenX: display.bounds.x,
        screenY: display.bounds.y,
        screenWidth: display.bounds.width,
        screenHeight: display.bounds.height,
        scaleFactor: display.scaleFactor,
      };
    }
    console.log('[screenRecorder] 选区结果 displayId=', display.id, result.bounds);
    cb(result);
    return true;
  });

  ipcMain.handle('recorder:cancel-select-region', () => {
    const cb = selectRegionCallback;
    selectRegionCallback = null;
    closeRegionSelectWindow();
    if (cb) cb(null);
    showMainWindow();
    return true;
  });

  ipcMain.handle('recorder:set-settings', (_, settings) => {
    setRecordingSettings(settings);
    return true;
  });

  ipcMain.handle('recorder:get-settings', () => getRecordingSettings());

  ipcMain.handle('recorder:save-file', async (_, payload) => {
    const buffer = payload?.buffer ?? payload;
    const mimeType = payload?.mimeType || '';
    try {
      return await saveRecordingFile(buffer, mimeType);
    } catch (e) {
      console.error('[screenRecorder] 保存录制文件失败:', e.message);
      throw e;
    }
  });

  ipcMain.handle('recorder:show-open-dialog', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择视频保存目录',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('recorder:get-window-position', () => {
    if (recordingWin && !recordingWin.isDestroyed()) {
      const pos = recordingWin.getPosition();
      return { x: pos[0], y: pos[1] };
    }
    return { x: 0, y: 0 };
  });

  ipcMain.handle('recorder:set-window-position', (_, { x, y }) => {
    if (recordingWin && !recordingWin.isDestroyed()) {
      const nx = Math.round(Number(x));
      const ny = Math.round(Number(y));
      if (Number.isFinite(nx) && Number.isFinite(ny)) {
        recordingWin.setPosition(nx, ny);
      }
    }
    return true;
  });
}

function unregisterIpcHandlers() {
  ipcMain.removeHandler('recorder:get-screen-sources');
  ipcMain.removeHandler('recorder:start-ui');
  ipcMain.removeHandler('recorder:request-stop');
  ipcMain.removeHandler('recorder:stop-ui');
  ipcMain.removeHandler('recorder:is-recording');
  ipcMain.removeHandler('recorder:select-region');
  ipcMain.removeHandler('recorder:start-ffmpeg');
  ipcMain.removeHandler('recorder:stop-ffmpeg');
  ipcMain.removeHandler('recorder:toggle-camera');
  ipcMain.removeHandler('recorder:close-camera');
  ipcMain.removeHandler('recorder:camera-status');
  ipcMain.removeHandler('recorder:get-windows');
  ipcMain.removeHandler('recorder:select-region-result');
  ipcMain.removeHandler('recorder:cancel-select-region');
  ipcMain.removeHandler('recorder:set-settings');
  ipcMain.removeHandler('recorder:get-settings');
  ipcMain.removeHandler('recorder:save-file');
  ipcMain.removeHandler('recorder:show-open-dialog');
  ipcMain.removeHandler('recorder:get-window-position');
  ipcMain.removeHandler('recorder:set-window-position');
}

module.exports = {
  registerIpcHandlers,
  unregisterIpcHandlers,
  setMainWindow,
};