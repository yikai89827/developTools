// Git 命令速查卡模块
// 场景化分类 + 搜索 + 一键复制

const { copyToClipboard } = require('../utils');

function $(id) { return document.getElementById(id); }

// 场景化命令数据
const GIT_COMMANDS = [
  // ── 配置 ──
  { cat: 'config', title: '设置用户名', cmd: 'git config --global user.name "你的名字"', desc: '配置全局提交用户名' },
  { cat: 'config', title: '设置邮箱', cmd: 'git config --global user.email "you@example.com"', desc: '配置全局提交邮箱' },
  { cat: 'config', title: '查看配置', cmd: 'git config --list', desc: '查看所有 Git 配置' },
  { cat: 'config', title: '保存凭证', cmd: 'git config --global credential.helper store', desc: '永久保存 HTTPS 密码' },
  { cat: 'config', title: '默认分支名', cmd: 'git config --global init.defaultBranch main', desc: '设置默认分支为 main' },
  { cat: 'config', title: '设置编辑器', cmd: 'git config --global core.editor "code --wait"', desc: '用 VS Code 作为默认编辑器' },
  { cat: 'config', title: '设置别名', cmd: 'git config --global alias.co checkout', desc: '给命令设置简短别名' },

  // ── 初始化与克隆 ──
  { cat: 'init', title: '初始化仓库', cmd: 'git init', desc: '在当前目录初始化 Git 仓库' },
  { cat: 'init', title: '克隆仓库', cmd: 'git clone <url>', desc: '克隆远程仓库到本地' },
  { cat: 'init', title: '克隆指定分支', cmd: 'git clone -b <branch> <url>', desc: '克隆并切换到指定分支' },
  { cat: 'init', title: '浅克隆', cmd: 'git clone --depth 1 <url>', desc: '只拉取最近 1 次提交，加速克隆' },
  { cat: 'init', title: '克隆到指定目录', cmd: 'git clone <url> <dir>', desc: '克隆到自定义目录名' },

  // ── 基本操作 ──
  { cat: 'basic', title: '查看状态', cmd: 'git status', desc: '查看工作区状态' },
  { cat: 'basic', title: '添加所有', cmd: 'git add .', desc: '添加所有改动到暂存区' },
  { cat: 'basic', title: '添加指定文件', cmd: 'git add <file>', desc: '添加指定文件到暂存区' },
  { cat: 'basic', title: '交互式添加', cmd: 'git add -p', desc: '逐块选择改动添加，适合精细提交' },
  { cat: 'basic', title: '提交', cmd: 'git commit -m "提交信息"', desc: '提交暂存区改动' },
  { cat: 'basic', title: '追加提交', cmd: 'git commit --amend --no-edit', desc: '追加到上次提交，不修改信息' },
  { cat: 'basic', title: '查看日志', cmd: 'git log --oneline --graph -20', desc: '图形化查看最近 20 条提交' },
  { cat: 'basic', title: '查看改动', cmd: 'git diff', desc: '查看未暂存的改动' },
  { cat: 'basic', title: '查看已暂存改动', cmd: 'git diff --cached', desc: '查看已暂存待提交的改动' },

  // ── 分支 ──
  { cat: 'branch', title: '查看分支', cmd: 'git branch', desc: '查看本地分支' },
  { cat: 'branch', title: '查看所有分支', cmd: 'git branch -a', desc: '查看本地+远程分支' },
  { cat: 'branch', title: '创建分支', cmd: 'git branch <name>', desc: '创建新分支但不切换' },
  { cat: 'branch', title: '创建并切换', cmd: 'git checkout -b <name>', desc: '创建并切换到新分支' },
  { cat: 'branch', title: '切换分支', cmd: 'git checkout <name>', desc: '切换到指定分支' },
  { cat: 'branch', title: '切换分支(新)', cmd: 'git switch <name>', desc: '切换分支（新语法）' },
  { cat: 'branch', title: '创建并切换(新)', cmd: 'git switch -c <name>', desc: '创建并切换（新语法）' },
  { cat: 'branch', title: '删除分支', cmd: 'git branch -d <name>', desc: '删除已合并的分支' },
  { cat: 'branch', title: '强制删除分支', cmd: 'git branch -D <name>', desc: '强制删除未合并的分支' },
  { cat: 'branch', title: '重命名分支', cmd: 'git branch -m <old> <new>', desc: '重命名分支' },
  { cat: 'branch', title: '追踪远程分支', cmd: 'git branch -u origin/<branch>', desc: '设置当前分支追踪远程分支' },

  // ── 合并与变基 ──
  { cat: 'merge', title: '合并分支', cmd: 'git merge <branch>', desc: '将指定分支合并到当前分支' },
  { cat: 'merge', title: '变基', cmd: 'git rebase <branch>', desc: '将当前提交变基到指定分支之上' },
  { cat: 'merge', title: '交互式变基', cmd: 'git rebase -i HEAD~3', desc: '整理最近 3 次提交（合并/重写/重排）' },
  { cat: 'merge', title: '继续变基', cmd: 'git rebase --continue', desc: '解决冲突后继续变基' },
  { cat: 'merge', title: '中止变基', cmd: 'git rebase --abort', desc: '放弃本次变基回到起点' },
  { cat: 'merge', title: '挑选提交', cmd: 'git cherry-pick <commit>', desc: '把指定提交应用到当前分支' },
  { cat: 'merge', title: '合并压缩', cmd: 'git merge --squash <branch>', desc: '合并但压成单次提交' },

  // ── 撤销 ──
  { cat: 'undo', title: '撤销工作区改动', cmd: 'git checkout -- <file>', desc: '丢弃指定文件的未暂存改动' },
  { cat: 'undo', title: '撤销工作区(新)', cmd: 'git restore <file>', desc: '丢弃改动（新语法）' },
  { cat: 'undo', title: '取消暂存', cmd: 'git reset HEAD <file>', desc: '把文件移出暂存区' },
  { cat: 'undo', title: '取消暂存(新)', cmd: 'git restore --staged <file>', desc: '取消暂存（新语法）' },
  { cat: 'undo', title: '撤销上次提交(保留改动)', cmd: 'git reset --soft HEAD~1', desc: '撤销提交但保留改动在暂存区' },
  { cat: 'undo', title: '撤销上次提交(混合)', cmd: 'git reset --mixed HEAD~1', desc: '撤销提交，改动回到工作区' },
  { cat: 'undo', title: '安全撤销推送', cmd: 'git revert <commit>', desc: '生成反向提交，适合已推送的提交' },
  { cat: 'undo', title: '危险:硬重置', cmd: 'git reset --hard HEAD~1', desc: '⚠️ 彻底丢弃上次提交及改动' },

  // ── 远程 ──
  { cat: 'remote', title: '查看远程', cmd: 'git remote -v', desc: '查看远程仓库地址' },
  { cat: 'remote', title: '添加远程', cmd: 'git remote add origin <url>', desc: '添加远程仓库' },
  { cat: 'remote', title: '修改远程地址', cmd: 'git remote set-url origin <url>', desc: '修改远程仓库 URL' },
  { cat: 'remote', title: '拉取', cmd: 'git pull', desc: '拉取并合并远程更新' },
  { cat: 'remote', title: '变基式拉取', cmd: 'git pull --rebase', desc: '拉取并变基，保持线性历史' },
  { cat: 'remote', title: '推送', cmd: 'git push origin <branch>', desc: '推送当前分支到远程' },
  { cat: 'remote', title: '首次推送', cmd: 'git push -u origin <branch>', desc: '推送并设置上游分支' },
  { cat: 'remote', title: '推送标签', cmd: 'git push origin --tags', desc: '推送所有标签' },
  { cat: 'remote', title: '强制推送', cmd: 'git push --force-with-lease', desc: '更安全的强制推送（防覆盖他人提交）' },
  { cat: 'remote', title: '删除远程分支', cmd: 'git push origin --delete <branch>', desc: '删除远程分支' },

  // ── 储藏 ──
  { cat: 'stash', title: '储藏改动', cmd: 'git stash', desc: '暂存当前改动到栈中' },
  { cat: 'stash', title: '带信息储藏', cmd: 'git stash push -m "信息"', desc: '带说明的储藏，便于辨识' },
  { cat: 'stash', title: '查看储藏', cmd: 'git stash list', desc: '查看所有储藏' },
  { cat: 'stash', title: '恢复储藏', cmd: 'git stash pop', desc: '恢复最近储藏并删除栈记录' },
  { cat: 'stash', title: '应用储藏', cmd: 'git stash apply', desc: '应用储藏但保留栈记录' },
  { cat: 'stash', title: '删除储藏', cmd: 'git stash drop', desc: '删除最近储藏' },
  { cat: 'stash', title: '清空储藏', cmd: 'git stash clear', desc: '清空所有储藏' },

  // ── 标签 ──
  { cat: 'tag', title: '查看标签', cmd: 'git tag', desc: '查看所有标签' },
  { cat: 'tag', title: '创建标签', cmd: 'git tag v1.0.0', desc: '创建轻量标签' },
  { cat: 'tag', title: '带信息标签', cmd: 'git tag -a v1.0.0 -m "发布说明"', desc: '创建附注标签（推荐）' },
  { cat: 'tag', title: '推送标签', cmd: 'git push origin v1.0.0', desc: '推送指定标签到远程' },

  // ── 疑难场景 ──
  { cat: 'tricks', title: '找回丢失提交', cmd: 'git reflog', desc: '查看 HEAD 移动记录，找回 reset 丢失的提交' },
  { cat: 'tricks', title: '二分查错', cmd: 'git bisect start', desc: '用二分法定位引入 bug 的提交' },
  { cat: 'tricks', title: '清理未跟踪', cmd: 'git clean -fd', desc: '删除未跟踪的文件和目录' },
  { cat: 'tricks', title: '查看文件改动行', cmd: 'git log -p <file>', desc: '查看指定文件的完整改动历史' },
  { cat: 'tricks', title: '谁改了这个文件', cmd: 'git blame <file>', desc: '查看每行最后修改者' },
  { cat: 'tricks', title: '搜索提交信息', cmd: 'git log --grep="关键词"', desc: '按提交信息关键词搜索' },
  { cat: 'tricks', title: '子模块', cmd: 'git submodule add <url>', desc: '添加子模块' },
  { cat: 'tricks', title: '工作树', cmd: 'git worktree add ../path <branch>', desc: '在不切换分支的情况下并行开发' },
];

