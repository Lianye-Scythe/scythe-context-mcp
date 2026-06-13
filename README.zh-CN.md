# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[繁體中文](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP 是给 Codex App / Codex CLI 使用的本地代码上下文引擎。它在 repo 内建立 SQLite/sqlite-vec 索引，结合语义搜索、关键字搜索、符号/依赖关系与 context packing，让 Codex 更快拿到可操作的文件、行号、片段与相关路径。

## 核心特性

- 本地优先：metadata、FTS 与向量索引都存在 repo 内的 `.scythe-context/`。
- 混合搜索：结合 Gemini embeddings、SQLite FTS5、path/symbol ranking，避免只靠单一召回方式。
- Codex 友好输出：返回 line ranges、snippets、match reasons、grep keywords、related files 与 suggested paths。
- Gemini-compatible：支持官方 Gemini API，也支持第三方 v1beta proxy。
- 可诊断：内置 provider probe、index freshness、embedding coverage 与可修复建议。

隐私提醒：只有在执行 embedding 相关功能时，query 或 chunk text 才会发送到你配置的 Gemini-compatible endpoint。第三方 proxy 应视为可以看到这些文字。

## 快速开始

```bash
npm install -g scythe-context-mcp
scythe-context-mcp --version
```

Runtime 目标是 Node.js 24 LTS。Node 26 可能可用，但在进入 LTS 前不作为主要验收基准。

从源码执行：

```bash
git clone https://github.com/Lianye-Scythe/scythe-context-mcp.git
cd scythe-context-mcp
npm install
cp .env.example .env
npm run build
```

旧项目名 `repo-beacon-mcp` 已改为 `scythe-context-mcp`。旧的 `REPO_BEACON_*` 环境变量仍作为 fallback 兼容，但新配置应改用 `SCYTHE_CONTEXT_*`。

## Codex 配置

