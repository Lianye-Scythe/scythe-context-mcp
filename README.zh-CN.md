# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[繁體中文](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP 是给 Codex App / Codex CLI 使用的本地代码上下文引擎。目标是用本地索引、混合搜索与可配置 embedding provider，帮助 Codex 更快定位相关文件、行号、符号关系与可操作上下文。

当前状态：已具备 repo 扫描、chunk、SQLite/sqlite-vec metadata 与 embedding index、语义搜索、FTS keyword search、hybrid ranking、轻量 symbol/dependency graph、related-file lookup、搜索 context budget、context packer、bounded multi-hop related-file traversal、opt-in related snippet packing、provider diagnostics 与索引 freshness diagnostics。下一阶段优先做 provider capability cache、更多可修复错误提示，以及必要时的 tree-sitter symbols。

## 快速开始

```bash
git clone https://github.com/Lianye-Scythe/scythe-context-mcp.git
cd scythe-context-mcp
npm install
cp .env.example .env
npm run build
```

Runtime 目标是 Node.js 24 LTS。Node 26 可能可用，但在进入 LTS 前不作为主要验收基准。

旧项目名 `repo-beacon-mcp` 已改为 `scythe-context-mcp`。既有本地 Codex thread 可暂时通过旧路径 symlink 继续运行；新的 MCP 配置请使用新路径与 `[mcp_servers.scythe_context]`。旧的 `REPO_BEACON_*` 环境变量仍作为 fallback 兼容，但新配置应改用 `SCYTHE_CONTEXT_*`。

## Codex 配置

在 Codex `~/.codex/config.toml` 或受信任项目的 `.codex/config.toml` 中加入：

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

如果使用第三方 v1beta 中转站：

```toml
[mcp_servers.scythe_context]
command = "node"
args = ["/path/to/scythe-context-mcp/dist/index.js"]
cwd = "/path/to/scythe-context-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 120
env_vars = ["GEMINI_API_KEY"]

[mcp_servers.scythe_context.env]
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

启动 Codex 前在 shell 或系统环境中设置 `GEMINI_API_KEY`，避免把 key 写进会同步或会提交的配置文件。

如果之后改用 npm 安装，可以把 command 换成 package binary：

```toml
[mcp_servers.scythe_context]
command = "scythe-context-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 120
env_vars = ["GEMINI_API_KEY"]
```

## MCP 工具

- `repo_index_status`: 查看项目、索引路径、provider 配置、metadata/embedding 覆盖率与 freshness diagnostics；会列出 new/modified/missing/metadata_changed 的 stale reason samples。
- `gemini_embedding_probe`: 发送一个 embedding request，测试官方 Gemini 或中转站是否兼容；成功/失败都会返回 endpoint、latency 与可修复建议，不返回 API key。
- `repo_reindex`: 扫描项目；`dry_run=true` 回报计划，`dry_run=false` 写入 file/chunk metadata 到 `.scythe-context/index.sqlite`。只有设置 `index_embeddings=true` 时才会调用 Gemini 写入向量，并受 `max_embedding_chunks` 限制。
- `repo_semantic_search`: 对已建立 embeddings 的本地索引做 hybrid 搜索，返回文件、行号、score/distance 与 snippet；可用 `mode=semantic` 排查纯向量结果。支持 `max_context_chars` 控制整次返回的 snippet 总字符数，默认 12000。
- `repo_related_files`: 对已索引文件返回该文件 symbols、imports，以及哪些文件 import 它。适合在 `repo_semantic_search` 找到候选文件后展开上下文。
- `repo_context_pack`: 针对任务查询打包 primary snippets、match reasons、grep keywords、symbols、imports、importedBy 与 suggested paths；支持 `max_seed_files`、`max_related_files`、`related_depth` 控制 bounded multi-hop traversal。related traversal 会优先 source 文件，并标注 `role`。可用 `include_related_snippets=true` 加入少量 related snippets，并由 `max_related_context_chars` 使用独立 budget 控制。

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [开发计划](docs/DEVELOPMENT_PLAN.md)
- [Gemini 兼容性](docs/GEMINI_COMPATIBILITY.md)
- [技术栈](docs/TECH_STACK.md)
- [Codex 集成审查](docs/CODEX_INTEGRATION.md)

## 本地限定文件

本地参考资料与私密 API 文件放在 `local/`，此目录被 `.gitignore` 排除，不会进入 git。建议：

- `local/references/`: 手动保存的文章、HTML、截图等参考资料。
- `local/secrets/`: API key、中转站测试文件、私密配置。

索引目录默认是 `.scythe-context/`；旧 `.repo-beacon/` 也仍被 ignore，避免迁移期间误提交。

## 发布检查

公开推送或发布前请执行：

```bash
npm test
npm run build
npm audit --omit=dev
npm pack --dry-run
```

确认 package 不包含 `.env`、`.scythe-context/`、`.repo-beacon/`、`local/`、API key 或私密参考文件。
