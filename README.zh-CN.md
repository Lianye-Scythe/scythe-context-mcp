# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP 帮助 Codex 在不知道文件位置时找到代码。它在本地索引项目，返回文件路径、行号范围和相关文件；可选的 Gemini embeddings 提供语义搜索。

## 什么时候适合使用

- 适合陌生项目、按功能概念查找代码，以及跨文件追踪符号或 imports。
- 已知路径或精确字符串时，使用 `rg` 或直接读取文件。
- 本地关键词搜索不需要 API key；语义搜索需要 Gemini-compatible endpoint。

项目已有检索 benchmark 和集成测试，但这些结果**不能证明** MCP 能提高 GPT‑6.1 Sol 任务完成率、速度或降低整体 token 用量。请参阅 [benchmark](docs/benchmark.md) 和[任务 A/B 评估流程](docs/codex-evaluation.md)。

## 快速开始：本地搜索

需要 Node.js 24.11+，支持范围为 `>=24.11.0 <27`；Node.js 24 是已测试的基准。Node 和 npm 应在 MCP server 所用的同一环境中运行。

Codex CLI 在 Linux、macOS 或 WSL 运行时，将以下配置加入 `~/.codex/config.toml`（或你配置的 Codex home）。受信任的项目可使用 `.codex/config.toml`：

```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
```

不必全局安装；`npx` 会在第一次使用时下载包。原生 Windows 或 Windows Codex App 搭配 WSL 项目，请改用[平台配置指南](docs/setup.md)。

修改配置后重启 Codex。CLI 可通过 `/mcp` 查看连接；App 则确认 Scythe 工具已出现。

请 Codex 执行以下 **MCP 工具调用，不是 shell 命令**。将项目路径换成 server 所在环境的绝对路径：

```text
repo_index_status({ "project_path": "/absolute/path/to/your/repo" })
repo_reindex({ "project_path": "/absolute/path/to/your/repo", "dry_run": false, "index_embeddings": false })
repo_context_pack({ "project_path": "/absolute/path/to/your/repo", "query": "where is auth token validation handled?", "mode": "keyword" })
```

只有索引不存在或过期时才运行 `repo_reindex`。它将 metadata 写入 `.scythe-context/`；`index_embeddings=false` 不会将代码块发送到 embedding endpoint。

成功查找会返回包含路径和行号的 `primaryResults`。`repo_context_pack` 默认为 `response_mode="paths_only"`；接着让 Codex 读取命中的文件范围。需要短片段时指定 `response_mode="compact"`。配置失败时，先使用 `repo_doctor` 和[故障排查指南](docs/troubleshooting.md)。

## 可选语义搜索与隐私

将 `GEMINI_API_KEY` 保留在启动 Codex 的环境中，再通过现有 server 配置转发。不要提交 key。接着建立向量并使用 hybrid 搜索：

```toml
# Add this field to the existing [mcp_servers.scythe_context] table.
env_vars = ["GEMINI_API_KEY"]
```

```text
repo_reindex({ "project_path": "/absolute/path/to/your/repo", "dry_run": false, "index_embeddings": true })
repo_context_pack({ "project_path": "/absolute/path/to/your/repo", "query": "where is auth token validation handled?", "mode": "hybrid" })
```

这些调用会将项目代码块和查询文本发送到配置的 endpoint，可能产生 provider 费用。默认为 `https://generativelanguage.googleapis.com/v1beta`、模型 `gemini-embedding-2`、1536 维。Proxy 和认证配置请参阅[配置指南](docs/setup.md)。

**搜索模式默认仍是 `hybrid`，快速开始则明确指定 `keyword`。** 配置 key 后，省略 `mode` 可能将查询发送到 provider。请使用 `mode="keyword"` 避免 embedding 请求。

| 模式 | Embedding 请求 | 查询 embedding 失败时 |
| --- | --- | --- |
| `keyword` | 无；只需要 metadata | 不适用 |
| `hybrid`（默认） | 发送查询；索引向量提供语义检索 | 回退到 keyword 并报告 fallback |
| `semantic` | 发送查询；需要索引向量 | 返回错误，不回退到 keyword |

`GEMINI_REQUEST_TIMEOUT_MS` 默认为 `10000`，限制每次 embedding 请求，包括读取响应正文；不限制整个索引任务的时间。`gemini_embedding_probe` 也会将测试文本发送到 endpoint。第三方 proxy 能看到发送给它的文本。

索引保存在 `.scythe-context/`。请勿将该目录、旧版 `.repo-beacon/`、`.env` 或 `local/` 纳入版本控制。使用 `.gitignore` 排除不应索引的私人文件，启用 embeddings 前先确认范围。不要在公开 issue 或 log 中附上秘密、私人代码或索引数据库。

## 工具与目前限制

| 工具 | 用途 |
| --- | --- |
| `repo_index_status` | 检查 metadata、embedding 覆盖率和索引新鲜度。 |
| `repo_reindex` | 更新 metadata；只有 `index_embeddings=true` 才发送代码块建立向量。 |
| `repo_context_pack` | 按任务查找代码；默认返回路径和行号。 |
| `repo_semantic_search` | 检查 keyword、hybrid 或 semantic 排序；默认 compact 输出。 |
| `repo_related_files` | 查看文件的符号、imports 和反向 imports。 |
| `repo_doctor` | 不调用外部 API，检查本地配置和索引状态。 |
| `gemini_embedding_probe` | 用提供的文本测试配置的 embedding endpoint。 |

符号和 imports 默认使用 regex 提取；tree-sitter 为实验功能，需要另行配置 grammar。相关文件结果是导航线索，并非完整的运行时调用图。文件变更后需要更新索引；embedding 覆盖率可能不完整。

## 文档

- [平台配置与高级配置](docs/setup.md)
- [故障排查](docs/troubleshooting.md)
- [检索 benchmark](docs/benchmark.md) · [实际使用评估](docs/dogfood.md)
- [Codex 任务 A/B 评估流程（繁体中文）](docs/codex-evaluation.md)
- [架构（繁体中文）](docs/architecture.md) · [Gemini provider 细节（繁体中文）](docs/gemini-compatibility.md)
- [贡献指南](CONTRIBUTING.md) · [发布流程](docs/release.md) · [更新记录](CHANGELOG.md)

## 开发

请在运行 Node 的环境安装依赖，尤其是 Windows 和 WSL：

```bash
git clone https://github.com/Lianye-Scythe/scythe-context-mcp.git
cd scythe-context-mcp
npm ci
npm run build
npm run verify
```

从源码配置 MCP 时，让 `node` 指向 `dist/index.js` 的绝对路径；请参阅[配置指南](docs/setup.md)。用户可见行为变更时，请同步更新三种语言的 README。