Codex MCP 配置使用 `command`、`args`、`cwd`、`env` 与 `env_vars` 等字段；可参考官方文档：[Model Context Protocol](https://developers.openai.com/codex/mcp) 与 [Configuration Reference](https://developers.openai.com/codex/config-reference)。

### 先选运行环境

| 情境 | 建议 |
| --- | --- |
| Codex 和 MCP 都在 Windows | 用 Windows `node.exe` + Windows npm `npx-cli.js`。 |
| Codex CLI 在 WSL/Linux/macOS | 用同一个环境内的 `npx` 或 `node dist/index.js`。 |
| Codex App on Windows 打开 WSL repo | 目前 App 的 WSL MCP bridge 仍可能不稳定；建议 MCP 跑 Windows Node，再用 `PWD` + `WSLENV` 把当前 WSL workspace 传给 Windows process。 |

### Native Windows

最小配置：

```toml
[mcp_servers.scythe_context]
command = 'C:\nvm4w\nodejs\node.exe'
args = ['C:\nvm4w\nodejs\node_modules\npm\bin\npx-cli.js', '-y', 'scythe-context-mcp']
cwd = 'C:\Users\you\Git\your-repo'
env_vars = ["GEMINI_API_KEY"]
```

如果 `scythe-context-mcp` 已全局安装且 Codex 启动时的 PATH 能找到它，可以更短：

```toml
[mcp_servers.scythe_context]
command = "scythe-context-mcp"
cwd = 'C:\Users\you\Git\your-repo'
env_vars = ["GEMINI_API_KEY"]
```

### WSL/Linux/macOS

Codex 和 MCP server 都在同一个 Unix-like 环境中运行时，最小配置是：

```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
cwd = "/home/you/Git/your-repo"
env_vars = ["GEMINI_API_KEY"]
```

从源码执行时：

```toml
[mcp_servers.scythe_context]
command = "node"
args = ["/path/to/scythe-context-mcp/dist/index.js"]
cwd = "/path/to/scythe-context-mcp"
env_vars = ["GEMINI_API_KEY"]
```

### Windows Codex App + WSL repo

目前 Codex App on Windows 的 WSL agent mode 可能无法可靠启动 WSL-side stdio MCP server。如果你遇到 App 里看不到 MCP tools、MCP handshake timeout、或 config path 混到 Windows/WSL 的问题，建议使用 Windows Node 启动 MCP，并让 Scythe Context 通过 WSL path 索引 repo。

最小配置：

```toml
[mcp_servers.scythe_context]
command = "/mnt/c/nvm4w/nodejs/node.exe"
args = ['C:\nvm4w\nodejs\node_modules\npm\bin\npx-cli.js', "-y", "scythe-context-mcp"]
cwd = "/mnt/c/Users/you"
env_vars = ["GEMINI_API_KEY", "PWD"]

[mcp_servers.scythe_context.env]
WSLENV = "PWD/p:GEMINI_API_KEY/w"
```

注意：

- `cwd` 放 Windows 可用目录，例如 `/mnt/c/Users/you`。不要把 `cwd` 设成 WSL repo 的 UNC 目录，因为 npm/npx 可能经过 CMD，而 CMD 不支持 UNC current directory。
- `PWD/p` 会让 WSL 把当前 workspace 路径转成 Windows process 可读的 UNC path；所以不需要每换一个 repo 就改配置。
- 不要用 Windows `node.exe` 直接执行 WSL checkout 里的 `dist/index.js`，除非该 checkout 的 dependencies 是用 Windows npm 安装的。`better-sqlite3` 和 `sqlite-vec` 都包含 native module，Windows Node 不能加载 Linux npm 安装出的 native binary。

### 可选强化配置

以下配置不是最小启动必需，但在大型 repo、首次 `npx` 下载或想固定工具面时有用：

```toml
[mcp_servers.scythe_context]
startup_timeout_sec = 40
tool_timeout_sec = 120
enabled_tools = [
  "repo_index_status",
  "repo_reindex",
  "repo_context_pack",
  "repo_semantic_search",
  "repo_related_files",
  "gemini_embedding_probe"
]
```

`enabled = true` 和 `required = false` 通常是默认行为，不需要特别写。

如果你真的想固定某一个默认项目，可以在 `[mcp_servers.scythe_context.env]` 设置 `SCYTHE_CONTEXT_DEFAULT_PROJECT`。一般多 repo 使用不需要这样做；Scythe 会优先使用工具调用的 `project_path`，再使用 `PWD`，最后才使用 MCP process 的 `cwd`。

### Gemini / v1beta proxy

```toml
[mcp_servers.scythe_context.env]
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

支持的 auth mode：

- `x-goog-api-key`
- `bearer`
- `query`

启动 Codex 前在 shell 或系统环境中设置 `GEMINI_API_KEY`，避免把 key 写进会同步或会提交的配置文件。

如果使用 Windows Codex App + WSL repo 模式，且设置了额外 Gemini 变量，记得把它们加进 `WSLENV`，例如 `PWD/p:GEMINI_API_KEY/w:GEMINI_BASE_URL/w:GEMINI_AUTH_MODE/w:GEMINI_OUTPUT_DIMENSIONALITY/w`。

## 常用工作流

1. 先检查索引状态：

   ```text
   repo_index_status
   ```

2. 如果 metadata 不存在或 freshness 显示 stale：

   ```text
   repo_reindex({ "dry_run": false })
   ```

3. 需要语义搜索或 context pack 时，再建立 embeddings：

   ```text
   repo_reindex({ "dry_run": false, "index_embeddings": true })
   ```

4. 让 Codex 针对任务拿上下文：

   ```text
   repo_context_pack({ "query": "where is auth token validation handled?" })
   ```

5. 对某个命中文件展开 imports / reverse imports：

   ```text
   repo_related_files({ "path": "src/server/auth.ts" })
   ```

## MCP 工具

| Tool | 用途 |
| --- | --- |
| `repo_index_status` | 查看 index path、metadata/embedding coverage、freshness diagnostics 与建议动作。 |
| `repo_reindex` | 扫描项目并写入 metadata；设置 `index_embeddings=true` 时才会调用 embedding provider。 |
| `repo_context_pack` | 针对任务查询打包 primary snippets、match reasons、related files 与 suggested paths。 |
| `repo_semantic_search` | 对已索引 chunks 做 hybrid 或 semantic search，适合排查 ranking。 |
| `repo_related_files` | 查看单一文件的 symbols、imports、importedBy。 |
| `gemini_embedding_probe` | 测试 Gemini 或 proxy 兼容性，返回 endpoint、latency、错误分类与可修复建议。 |

## 功能状态

已完成：repo 扫描、chunking、SQLite metadata、SQLite FTS5、sqlite-vec、Gemini Embedding 2 provider、semantic/keyword/hybrid search、轻量 symbol/dependency graph、related-file lookup、`repo_context_pack`、provider diagnostics、index freshness diagnostics。

下一步：provider capability cache、安装/原生依赖 doctor、embedding 失败时的 keyword-only fallback、必要时加入 tree-sitter symbol extraction。

## 隐私与本地文件

- `.scythe-context/`: 默认索引目录，不提交。
- `.repo-beacon/`: 旧索引目录名称，仍被 ignore。
- `local/`: 私密 API 测试文件、参考 HTML、截图等本地资料，不提交。
- `.env`: 本地配置，不提交。

不要把 API key、proxy token、私有代码片段或 index database 放进 issue、PR 或公开 logs。

## 文档

- [架构设计](docs/architecture.md)
- [开发计划](docs/development-plan.md)
- [Gemini 兼容性](docs/gemini-compatibility.md)
- [技术栈](docs/tech-stack.md)
- [Codex 集成审查](docs/codex-integration.md)

## 开发与发布检查

```bash
npm test
npm run build
npm audit --omit=dev
npm pack --dry-run
```

确认 package 不包含 `.env`、`.scythe-context/`, `.repo-beacon/`, `local/`, API key 或私密参考文件。
