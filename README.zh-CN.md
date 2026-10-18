# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP 帮助 coding agent 找到相关代码，追踪符号、imports 和反向引用，通过 CLI＋Skill 或 MCP 返回文件路径、行号和必要片段。本地关键词搜索不需要 API key；语义搜索是可选功能。

## 什么时候适合使用

| 需求 | 优先使用 |
| --- | --- |
| 已知文件、精确标识符、错误消息或正则表达式 | 直接读文件或 `rg`。 |
| 在陌生项目中取得排序结果和相关文件上下文 | Scythe 关键词搜索与导航。 |
| 相关实现可能与功能描述使用不同用词 | 可选的 hybrid 向量混合搜索。 |

关键词搜索仍依赖词汇匹配。Scythe 提供的额外能力是排序与跨文件上下文，不需要让每次 `rg` 查找都改用它。

## 选择使用接口

两个接口由同一个 `scythe-context-mcp` npm 包提供，可以二选一，也能同时使用。

| 接口 | 适用场景 | 搜索默认值 |
| --- | --- | --- |
| CLI＋Skill | Agent 能执行 shell 命令并加载技能，或直接在终端搜索。 | 本地 `keyword`。 |
| MCP | 使用支持 MCP 工具的客户端。 | `hybrid`；纯本地查找请指定 `mode="keyword"`。 |

Scythe 需要 Node.js `>=24.11.0 <27`；Node.js 24 是已测试的基准。目标项目不需要 Node.js。请在与文件相同的执行环境安装、运行 Scythe；详见 [Windows、WSL、Linux 和 macOS 配置](docs/setup.md)。

## 快速开始

### CLI＋Skill

**1. 安装 CLI 并搜索项目。** 将路径与查询换成自己的项目及相关词汇：

```bash
cd /absolute/path/to/your/repo
npm install -g scythe-context-mcp@0.1.24
scythe-context index
scythe-context context "auth token" --format compact --max-results 1
```

`index` 将本地 metadata 写入 `.scythe-context/`，不会请求 embeddings；源码变更后需要更新。直接在终端执行这些命令不必安装 Skill。

**2. 为 agent 安装 Skill。** 先找到全局 npm 包目录：

```bash
npm root -g
```

在该目录内，通过 agent 的技能安装流程安装整个 `scythe-context-mcp/skills/scythe-context/` 文件夹，或将它复制到 agent 配置的技能目录。Skill 会指引何时使用 `rg`、Scythe 和 embeddings。npm 安装或升级**不会**安装、更新这份独立副本；详见 [Skill 配置（英文）](docs/setup.md#cli--skill-local-search-first)。

### MCP

Codex 在 Linux、macOS 或 WSL 运行时，将以下内容加入 `~/.codex/config.toml`（或你配置的 Codex home），再重启客户端。原生 Windows 或 Windows App＋WSL 请使用[平台配置指南](docs/setup.md)。

```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
```

请 agent 执行以下 **MCP 工具调用，不是 shell 命令**。请替换路径；只有 metadata 不存在或过期时才重新索引：

```text
repo_index_status({ "project_path": "/absolute/path/to/your/repo" })
repo_reindex({ "project_path": "/absolute/path/to/your/repo", "dry_run": false, "index_embeddings": false })
repo_context_pack({ "project_path": "/absolute/path/to/your/repo", "query": "auth token", "mode": "keyword" })
```

此示例明确指定 keyword，因此查找留在本地。配置失败时，使用 `repo_doctor` 和[故障排查](docs/troubleshooting.md)。

## 搜索结果长什么样

以下是含 `src/auth.ts`、`src/app.ts` 两个文件的示例项目，执行上述命令的实际输出；项目路径已归一化。实际结果取决于你的项目：

```text
Project: /absolute/path/to/your/repo
Mode: keyword
src/auth.ts:1-3
  keyword/path match
export function validateToken(token: string) {
  return token.length > 0;
}
Related: src/auth.ts (source)
Related: src/app.ts (source)
Suggested: src/auth.ts
Suggested: src/app.ts
```

Agent 可接着读取返回的行号范围，并追踪相关文件。`search`、`related`、`status`、`doctor`、JSON、长度预算和结果存档，详见[命令与输出参考（英文）](docs/setup.md#cli-commands-and-mcp-tools)。

## 语言支持

文本搜索适用于支持的文本文件；结构与本地导航范围如下：

| 语言 | 导航范围 |
| --- | --- |
| JS／TS | 声明、相对 imports、配置别名与继承、明确的 project references、已声明的 workspace 源码 exports。 |
| Python | 声明、flat／`src` packages、相对 imports。 |
| Go | 声明与最近一层 `go.mod` 模块内的 packages。 |
| Rust | 声明、Cargo 文件模块、明确锚定路径、静态 library／binary 入口。 |
| C# | Namespace、类型、常见方法声明与静态 `.csproj` 项目引用；`using` 保留为线索。 |
| C++ | Namespace、类型、常见函数声明和相对于当前文件的精确双引号 includes。 |

不需要目标语言的编译器或 SDK。导航采用保守的源码解析，各语言限制详见[语言支持](docs/language-support.md)与[配置驱动导航](docs/config-navigation.md)。旧版用户请参阅[索引升级说明（英文）](docs/setup.md#upgrading-an-existing-index)。

## 可选：embeddings

已知可能出现在代码里的词汇时，先用 keyword。如果用词差异让本地结果不足，hybrid 可结合关键词与向量检索，semantic 则只使用向量。Skill 会在值得使用且符合任务授权范围时，指引首次建立和后续更新向量。

Embeddings 需要 Gemini-compatible endpoint。建立向量时会发送代码块；hybrid／semantic 在有相符代码向量时会发送查询文本，可能产生服务费用。没有相符向量时，hybrid 会退回本地搜索，semantic 会在发送查询前返回错误。CLI 默认 keyword，MCP 默认 hybrid。

详见[语义搜索、凭证、更新与隐私（英文）](docs/semantic-search.md)。只有 API key 不会自动产生向量，也不会让 CLI 自动切换模式。

## 限制与隐私

- 文件修改后需要更新索引，目前没有自动监视。相关文件是导航线索，不等同编译器绑定或完整运行时调用图。
- 使用根目录的 `.gitignore` 排除私人文件；勿将 `.scythe-context/`、旧版 `.repo-beacon/`、`.env` 和 `local/` 纳入版本控制。
- 搜索 benchmark 不代表 agent 完成任务更快或总 token 更少。详见 [benchmark](docs/benchmark.md) 和[任务 A/B 评估流程（繁体中文）](docs/codex-evaluation.md)。

## 更多信息

- [客户端配置：Codex CLI、Claude Code、Antigravity CLI（英文）](docs/client-integration.md)
- [文档索引](docs/README.md) · [配置与命令参考](docs/setup.md) · [故障排查](docs/troubleshooting.md)
- [架构（英文）](docs/architecture.md) · [流程验证与剩余限制（英文）](docs/retrieval-workflow-audit.md)
- [更新记录](CHANGELOG.md) · [贡献与源码开发](CONTRIBUTING.md) · [发布流程](docs/release.md)
