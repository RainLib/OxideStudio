# OxideStudio 🚀

![Release Build](https://github.com/LikeRainDay/OxideStudio/actions/workflows/release.yml/badge.svg)

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

也可以使用根目录 `Makefile` 统一管理常用任务：

```bash
make setup          # 初始化子模块并安装前端依赖
make dev            # 启动 Tauri 桌面开发模式
make dev-no-watch   # 启动 Tauri，但禁用 Rust watcher，适合排查二进制触发的重复 rebuild
make web            # 仅启动 Vite 前端开发服务
make check          # 前端构建 + Rust cargo check
make test           # 运行前端、后端和 LSP 测试
make test-live-db   # 使用 Docker 运行多数据库集成测试
make ai-inspect     # 查看单个 AI 工具 schema 和审批策略
```

如果开发模式反复出现 `src-tauri/binaries/sql-lsp changed` 并触发重建，先停止 dev 进程，执行 `make lsp-build`，再使用 `make dev-no-watch` 启动。默认 `make dev` 仍保留 Rust 热重载。

### 调试配置

本项目已预配置好 VS Code 调试环境：

- `F5`: 启动调试 (Launch Tauri Dev)。
- `Ctrl+Shift+B`: 运行默认构建任务。

### 构建生产版本

```bash
# 本地构建
npm run tauri build
```

---

## 📦 自动化构建与发布

本项目配置了 GitHub Actions 自动化工作流，支持在 **Windows**、**macOS** 和 **Linux** 三个平台上自动构建。

### 触发条件

工作流会在以下情况下自动运行：

- 推送代码到 `main` 或 `develop` 分支
- 创建新的版本标签（如 `v0.1.0`）
- 手动触发（在 GitHub Actions 页面）

### 下载构建产物

1. 访问仓库的 **Actions** 页面
2. 选择最新的 **Release Build** 工作流
3. 在 **Artifacts** 部分下载对应平台的安装包：
   - **Windows**: `.msi` 或 `.exe` 安装程序
   - **macOS**: `.dmg` 磁盘镜像
   - **Linux**: `.deb` 或 `.AppImage`

### 发布新版本

创建并推送版本标签来触发发布流程：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流会自动创建 GitHub Release 草稿，并附带所有平台的构建产物。

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
