# 豆豆开发者工具

一款基于 Electron 开发的离线开发者工具集，提供多种实用工具帮助开发者提高工作效率。

## 🎯 功能特性

### 工具列表

| 工具 | 快捷键 | 功能描述 |
|------|--------|----------|
| 🔑 生成器 | Ctrl+1 | 生成随机数据（UUID、随机数等） |
| 🎨 颜色工具 | Ctrl+2 | 颜色格式转换（Hex、RGB、HSL） |
| 📄 JSON工具 | Ctrl+3 | JSON 格式化、压缩、校验 |
| 🔐 加密工具 | Ctrl+4 | 常用加密算法（MD5、SHA、Base64） |
| 💻 代码工具 | Ctrl+5 | 代码美化、格式化 |
| 🌐 HTTP工具 | Ctrl+6 | HTTP 请求测试工具 |
| 🔍 正则工具 | Ctrl+7 | 正则表达式测试与调试 |
| ⏰ 时间转换 | Ctrl+8 | Unix 时间戳转换 |
| 🔢 进制转换 | Ctrl+9 | 二进制、八进制、十进制、十六进制转换 |
| 🖼️ 图片工具 | Ctrl+0 | 图片压缩、格式转换 |
| 📱 二维码 | - | 二维码生成与解析 |
| 📊 Mock工具 | - | Mock 数据生成 |

### 截图功能

- **快捷键**: `Ctrl+Shift+S`
- 支持区域截图和全屏截图

## 🛠️ 技术栈

- **框架**: Electron 28.x
- **语言**: JavaScript (ES6+)
- **构建工具**: electron-builder

## 📦 安装与运行

### 开发模式

```bash
# 安装依赖
npm install

# 启动开发服务器
npm start
```

### 构建生产版本

```bash
# 构建 Windows 版本
npm run build:win

# 构建所有平台版本
npm run build
```

构建产物将输出到 `dist` 目录。

## 📁 项目结构

```
.
├── js/                    # JavaScript 源码目录
│   ├── tools/             # 工具模块
│   │   ├── base.js        # 进制转换工具
│   │   ├── code.js        # 代码工具
│   │   ├── color.js       # 颜色工具
│   │   ├── crypto.js      # 加密工具
│   │   ├── generator.js   # 生成器
│   │   ├── http.js        # HTTP工具
│   │   ├── image.js       # 图片工具
│   │   ├── json.js        # JSON工具
│   │   ├── mock.js        # Mock工具
│   │   ├── qrcode.js      # 二维码工具
│   │   ├── regex.js       # 正则工具
│   │   ├── screenshot-editor.js  # 截图编辑器
│   │   └── time.js        # 时间转换工具
│   ├── sidebar.js         # 侧边栏组件
│   ├── tools-config.js    # 工具配置
│   └── utils.js           # 通用工具函数
├── scripts/               # 脚本目录
│   └── prebuild.js        # 预构建脚本
├── main.js                # 主进程入口
├── renderer.js            # 渲染进程入口
├── index.html             # 主窗口 HTML
├── styles.css             # 全局样式
├── float.html             # 悬浮窗口 HTML
├── float.js               # 悬浮窗口逻辑
├── float.css              # 悬浮窗口样式
├── screenshot-overlay.html    # 截图覆盖层
├── screenshot-overlay.js      # 截图覆盖层逻辑
├── screenshot-overlay.css     # 截图覆盖层样式
└── package.json           # 项目配置
```

## 📝 使用说明

1. **启动应用**: 运行 `npm start` 启动开发模式
2. **选择工具**: 点击左侧侧边栏的工具图标或使用快捷键
3. **截图功能**: 按 `Ctrl+Shift+S` 启动截图

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**豆豆开发者工具** - 让开发更高效 ✨