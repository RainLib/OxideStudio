# OxideStudio - 快速开始指南

## 🎉 项目初始化完成！

所有依赖已成功安装，项目已准备就绪。

---

## 🚀 立即启动

### 开发模式（推荐用于调试）
```bash
cd /Users/houshuai/project/rust/OxideStudio
npm run tauri dev
```

这将：
1. 启动 Vite 开发服务器（端口 1420）
2. 启动 Tauri 应用窗口
3. 支持热更新（修改代码后自动刷新）

### 仅前端预览
```bash
npm run dev
# 访问 http://localhost:5173
```

### 生产构建
```bash
npm run tauri build
```

生成的安装包位于：`src-tauri/target/release/bundle/`

---

## 📦 已安装的核心依赖

### 前端
- ✅ **Monaco Editor** (4.7.0) - SQL 编辑器
- ✅ **Glide Data Grid** (6.0.3) - 数据表格
- ✅ **Shadcn UI** + **Tailwind CSS** (4.1.18) - UI 组件和样式
- ✅ **React** (19.1.0) + **TypeScript** (5.8.3)

### 后端 (Rust)
- ✅ **sqlx** (0.8) - 支持 PostgreSQL, MySQL, SQLite
- ✅ **tokio** (1.x) - 异步运行时
- ✅ **anyhow** + **thiserror** - 错误处理

---

## 🎯 下一步：开发基础 UI

### 1. 添加 Shadcn 组件
```bash
# 示例：添加 Button 组件
npx shadcn@latest add button

# 添加其他常用组件
npx shadcn@latest add input
npx shadcn@latest add textarea
npx shadcn@latest add dialog
npx shadcn@latest add table
```

### 2. 集成 Monaco Editor
在 `src/App.tsx` 中：
```tsx
import Editor from '@monaco-editor/react';

<Editor
  height="50vh"
  defaultLanguage="sql"
  defaultValue="SELECT * FROM users;"
  theme="vs-dark"
  options={{
    minimap: { enabled: false },
    fontSize: 14,
  }}
/>
```

### 3. 集成 Glide Data Grid
```tsx
import DataEditor from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";

// 定义列
const columns = [
  { title: "ID", id: "id" },
  { title: "Name", id: "name" },
  { title: "Age", id: "age" },
];

// 示例数据
const data = [
  { id: 1, name: 'John', age: 30 },
  { id: 2, name: 'Jane', age: 25 },
];

<DataEditor
  columns={columns}
  rows={data.length}
  getCellContent={(cell) => ({
    kind: "text",
    data: String(data[cell[1]][columns[cell[0]].id]),
    displayData: String(data[cell[1]][columns[cell[0]].id]),
    allowOverlay: true,
  })}
  height={400}
/>
```

### 4. 创建 Tauri Command（Rust 侧）
编辑 `src-tauri/src/lib.rs`：
```rust
#[tauri::command]
async fn execute_query(sql: String) -> Result<String, String> {
    // TODO: 使用 sqlx 执行查询
    Ok(format!("执行 SQL: {}", sql))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![execute_query])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 5. 前端调用 Tauri Command
```tsx
import { invoke } from '@tauri-apps/api/core';

const executeSql = async (sql: string) => {
  try {
    const result = await invoke('execute_query', { sql });
    console.log('查询结果:', result);
  } catch (error) {
    console.error('查询失败:', error);
  }
};
```

---

## 📁 关键文件说明

| 文件 | 用途 |
|------|------|
| `src/App.tsx` | 主 React 组件 |
| `src/lib/utils.ts` | Shadcn `cn()` 工具函数 |
| `src/index.css` | Tailwind 全局样式 |
| `src-tauri/src/lib.rs` | Rust 后端入口 |
| `src-tauri/Cargo.toml` | Rust 依赖配置 |
| `components.json` | Shadcn UI 配置 |
| `tailwind.config.js` | Tailwind 主题配置 |

---

## 💡 提示

- **路径别名**：使用 `@/` 代替 `./` 引用 src 目录
  ```tsx
  import { cn } from "@/lib/utils";
  ```

- **主题切换**：Shadcn 已配置 dark mode，可通过 `<html>` 的 `class="dark"` 切换

- **CSS Lint 警告**：`@tailwind` 和 `@apply` 的警告是正常的，会在构建时处理

---

## 🎨 推荐的项目结构

```
src/
├── components/
│   ├── ui/              # Shadcn 组件
│   ├── SqlEditor.tsx    # SQL 编辑器组件
│   ├── DataGrid.tsx     # 数据表格组件
│   └── Sidebar.tsx      # 侧边栏组件
├── lib/
│   ├── utils.ts         # 工具函数
│   └── db.ts            # 数据库 Tauri 调用封装
└── App.tsx              # 主布局
```

---

## 🐛 常见问题

### Q: 运行 `npm run tauri dev` 报错？
A: 确保已安装 Rust 和系统依赖：
```bash
# macOS
xcode-select --install
```

### Q: Monaco Editor 或 Glide Data Grid 主题不生效？
A: 需要导入对应的 CSS 文件：
```tsx
import "@glideapps/glide-data-grid/dist/index.css";
```

### Q: 如何添加更多数据库支持？
A: 在 `Cargo.toml` 的 `sqlx` features 中添加，例如：
```toml
sqlx = { features = ["mssql"] }  # 添加 SQL Server 支持
```

---

祝开发顺利！🎉
