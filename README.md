# My-Easy-Claw

基于 Tauri 2 的桌面级 AI Agent 应用，集成 pi-mono Agent Runtime，提供文件操作、Shell 执行、数据库管理、向量检索等系统级能力。

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    用户界面层 (WebView)                        │
│                  Vue 3 + pi-web-ui                          │
│         应用壳层 / 会话管理 / ChatPanel / ArtifactsPanel        │
└──────────┬──────────────────────────┬───────────────────────┘
           │ invoke / event           │ WebSocket
           ▼                          ▼
┌─────────────────────┐    ┌──────────────────────────────────┐
│  Tauri Core (Rust)  │    │    Node.js Sidecar (Agent)       │
│                     │    │                                  │
│  ┌───────────────┐  │    │  ┌────────────────────────────┐  │
│  │ tauri-plugin-  │  │    │  │ pi-agent-core              │  │
│  │   fs-ext       │  │    │  │  会话状态 / 工具调度 / 事件流 │  │
│  ├───────────────┤  │    │  ├────────────────────────────┤  │
│  │ tauri-plugin-  │  │    │  │ pi-ai                      │  │
│  │   shell-ext    │  │    │  │  多 Provider LLM 统一接口    │  │
│  ├───────────────┤  │◄───┤  ├────────────────────────────┤  │
│  │ tauri-plugin-  │  │    │  │ Tool Executor              │  │
│  │   db           │ HTTP  │  │  系统工具代理 / MCP Bridge   │  │
│  ├───────────────┤  │    │  └────────────────────────────┘  │
│  │ tauri-plugin-  │  │    │                                  │
│  │   sandbox      │  │    │          Chroma JS SDK           │
│  └───────────────┘  │    └──────────────┬───────────────────┘
│                     │                   │
└──────────┬──────────┘                   │
           │                              │
           ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         存储层                               │
│     SQLite (结构化数据)         Chroma (向量检索)              │
│     Local FileSystem                                        │
└─────────────────────────────────────────────────────────────┘
```

## 三层四进程模型

| 层级 | 进程 | 技术栈 | 职责 |
|------|------|--------|------|
| UI 层 | WebView 渲染进程 | Vue 3 + pi-web-ui | 界面渲染、用户交互、会话管理 |
| 逻辑层 | Node.js Sidecar | pi-agent-core + pi-ai | Agent 运行时、LLM 调度、工具编排、MCP |
| 系统层 | Tauri Core 进程 | Rust | 文件/Shell/DB/沙箱、进程管理、安全策略 |
| 存储层 | 嵌入式 | SQLite + Chroma | 结构化数据 + 向量检索 |

## Agent Runtime (pi-mono)

| Package | Description |
|---------|-------------|
| **[@mariozechner/pi-ai](https://github.com/badlogic/pi-mono/blob/main/packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@mariozechner/pi-agent-core](https://github.com/badlogic/pi-mono/blob/main/packages/agent)** | Agent runtime with tool calling and state management |
| **[@mariozechner/pi-web-ui](https://github.com/badlogic/pi-mono/blob/main/packages/web-ui)** | Web components for AI chat interfaces |

## 各层职责

### UI 层 (Vue 3 + pi-web-ui)

- **pi-web-ui** 提供核心聊天 UI：ChatPanel、ArtifactsPanel、消息渲染、流式输出、工具执行可视化、附件预览
- **Vue 3** 负责应用壳层：路由、布局、设置页面、会话列表管理、主题系统
- 通过 Vue `defineCustomElement` 桥接 pi-web-ui Web Components
- Pinia 管理应用级状态（设置、会话列表），Agent 状态由 pi-agent-core 自管理
- Artifacts（HTML/SVG/Markdown）在 pi-web-ui 的沙箱 iframe 中执行

### 逻辑层 (Node.js Sidecar)

Node.js 通过 `pkg` 编译为独立可执行文件，作为 Tauri Sidecar 运行。

```
pi-agent-core (Agent 运行时)
  ├── 会话状态管理（多轮对话、上下文窗口）
  ├── 工具注册与调度（并行/串行执行）
  └── 事件流（agent_start/end, turn_start/end, tool_execution）

