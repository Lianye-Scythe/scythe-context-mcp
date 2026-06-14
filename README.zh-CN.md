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

Codex MCP 配置可以直接用 `npx -y scythe-context-mcp`，不一定要先全局安装。全局安装主要适合先确认 CLI 可执行，或在 Codex 配置中使用短命令。

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
| Codex App on Windows 打开 WSL repo | 建议用 Windows `wsl.exe` 启动 WSL Node，让 SQLite index 留在 WSL filesystem。避免 Windows Node 直接读写 WSL repo 内的 `.scythe-context/`。 |

### Native Windows

请先用 `where node` 和 `npm root -g` 确认你自己的 Windows Node/npm 路径；下面是 nvm4w 安装位置的示例。

最小配置：

```toml
[mcp_servers.scythe_context]
command = 'C:\nvm4w\nodejs\node.exe'
args = ['C:\nvm4w\nodejs\node_modules\npm\bin\npx-cli.js', '-y', 'scythe-context-mcp']
env_vars = ["GEMINI_API_KEY"]
```

如果 `scythe-context-mcp` 已全局安装且 Codex 启动时的 PATH 能找到它，可以更短：

```toml
[mcp_servers.scythe_context]
command = "scythe-context-mcp"
env_vars = ["GEMINI_API_KEY"]
```

### WSL/Linux/macOS

Codex 和 MCP server 都在同一个 Unix-like 环境中运行时，最小配置是：

```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
env_vars = ["GEMINI_API_KEY"]
```

从源码执行时：

```toml
[mcp_servers.scythe_context]
command = "node"
args = ["/path/to/scythe-context-mcp/dist/index.js"]
env_vars = ["GEMINI_API_KEY"]
```

这里 `args` 指向 Scythe Context MCP 的 build 入口；全局配置不要把 `cwd` 固定到某个 repo。Scythe 会优先使用工具调用的 `project_path`，再使用 Codex 启动 MCP 时的 workspace `PWD` / process `cwd`。只有在项目 scoped `.codex/config.toml`，或你真的想 pin 某个 repo 时，才需要设置 `cwd` 或 `SCYTHE_CONTEXT_DEFAULT_PROJECT`。

### Windows Codex App + WSL repo

目前 Codex App on Windows 的 WSL agent mode 可能无法可靠直接启动 WSL-side stdio MCP server。实测较稳定的做法是让 Codex 执行 Windows `wsl.exe`，再由 `wsl.exe` 在 WSL 内启动 WSL Node 与 WSL npm package。

先在 WSL 内安装：

```bash
npm install -g scythe-context-mcp
command -v scythe-context-mcp
scythe-context-mcp --version
```

然后在 Codex config 使用：

```toml
[mcp_servers.scythe_context]
command = "/mnt/c/Windows/System32/wsl.exe"
args = ["-d", "Ubuntu", "--", "bash", "-lc", "PATH=/home/you/.nvm/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin exec /home/you/.nvm/current/bin/scythe-context-mcp"]
startup_timeout_sec = 40
tool_timeout_sec = 120
env_vars = ["PWD", "GEMINI_API_KEY"]

[mcp_servers.scythe_context.env]
WSLENV = "PWD:GEMINI_API_KEY:GEMINI_BASE_URL:GEMINI_MODEL:GEMINI_AUTH_MODE:GEMINI_OUTPUT_DIMENSIONALITY"
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_MODEL = "gemini-embedding-2"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

注意：

- `Ubuntu` 要换成你的 WSL distribution 名称；可用 `wsl.exe -l -v` 查看。
- `/home/you/.nvm/current/bin` 要换成你的 WSL Node/npm 路径；可在 WSL 内用 `which node`、`which scythe-context-mcp` 确认。
- 不要在全局 config 固定 `cwd` 或 `SCYTHE_CONTEXT_DEFAULT_PROJECT`。这个设置会跟着 Codex 当前 workspace 走，不需要每换 repo 就改一次。
- `WSLENV` 这里列的是要跨 WSL/Windows interop 保留的变量名，不是 key 内容。建议把 `GEMINI_API_KEY` 放在 Codex 启动环境或系统环境，并用 `env_vars` 转发；只有本机临时测试才考虑直接写在 `[mcp_servers.scythe_context.env]`。
- 不建议用 Windows Node 直接索引 WSL repo 内的 `.scythe-context/`。SQLite 在 UNC / WSL filesystem 边界可能出现 `database is locked`，而且 native modules 也容易混到 Windows/WSL 不同平台的 binary。

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
  "gemini_embedding_probe",
  "repo_doctor"
]
```

`enabled = true` 和 `required = false` 通常是默认行为，不需要特别写。

如果你真的想固定某一个默认项目，可以在 `[mcp_servers.scythe_context.env]` 设置 `SCYTHE_CONTEXT_DEFAULT_PROJECT`。一般多 repo 使用不需要这样做；Scythe 会优先使用工具调用的 `project_path`，再使用 `PWD`，最后才使用 MCP process 的 `cwd`。

`SCYTHE_CONTEXT_RERANK_MODE` 可设为 `auto` 或 `off`。默认 `auto` 会启用 local code-aware reranker；排查 ranking 问题时可暂时设为 `off`，回到 semantic/keyword merge 的原始排序。

