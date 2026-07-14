<p align="center">
  <img src="public/oxide-logo.png" alt="OxideStudio Logo" width="128" height="128">
</p>

<h1 align="center">OxideStudio</h1>

![Release Build](https://github.com/RainLib/OxideStudio/actions/workflows/release.yml/badge.svg)

**OxideStudio** 是一个基于 Rust 和 Tauri 重构的高性能、低内存占用的开源数据库客户端。

受到 **Beekeeper Studio** 的启发，我们旨在利用 Rust 的性能优势和 Web 技术的灵活性，打造一个极速、漂亮且功能强大的开发者工具。

---

## ✨ 核心优势

- **🗄️ 多数据库支持**: 当前运行时支持 PostgreSQL、MySQL/MariaDB、MongoDB、Redis 和 Elasticsearch；SQLite、SQL Server 在规划中。
- **🔌 数据源管理**: 可在 Database Explorer 中新建、编辑、刷新和安全移除数据源。
- **📁 项目工作区**: 将项目关联到本地目录，支持自动目录命名、显示别名、文件编辑和常见图片预览。
- **🎨 现代化 UI**: 基于 React + Tailwind CSS + Shadcn UI，提供丝滑的操作体验。
- **📊 高性能表格**: 使用 Glide Data Grid 渲染引擎，支持百万级数据虚拟滚动不卡顿。
- **💻 专业编辑器**: 集成 Monaco Editor (VS Code 同款)，支持 SQL 语法高亮、折叠及智能补全。
- **🧠 智能辅助**: 内置可审批的 AI 工具调用、CLI/MCP 接口和操作审计。
- **🔄 安全更新**: 支持签名校验的跨平台应用内更新。

---

## 🛠️ 技术栈

### 后端 (Rust Process)

- **Tauri v2**: 跨平台应用框架。
- **SQLx 与原生驱动**: 提供关系型数据库及 MongoDB、Redis、Elasticsearch 的统一访问能力。
- **运行时能力目录**: 数据源创建菜单与 AI 能力列表以后端实际注册的 driver 为准；本地 metadata 使用 SQLite，但当前不等同于 SQLite 数据源支持。
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

工作流会在以下情况下运行：

- 推送版本标签（如 `v0.2.0`）
- 在 GitHub Actions 页面手动触发，并填写与应用版本一致的标签

### 下载构建产物

1. 访问仓库的 **Actions** 页面
2. 打开对应版本的 GitHub Release
3. 下载对应平台的安装包：
   - **Windows**: `.msi` 或 `.exe` 安装程序
   - **macOS**: `.dmg` 磁盘镜像
   - **Linux**: `.deb` 或 `.AppImage`

### 发布新版本

创建并推送版本标签来触发发布流程：

```bash
git tag v0.1.0
git push origin v0.1.0
```

标签必须与 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json`
中的版本一致。工作流会发布安装包、更新签名和 `latest.json`。签名密钥配置见
[`docs/UPDATES.md`](docs/UPDATES.md)。

---

## 📁 项目结构

```
OxideStudio/
├── src/                # 前端 (React) 源码
│   ├── components/    # 共享 UI 组件
│   ├── ai/            # AI 助手运行时、规划器与工具
│   ├── services/      # Tauri、LSP 与应用服务
│   ├── store/         # Zustand 状态管理
│   └── lib/           # 通用工具与领域模型
├── src-tauri/          # 后端 (Rust) 源码
│   ├── src/           # Rust 核心逻辑 (lib.rs, main.rs)
│   ├── capabilities/  # Tauri 权限配置
│   └── Cargo.toml      # Rust 依赖配置
├── vendor/sql-lsp/     # 内置 SQL/NoSQL Language Server 子模块
├── tests/frontend/     # Vitest 前端测试
├── docs/               # 架构、DataGrip 对标、开发与发布文档
├── .vscode/            # VS Code 编辑器配置
└── components.json     # Shadcn UI 配置
```

---

## 🗺️ 路线图

- [x] Phase 1: 核心环境搭建与技术选型
- [x] Phase 2: 后端驱动层与通讯协议抽象
- [x] Phase 3: SQL 执行引擎与 Glide Data Grid 数据展示
- [x] Phase 4: SQL/NoSQL 智能补全与 AI 工具集成
- [x] Phase 5: 表数据与结构管理、导入导出
- [x] Phase 6: SSH 隧道与项目化数据源管理
- [ ] Phase 7: SQLite、SQL Server 等更多驱动与专业数据库工作流

完整的当前架构、DataGrip 对标矩阵和优先路线图见
[`docs/README.md`](docs/README.md)。

---

## 🤝 贡献与支持

虽然这是一个重构项目，但我们欢迎任何形式的贡献！如果你有任何想法或建议，请随时提交 Issue 或 Pull Request。

---

## 📄 开源协议

本项目采用 MIT 协议开源。