const CATEGORY_LABELS = {
  config: '⚙️ 配置',
  init: '📦 初始化与克隆',
  basic: '📝 基本操作',
  branch: '🌿 分支',
  merge: '🔀 合并与变基',
  undo: '↩️ 撤销',
  remote: '🌐 远程',
  stash: '📦 储藏',
  tag: '🏷️ 标签',
  tricks: '🧰 疑难场景',
};

function initGitCheatsheet() {
  const container = $('git-cmd-list');
  const searchInput = $('git-search');
  if (!container || !searchInput) return;

  let currentCat = 'all';

  function render() {
    const kw = searchInput.value.trim().toLowerCase();
    let filtered = GIT_COMMANDS.filter(it => {
      if (currentCat !== 'all' && it.cat !== currentCat) return false;
      if (!kw) return true;
      return it.title.toLowerCase().includes(kw) ||
        it.cmd.toLowerCase().includes(kw) ||
        it.desc.toLowerCase().includes(kw);
    });

    if (!filtered.length) {
      container.innerHTML = '<div class="git-empty">无匹配命令</div>';
      return;
    }

    // 按分类分组渲染
    const groups = {};
    for (const it of filtered) {
      if (!groups[it.cat]) groups[it.cat] = [];
      groups[it.cat].push(it);
    }

    let html = '';
    for (const cat of Object.keys(groups)) {
      html += `<div class="git-cat-group">`;
      html += `<h3 class="git-cat-title">${CATEGORY_LABELS[cat] || cat}</h3>`;
      html += `<div class="git-cmd-grid">`;
      for (const it of groups[cat]) {
        html += `<div class="git-cmd-card" data-cmd="${escapeAttr(it.cmd)}">`;
        html += `<div class="git-cmd-head">`;
        html += `<span class="git-cmd-name">${escapeHtml(it.title)}</span>`;
        html += `<button class="git-copy-btn" title="复制">复制</button>`;
        html += `</div>`;
        html += `<code class="git-cmd-code">${escapeHtml(it.cmd)}</code>`;
        html += `<p class="git-cmd-desc">${escapeHtml(it.desc)}</p>`;
        html += `</div>`;
      }
      html += `</div></div>`;
    }
    container.innerHTML = html;

    // 绑定复制
    container.querySelectorAll('.git-cmd-card').forEach(card => {
      const btn = card.querySelector('.git-copy-btn');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cmd = card.dataset.cmd;
        copyToClipboard(cmd);
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '复制'; }, 1200);
      });
      // 点击卡片代码区也可复制
      card.querySelector('.git-cmd-code').addEventListener('click', () => {
        copyToClipboard(card.dataset.cmd);
      });
    });
  }

  // 分类筛选按钮
  const filterBar = $('git-filter-bar');
  if (filterBar) {
    const cats = [{ key: 'all', label: '全部' }].concat(
      Object.keys(CATEGORY_LABELS).map(k => ({ key: k, label: CATEGORY_LABELS[k] }))
    );
    filterBar.innerHTML = cats.map(c =>
      `<button class="git-filter-btn ${c.key === 'all' ? 'active' : ''}" data-cat="${c.key}">${c.label}</button>`
    ).join('');
    filterBar.querySelectorAll('.git-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        filterBar.querySelectorAll('.git-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCat = btn.dataset.cat;
        render();
      });
    });
  }

  searchInput.addEventListener('input', render);
  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

module.exports = { initGitCheatsheet };
