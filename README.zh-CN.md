# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP 通过 CLI＋Skill 或 MCP，为 coding agent 提供本地代码搜索、import 导航与有范围限制的上下文整理。在陌生项目中找到相关文件路径、行号、符号和文件关联；从本地关键词搜索开始，不需要 API key 或 embedding 服务。

## 什么时候适合使用

- 适合陌生项目、按功能概念查找代码，以及跨文件追踪符号或 imports。
- 已知路径或精确字符串时，使用 `rg` 或直接读取文件。
- 本地关键词搜索不需要 API key；语义搜索需要 Gemini-compatible endpoint。

## 选择使用接口

两个接口由同一个 npm 包提供，共用索引与检索引擎。可以二选一，也能同时使用。

| 接口 | 适用场景 | 搜索默认值 |
| --- | --- | --- |
| CLI＋Skill | Agent 能执行 shell 命令并加载技能，或想直接在终端搜索。 | 本地 `keyword`，不发送 embedding 请求。 |
| MCP | 使用支持 MCP 工具的客户端。 | `hybrid`；纯本地搜索请明确指定 `mode="keyword"`。 |

运行 Scythe 的环境需要 Node.js `>=24.11.0 <27`；Node.js 24 是已测试的基准。目标项目不需要使用 Node.js。Windows、WSL、Linux 和 macOS 请参阅[平台配置](docs/setup.md)。

## CLI＋Skill（同一个包）

同一个 `scythe-context-mcp` npm 包提供 `scythe-context` CLI 和原有 MCP 入口。安装一次后，可选择 CLI＋Skill、MCP，或同时使用。从源码使用时，先执行 `npm run build`，再将下列 `scythe-context` 换成 `node /absolute/path/to/scythe-context-mcp/dist/command.js`。

```bash
npm install -g scythe-context-mcp@0.1.24
scythe-context status
# Run when metadata is missing/stale, or once after upgrading to 0.1.22:
scythe-context index
scythe-context search "where is auth token validation handled?"
scythe-context context "where is auth token validation handled?" --format compact
scythe-context related src/auth.ts
scythe-context doctor
```

CLI 的 search/context 默认使用本地 `keyword` 模式，只返回路径和行号；MCP 保留原有的 `hybrid` 默认值。两个接口共用参数校验、索引、搜索、fallback 和返回格式处理；更换接口本身不会提高检索准确度。

用 `--project /absolute/repo/path` 覆盖默认项目。搜索加上 `--json` 可取得结构化结果；status/index/related/doctor 默认就输出 JSON。`--format` 控制详细程度（search/context 使用 `paths`、`compact`、`snippets`，其他命令使用 `compact`、`full`）。`--output /absolute/result.json` 将结构化结果保存到文件，只打印路径，方便按需读取。其他预算和选项见 `--help`。搜索无结果或 hybrid fallback 时退出码为 0；操作失败或查找时缺少索引则返回非零。doctor 有 error 时返回非零，只有 warning 时返回 0。

包内的 [Skill](skills/scythe-context/SKILL.md) 说明何时搜索、读取文件范围、更新索引和使用 embeddings。将 `skills/scythe-context/` 复制到 agent 的技能目录即可供它发现；CLI 也必须在该 agent 的执行环境中可用。目前不会自动安装 Skill。`scythe-context` 无参数时显示 help；`scythe-context-mcp` 无参数时仍启动 MCP stdio。两个入口都接受上述子命令，也能用 `serve` 明确启动 MCP。

## MCP 快速开始：本地搜索

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

## 语言支持

文本搜索适用于支持的文本文件；结构与 import 导航则按语言提供：

| 语言 | 导航范围 |
| --- | --- |
| JS／TS | 常见声明与 imports、配置别名与继承、明确的 project references、已声明的 workspace 源码 exports。 |
| Python | 常见声明、flat／`src` packages 和相对 imports。 |
| Go | 常见声明及最近一层 `go.mod` 模块内的 packages。 |
| Rust | 常见声明、Cargo 文件模块、明确锚定路径及静态 library／binary 入口。 |
| C# | Namespace、类型、常见方法声明与静态 `.csproj` 项目引用；`using` 保留为 namespace／类型线索。 |
| C++ | Namespace、类型、常见函数声明和相对于当前文件的精确双引号 includes。 |

导航采用保守解析，不等同编译器级别的绑定或完整运行时调用图；不需要目标语言的 SDK 或编译器。详见[语言支持与限制](docs/language-support.md)及[配置驱动导航](docs/config-navigation.md)。

从 0.1.22 之前的版本升级时，即使索引显示 fresh，也请执行一次 `scythe-context index --project /absolute/path/to/repo`。MCP 用户可调用 `repo_reindex`，指定 `dry_run=false`、`index_embeddings=false`。这会更新导航 metadata 并建立切块缓存，不会请求 embeddings。

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

项目已有检索 benchmark 和集成测试，但这些结果**不能证明** MCP 能提高 GPT‑6.1 Sol 任务完成率、速度或降低整体 token 用量。请参阅 [benchmark](docs/benchmark.md) 和[任务 A/B 评估流程](docs/codex-evaluation.md)。

## 可选：使用 embeddings 的语义搜索

先使用关键词搜索与 import 导航。如果相关代码与查询用词不同、本地结果不足，再尝试 hybrid 或 semantic，并在自己的项目比较结果。Embeddings 是可选功能，语言导航与上下文整理都不依赖它。

启用时需要 Gemini-compatible endpoint；建立向量索引会发送代码块，hybrid／semantic 搜索会发送查询文本，可能产生服务费用。配置、命令、模式差异和隐私说明请见[可选语义搜索指南（英文）](docs/semantic-search.md)。

CLI search/context 默认为 `keyword`，MCP 默认为 `hybrid`。配置 key 后，MCP 查询可能连接 provider；纯本地搜索请明确指定 `mode="keyword"`。

如果配置的 endpoint／模型／维度没有代码向量，hybrid 会退回 keyword，semantic 则返回错误，两者都不会先发送查询。

请勿将 `.scythe-context/`、旧版 `.repo-beacon/`、`.env` 和 `local/` 纳入版本控制；使用 `.gitignore` 排除不应索引的私人文件。

## 文档

- [文档索引](docs/README.md)
- [平台配置与高级配置](docs/setup.md)
- [故障排查](docs/troubleshooting.md)
- [检索 benchmark](docs/benchmark.md) · [实际使用评估](docs/dogfood.md)
- [Codex 任务 A/B 评估流程（繁体中文）](docs/codex-evaluation.md)
- [架构（英文）](docs/architecture.md) · [可选语义搜索（英文）](docs/semantic-search.md)
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
