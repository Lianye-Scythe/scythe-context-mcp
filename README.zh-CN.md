# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[繁體中文](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP 是给 Codex App / Codex CLI 使用的本地代码上下文引擎。它在 repo 内建立 SQLite/sqlite-vec 索引，结合语义搜索、关键字搜索、符号/依赖关系与 context packing，让 Codex 更快拿到可操作的文件、行号、片段与相关路径。

## 为什么用它

- **本地优先**：metadata、FTS 与向量索引都存在 repo 内的 `.scythe-context/`。
- **混合搜索**：结合 Gemini embeddings、SQLite FTS5、path/symbol ranking，避免只靠单一召回方式。
- **Codex 友好输出**：返回 line ranges、snippets、match reasons、grep keywords、related files 与 suggested paths。
- **可接自己的 provider**：支持官方 Gemini API，也支持第三方 Gemini-compatible v1beta proxy。
- **可诊断**：内置 provider probe、index freshness、embedding coverage 与可修复建议。

隐私提醒：只有在执行 embedding 相关功能时，query 或 chunk text 才会发送到你配置的 Gemini-compatible endpoint。第三方 proxy 应视为可以看到这些文字。

## 功能状态

已完成：

- repo 扫描、binary/large-file skip、chunking
- SQLite metadata、SQLite FTS5、sqlite-vec 向量索引
- Gemini Embedding 2 provider 与 batch fallback
- semantic / keyword / hybrid search
- 轻量 symbol/dependency graph
- related-file lookup、bounded multi-hop traversal
- `repo_context_pack` context budgeting 与 related snippet packing
- provider diagnostics 与 index freshness diagnostics

下一步：

- provider capability cache
- 更完整的安装/原生依赖 doctor
- embedding 失败时的 keyword-only fallback
- 必要时加入 tree-sitter symbol extraction

## 安装

### 从 npm 安装

套件发布后可使用：

```bash
npm install -g scythe-context-mcp
```

### 从源码安装

```bash
git clone https://github.com/Lianye-Scythe/scythe-context-mcp.git
cd scythe-context-mcp
npm install
cp .env.example .env
npm run build
```

Runtime 目标是 Node.js 24 LTS。Node 26 可能可用，但在进入 LTS 前不作为主要验收基准。

旧项目名 `repo-beacon-mcp` 已改为 `scythe-context-mcp`。旧的 `REPO_BEACON_*` 环境变量仍作为 fallback 兼容，但新配置应改用 `SCYTHE_CONTEXT_*`。

## Codex 配置

### npm binary

如果已用 npm 全局安装：

```toml
[mcp_servers.scythe_context]
command = "scythe-context-mcp"
enabled = true
required = false
startup_timeout_sec = 20
tool_timeout_sec = 120
env_vars = ["GEMINI_API_KEY"]
enabled_tools = [
  "repo_index_status",
  "repo_reindex",
  "repo_context_pack",
  "repo_semantic_search",
  "repo_related_files",
  "gemini_embedding_probe"
]

[mcp_servers.scythe_context.env]
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

### 本地 checkout

如果从源码执行：

```toml
[mcp_servers.scythe_context]
command = "node"
args = ["/path/to/scythe-context-mcp/dist/index.js"]
cwd = "/path/to/scythe-context-mcp"
enabled = true
required = false
startup_timeout_sec = 20
tool_timeout_sec = 120
env_vars = ["GEMINI_API_KEY"]

[mcp_servers.scythe_context.env]
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

### 第三方 v1beta proxy

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

## 隐私与本地文件

- `.scythe-context/`: 默认索引目录，不提交。
- `.repo-beacon/`: 旧索引目录名称，仍被 ignore。
- `local/`: 私密 API 测试文件、参考 HTML、截图等本地资料，不提交。
- `.env`: 本地配置，不提交。

不要把 API key、proxy token、私有代码片段或 index database 放进 issue、PR 或公开 logs。

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [开发计划](docs/DEVELOPMENT_PLAN.md)
- [Gemini 兼容性](docs/GEMINI_COMPATIBILITY.md)
- [技术栈](docs/TECH_STACK.md)
- [Codex 集成审查](docs/CODEX_INTEGRATION.md)

## 开发与发布检查

```bash
npm test
npm run build
npm audit --omit=dev
npm pack --dry-run
```

确认 package 不包含 `.env`、`.scythe-context/`, `.repo-beacon/`, `local/`, API key 或私密参考文件。