pi-ai (LLM 统一接口)
  ├── 多 Provider 支持（OpenAI / Anthropic / Google / Ollama / vLLM）
  ├── 流式输出适配
  └── Token 计数与上下文管理

Tool Executor (工具执行器)
  ├── 内置工具：JS REPL、文档提取
  ├── 系统工具代理：通过 IPC 调用 Rust 端的 File/Shell/DB
  └── MCP 工具：通过 MCP Bridge 接入外部 MCP Server
```

### 系统层 (Rust / Tauri)

每个系统能力封装为 Tauri Plugin：

- **tauri-plugin-fs-ext** — 文件读写、目录遍历、文件监听（notify crate）
- **tauri-plugin-shell-ext** — 命令执行、进程管理、输出流式返回
- **tauri-plugin-db** — SQLite 连接池、迁移管理（rusqlite）
- **tauri-plugin-sandbox** — 基于 Windows Job Objects 的进程沙箱隔离

### Sidecar 生命周期

```
Tauri Core                Node Sidecar              Vue Frontend
    │                          │                         │
    │── spawn sidecar ────────►│                         │
    │                          │── start WS server       │
    │◄── ready + port (stdout)─│   (random port)         │
    │── emit "sidecar-ready" ─────────────────────────►  │
    │                          │◄── connect WebSocket ── │
    │                          │                         │
    │          ··· 正常通信阶段 ···                        │
    │                          │                         │
    │◄── window close ────────────────────────────────── │
    │── SIGTERM ──────────────►│                         │
    │                          │── flush & close         │
    │◄── exit(0) ─────────────│                         │
```

## IPC 通信协议

### 统一消息格式

```typescript
interface IPCMessage<T = unknown> {
  id: string           // UUID v4，请求-响应匹配
  type: "request" | "response" | "event" | "error"
  channel: string      // 命名空间，如 "file:read", "agent:chat"
  payload: T
  timestamp: number    // Unix ms
}

interface IPCError {
  code: string         // 如 "FILE_NOT_FOUND", "SHELL_TIMEOUT"
  message: string
  details?: unknown
}
```

### 各通道职责

| 通道 | 协议 | 方向 | 用途 |
|------|------|------|------|
| Vue → Rust | Tauri invoke | 请求-响应 | 文件操作、DB 查询、设置读写 |
| Rust → Vue | Tauri event | 推送 | Shell 输出流、文件变更通知、Sidecar 状态 |
| Vue ↔ Node | WebSocket | 双向流 | Agent 对话、工具执行事件流 |
| Node → Rust | localhost HTTP | RPC | Node 调用 Rust 的 File/Shell/DB 能力 |

Node → Rust 通过 localhost HTTP（Rust 端绑定 127.0.0.1 的内部 HTTP server）+ JSON-RPC 2.0 格式，支持并发请求、易于调试。

## 存储设计

### SQLite（结构化数据，Rust 端独占管理）

- 会话元数据（id, title, created_at, updated_at）
- 消息历史（session_id, role, content, tool_calls, timestamp）
- 用户设置（provider 配置、API Keys 加密存储）
- 工具执行日志（tool_name, input, output, duration, status）

### Chroma VectorDB（语义检索，Node 端直接访问）

- 长期记忆（对话摘要向量化）
- 文档知识库（用户上传文档的 chunk 向量）
- 代码片段索引（项目代码的语义索引）

## 安全机制

### Shell 执行安全

```
用户/Agent 发起 Shell 命令
       │
  [命令白名单检查] ── 拒绝 → 返回错误
       │
  [危险命令检测] ── 警告 → 用户确认弹窗
       │
  [沙箱环境执行] ── Windows Job Object 隔离
       │
  [输出过滤] ── 移除敏感信息
       │
    返回结果
