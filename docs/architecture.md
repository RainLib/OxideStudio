# OxideStudio 架构设计文档

## 1. 系统概览

![System Overview](mermaid-diagram-1)

```mermaid
graph TD
    subgraph Frontend [前端 (React Webview)]
        UI[User Interface]
        State[State Management]
        Monaco[Monaco Editor]
        Grid[Glide Data Grid]
        Protocol[Protocol Client]

        UI --> State
        Monaco --> State
        State --> Protocol
    end

    subgraph Backend [后端 (Rust Process)]
        TauriCmd[Tauri Commands]
        ConnMgr[Connection Manager]
        DriverTrait[<<Trait>> DatabaseDriver]

        PG[Postgres Driver]
        MySQL[MySQL Driver]
        SQLite[SQLite Driver]
        SSH[SSH Tunnel Manager]

        TauriCmd --> ConnMgr
        ConnMgr --> DriverTrait

        DriverTrait <|-- PG
        DriverTrait <|-- MySQL
        DriverTrait <|-- SQLite

        PG -.-> SSH
        MySQL -.-> SSH
    end

    Protocol <== JSON/IPC ==> TauriCmd
```

AI 助手和外部 Agent 接入设计见 [AI_AGENT_INTEGRATION.md](AI_AGENT_INTEGRATION.md)。核心原则是先在前端建立 `AiToolRegistry`，再通过同一注册表适配 LangGraph、MCP 和 CLI，避免为不同入口复制数据库工具逻辑。

前端数据库类型通过 `src/lib/databaseDialect.ts` 的 driver profile 描述。内置驱动提供默认 profile，外部 provider 可以用 `registerDatabaseDriverProfile` 注册图标、URL scheme、协议别名、默认数据库和 capability 默认值；后端返回的 runtime capabilities 会通过 `registerDatabaseCapabilities` 覆盖同名 driver 的运行时能力。Provider 集成应优先使用 `src/providers` 的 `registerDatabaseProvider`，一次性注册 driver profile、对象创建/预览/删除模板和 AI tool families，避免新增数据库时改多个 UI 模块；动态模块集合可以通过 `loadDatabaseProviders` 顺序加载并隔离失败模块；`tests/frontend/provider-registration.test.ts` 和 `tests/frontend/provider-loader.test.ts` 覆盖这些扩展契约。

## 2. 核心抽象层 (Core Abstraction)

为了支持多种数据库（甚至是非关系型数据库），我们需要一个足够通用的 Trait 系统。

### DatabaseDriver Trait

```rust
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    // 连接建立
    async fn connect(&mut self) -> Result<()>;

    // 连接断开
    async fn disconnect(&mut self) -> Result<()>;

    // 执行查询（返回通用结果集）
    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>>;

    // 获取元数据
    async fn get_schemas(&self) -> Result<Vec<String>>;
    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>>;
    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>>;
}
```

### 结果集抽象 (QueryResult)

由于 Rust 是强类型的，而数据库结果是动态的，我们需要一个统一的中间表示：

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct QueryResult {
    pub columns: Vec<ColumnDef>,
    pub rows: Vec<Vec<Value>>, // serde_json::Value 或自定义 Enum
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String, // 数据库原生类型名称
}
```

## 3. 通讯协议 (Communication Protocol)

前后端交互采用标准的 `JSON-RPC` 风格的消息格式。

### 请求 (Request)

```typescript
interface DatabaseRequest {
    connectionId: string; // 会话ID
    action: "query" | "connect" | "disconnect" | "meta";
    payload: any;
}
```

### 响应 (Response)

```typescript
interface DatabaseResponse<T> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: string;
    };
    executionTimeMs?: number;
}
```

## 4. 连接管理 (Connection Manager)

`ConnectionManager` 负责维护所有活跃的数据库连接。它是一个全局的单例（使用 `Tauri State` 管理）。

- **状态存储**: `HashMap<String, Arc<dyn DatabaseDriver>>`
  - Key: `connection_id` (UUID)
  - Value: 具体的驱动实例 (线程安全)
- **连接切换**: 新连接建立并通过 ping 后才替换或激活；旧连接断开失败不会回滚新连接。
- **事务生命周期**: PostgreSQL/MySQL 手动事务绑定到 tab 与 connection id。当前 tab 的连接上下文变化、驱动不支持事务或 tab 关闭时，前端会回滚 stale session 并清理本地事务状态，避免继续向后端发送已失效的 `transactionId`。

## 5. 错误处理策略

使用 `thiserror` 定义统一的后端错误类型，并在 Tauri Command 层转换为前端友好的 JSON 错误对象。

```rust
#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database connection failed: {0}")]
    ConnectionError(String),

    #[error("Query execution failed: {0}")]
    QueryError(String),

    #[error("Driver not found: {0}")]
    DriverNotFound(String),
}
```
