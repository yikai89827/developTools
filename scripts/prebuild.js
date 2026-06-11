const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');
const isWin = process.platform === 'win32';

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

function run(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore', shell: true, windowsHide: true });
  } catch {}
}

function killPackagedApp() {
  if (!isWin) return;
  run('taskkill /F /IM "豆豆开发者工具.exe" /T');
  run('taskkill /F /IM "开发者工具.exe" /T');
}

function killProjectElectron() {
  if (!isWin) return;

  try {
    const output = execSync(
      'wmic process where "name=\'electron.exe\'" get ProcessId,CommandLine /FORMAT:CSV',
      { encoding: 'utf8', windowsHide: true }
    );

    const rootKey = projectRoot.toLowerCase();
    output.split('\n').forEach((line) => {
      const lower = line.toLowerCase();
      if (!lower.includes(rootKey) && !lower.includes('developtools')) return;
      const match = line.trim().match(/,(\d+)$/);
      if (match) run(`taskkill /F /PID ${match[1]} /T`);
    });
  } catch {}
}

function removeDist() {
  if (!fs.existsSync(distPath)) {
    console.log('[prebuild] dist 目录不存在，跳过清理');
    return;
  }

  for (let i = 1; i <= 5; i++) {
    try {
      fs.rmSync(distPath, { recursive: true, force: true });
      console.log('[prebuild] 已清理 dist 目录');
      return;
    } catch (error) {
      if (i === 5) {
        console.error('[prebuild] 无法删除 dist 目录，请关闭占用进程后重试');
        console.error(`[prebuild] ${error.message}`);
        process.exit(1);
      }
      console.log(`[prebuild] dist 被占用，重试 ${i}/5...`);
      sleep(800);
    }
  }
}

console.log('[prebuild] 准备打包，清理占用进程与 dist...');
killPackagedApp();
killProjectElectron();
sleep(500);
removeDist();