```

### 文件访问安全

- 配置可访问的目录白名单（workspace scope）
- 禁止访问系统关键路径
- 文件操作审计日志

### API Key 安全

- 使用 Windows DPAPI（通过 Rust）加密存储 API Keys
- 内存中使用后立即清除
- 禁止通过 IPC 传输明文 Key 到前端

## 项目结构

```
my-easy-claw/
├── packages/
│   ├── frontend/              # Vue 3 应用
│   │   ├── src/
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── sidecar/               # Node.js Agent Sidecar
│   │   ├── src/
│   │   ├── package.json
│   │   └── build.mjs
│   │
│   └── shared/                # 共享类型与常量
│       ├── src/
│       └── package.json
│
├── src-tauri/                 # Rust / Tauri
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── plugins/
│   │   │   ├── mod.rs
│   │   │   ├── fs_ext.rs
│   │   │   ├── shell_ext.rs
│   │   │   ├── db.rs
│   │   │   └── sandbox.rs
│   │   └── ipc/
│   │       ├── mod.rs
│   │       └── internal_server.rs
│   │
│   ├── binaries/              # Sidecar 编译产物
│   ├── migrations/            # SQLite 迁移文件
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/
│       └── default.json
│
├── pnpm-workspace.yaml
├── package.json
├── turbo.json
└── README.md
```

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Vue | 3.5+ | 前端框架，Composition API + `<script setup>` |
| Vite | 6.x | 前端构建工具 |
| Tauri | 2.x | 桌面应用框架 |
| Rust | 1.82+ (edition 2024) | 系统层 |
| Node.js | 22 LTS | Sidecar 编译基线 |
| pnpm | 9.x | 包管理 + workspace |
| Turborepo | 2.x | 构建编排 |
| pi-agent-core | 0.64+ | Agent 运行时 |
| pi-ai | latest | LLM 统一接口 |
| pi-web-ui | latest | Chat UI 组件库 |

## 安装与启动

### 环境要求

- Node.js 22+
- pnpm 9+
- Rust / Cargo
- `cargo-tauri` CLI
- Windows WebView2 Runtime
- Windows C++ 构建工具（建议安装 Visual Studio Build Tools）

首次进入项目后安装依赖：

```bash
pnpm install
```

如果本机还没有安装 Tauri CLI：

```bash
cargo install tauri-cli --locked
```

### Windows 桌面开发启动

推荐使用下面这组命令启动 Windows 桌面应用：

```bash
# 1. 先构建 sidecar 可执行文件
pnpm build:sidecar

# 2. 再启动 Tauri 桌面开发模式
cd src-tauri
cargo tauri dev
```

说明：

- `cargo tauri dev` 会自动执行 `beforeDevCommand`，启动前端 Vite 开发服务器。
- Rust 主进程会拉起 `src-tauri/binaries` 中的 sidecar 可执行文件，因此首次开发前需要先执行一次 `pnpm build:sidecar`。
- 前端开发服务默认地址为 `http://localhost:1420`。

### Workspace 开发命令

如果你只是想单独运行 workspace 内的开发任务，可以使用：

```bash
# workspace 内部 dev 任务并行执行
pnpm dev

# 仅构建 sidecar
pnpm build:sidecar

# 仅构建 frontend
pnpm build:frontend
```

## 构建与打包

### Windows 安装包（exe）

项目根目录已提供可直接使用的 Windows 打包命令：

```bash
pnpm build:win
```

该命令会自动执行以下步骤：

1. 构建 `shared`
2. 构建 `sidecar`
3. 构建前端静态资源
4. 调用 `cargo tauri build --bundles nsis`
5. 生成 Windows 安装包

默认产物位置：

```bash
# 裸可执行文件
src-tauri/target/release/my-easy-claw.exe

# Windows NSIS 安装包
src-tauri/target/release/bundle/nsis/My Easy Claw_0.1.0_x64-setup.exe
```

### 手动构建流程

如果需要手动拆开执行，可参考：

```bash
# 构建 sidecar
pnpm build:sidecar

# 构建前端
pnpm build:frontend

# 进入 Tauri 工程并打包
cd src-tauri
cargo tauri build --bundles nsis
```

当前 Windows 构建链路为：

`shared build` → `esbuild bundle sidecar` → `pkg compile sidecar` → `copy to src-tauri/binaries` → `vite build` → `cargo tauri build` → `NSIS installer`