Scythe 会在 repo-local `.scythe-context/provider-capabilities.json` 记录当前 Gemini-compatible provider 的能力观察结果，例如 batch embedding 是否可用、output dimensionality 是否符合预期，以及最近一次 probe / success / failure。这个文件不提交；`repo_reindex(index_embeddings=true)` 会使用它避免反复尝试已知不支持的 batch endpoint。

### Gemini / v1beta proxy

如果不填 URL/model/auth，默认会使用官方 Gemini 兼容配置：

- `GEMINI_BASE_URL`: `https://generativelanguage.googleapis.com/v1beta`
- `GEMINI_MODEL`: `gemini-embedding-2`
- `GEMINI_AUTH_MODE`: `x-goog-api-key`
- `GEMINI_OUTPUT_DIMENSIONALITY`: `1536`

因此官方 Gemini 用户通常只需要提供 `GEMINI_API_KEY`。第三方中转站或自定义模型才需要覆盖下面这些非秘密配置：

模型与 REST endpoint 可对照 Google 官方 [Gemini embeddings 文档](https://ai.google.dev/gemini-api/docs/embeddings)。

```toml
[mcp_servers.scythe_context.env]
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_MODEL = "gemini-embedding-2"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

`GEMINI_API_KEY` 建议放在 Codex 启动环境或系统环境变量，并用 `env_vars = ["GEMINI_API_KEY"]` 转发给 MCP server。除非只做本机临时测试，否则不要把 key 写进会同步或会提交的 config。

支持的 auth mode：

- `x-goog-api-key`
- `bearer`
- `query`

官方 Gemini 通常使用 `x-goog-api-key`；很多第三方中转站使用 `bearer`。如果中转站要求 query string key，可以使用 `query`，必要时再设置 `GEMINI_API_KEY_QUERY_PARAM`。

`WSLENV` 是 WSL interop 规则，不是 Codex 专用字段。只有在 Windows Codex App + WSL repo 并通过 `wsl.exe` wrapper 或 Windows Node 跨环境启动时才需要。若使用上面的 `wsl.exe` wrapper，通常使用无 suffix 形式：

```toml
[mcp_servers.scythe_context.env]
WSLENV = "PWD:GEMINI_API_KEY:GEMINI_BASE_URL:GEMINI_MODEL:GEMINI_AUTH_MODE:GEMINI_OUTPUT_DIMENSIONALITY"
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_MODEL = "gemini-embedding-2"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

若你刻意采用 Windows Node 方案，才需要 `PWD/p` 把 WSL path 转成 Windows 可读 UNC path；但目前不建议用它直接读写 WSL repo 内的 SQLite index。

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
| `repo_doctor` | 不调用外部 API，检查 Node runtime、native modules、Gemini env、provider capability cache、WSL interop 与 index health。 |

`repo_context_pack(mode="hybrid")` 和 `repo_semantic_search(mode="hybrid")` 在 query embedding 不可用时会降级成 keyword-only 结果，并返回 `effectiveMode: "keyword"` 与 `fallback.reason: "embedding_unavailable"`。`mode="semantic"` 不会降级，会返回 `status: "embedding_unavailable"`，因为纯 semantic search 必须有 query embedding。精确字符串、已知路径或小范围检查仍建议直接用 `rg` / 直接读文件。

为了控制 Codex token 消耗，`repo_index_status`、`repo_related_files`、`repo_reindex`、`repo_doctor` 与 `gemini_embedding_probe` 默认返回 compact 摘要，包含决策必要信息与估算输出 token；需要完整诊断资料、完整 skipped file list、vector sample 或 provider capability raw details 时，才使用 `response_mode="full"`。

`repo_context_pack` 与 `repo_semantic_search` 也支持 `response_mode`：

- `compact`：默认模式，返回短 snippets、决策导向 related metadata、suggested paths 与估算输出 token。
- `paths_only`：第一轮探索用，只返回路径、行号与 match reason，适合先找要读的文件。
- `snippets`：需要更多上下文或 ranking 诊断时使用，保留较完整 snippets、分数与 metadata。

建议先用 `response_mode="paths_only"` 或默认 `compact` 找到候选文件，再用 Codex 直接读特定文件或小范围片段。

## 功能状态

已完成：repo 扫描、chunking、SQLite metadata、SQLite FTS5、sqlite-vec、Gemini Embedding 2 provider、semantic/keyword/hybrid search、embedding 失败时的 keyword-only fallback、local code-aware reranker、轻量 symbol/dependency graph、related-file lookup、`repo_context_pack`、provider diagnostics、provider capability cache、index freshness diagnostics、`repo_doctor`。

下一步：扩充 benchmark cases、错误修复提示 polish、必要时加入 tree-sitter symbol extraction。

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
- [Context search benchmark](docs/benchmark.md)

## 开发与发布检查

```bash
npm test
npm run build
npm audit --omit=dev
npm pack --dry-run
```

确认 package 不包含 `.env`、`.scythe-context/`, `.repo-beacon/`, `local/`, API key 或私密参考文件。
