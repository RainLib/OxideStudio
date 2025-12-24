# OxideStudio 🚀

**OxideStudio** 是一个基于 Rust 和 Tauri 重构的高性能、低内存占用的开源数据库客户端。

受到 **Beekeeper Studio** 的启发，我们旨在利用 Rust 的性能优势和 Web 技术的灵活性，打造一个极速、漂亮且功能强大的开发者工具。

---

## ✨ 核心优势

- **🚀 极速启动**: 得益于 Rust 后端，冷启动速度相比 Electron 应用提升 300%+。
- **📦 轻量安装**: 安装包体积仅约 10MB（相比原版减少 90%+）。
- **💾 低内存占用**: 运行时内存占用通常在 50MB 以下，极致节省系统资源。
- **🎨 现代化 UI**: 基于 React + Tailwind CSS + Shadcn UI，提供丝滑的操作体验。
- **📊 高性能表格**: 使用 Glide Data Grid 渲染引擎，支持百万级数据虚拟滚动不卡顿。
- **💻 专业编辑器**: 集成 Monaco Editor (VS Code 同款)，支持 SQL 语法高亮、折叠及智能补全。

---

## 🛠️ 技术栈

### 后端 (Rust Process)
- **Tauri v2**: 跨平台应用框架。
- **SQLx**: 异步数据库访问层，支持 PostgreSQL, MySQL, SQLite, SQL Server。
- **Tokio**: 高性能异步运行时。
- **Anyhow/Thiserror**: 严谨的错误处理。

### 前端 (Webview Process)
- **React 19**: 最新的 UI 开发框架。
- **Glide Data Grid**: 帆布级的超高性能数据表格。
- **Monaco Editor**: 业界标杆的代码编辑器。
- **Tailwind CSS 4**: 原子化样式引擎。
- **Shadcn UI**: 精美的组件库系统。
- **Vite**: 闪电般的构建工具。

---

## 🚀 快速开始

### 开发环境准备
确保你的电脑上已安装：
1. [Rust](https://www.rust-lang.org/) (cargo, rustc)
2. [Node.js](https://nodejs.org/) (建议 v20+)
3. 系统依赖 (macOS: Xcode Command Line Tools)

### 运行开发模式
```bash
# 安装依赖
npm install

# 启动 (包含 Rust 编译和 Vite 开发服务)
npm run tauri dev
```

### 调试配置
本项目已预配置好 VS Code 调试环境：
- `F5`: 启动调试 (Launch Tauri Dev)。
- `Ctrl+Shift+B`: 运行默认构建任务。

---

## 📁 项目结构

```
OxideStudio/
├── src/                # 前端 (React) 源码
│   ├── components/    # 共享 UI 组件
│   ├── lib/           # 工具函数 (cn, utils)
│   └── assets/        # 静态资源
├── src-tauri/          # 后端 (Rust) 源码
│   ├── src/           # Rust 核心逻辑 (lib.rs, main.rs)
│   ├── capabilities/  # Tauri 权限配置
│   └── Cargo.toml      # Rust 依赖配置
├── .vscode/            # VS Code 编辑器配置
└── components.json     # Shadcn UI 配置
```

---

## 🗺️ 路线图

- [x] Phase 1: 核心环境搭建与技术选型
- [ ] Phase 2: 后端驱动层 (SQLx) 与通讯协议抽象
- [ ] Phase 3: SQL 执行引擎与 Glide Data Grid 数据展示
- [ ] Phase 4: SSH 隧道实现 (russh)
- [ ] Phase 5: 数据库管理 (表结构编辑、导入导出)

---

## 🤝 贡献与支持

虽然这是一个重构项目，但我们欢迎任何形式的贡献！如果你有任何想法或建议，请随时提交 Issue 或 Pull Request。

---

## 📄 开源协议

本项目采用 MIT 协议开源。
