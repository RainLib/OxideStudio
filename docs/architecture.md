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

- **状态存储**: `HashMap<String, Arc<Mutex<Box<dyn DatabaseDriver>>>>`
  - Key: `connection_id` (UUID)
  - Value: 具体的驱动实例 (线程安全)

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
