# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[繁體中文](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP 是給 Codex App / Codex CLI 使用的本機程式碼上下文引擎。它在 repo 內建立 SQLite/sqlite-vec 索引，結合語義搜尋、關鍵字搜尋、符號/依賴關係與 context packing，讓 Codex 更快拿到可操作的檔案、行號、片段與相關路徑。

## 核心特性

- 本機優先：metadata、FTS 與向量索引都存在 repo 內的 `.scythe-context/`。
- 混合搜尋：結合 Gemini embeddings、SQLite FTS5、path/symbol ranking，避免只靠單一召回方式。
- Codex 友善輸出：回傳 line ranges、snippets、match reasons、grep keywords、related files 與 suggested paths。
- Gemini-compatible：支援官方 Gemini API，也支援第三方 v1beta proxy。
- 可診斷：內建 provider probe、index freshness、embedding coverage 與可修復建議。

隱私提醒：只有在執行 embedding 相關功能時，query 或 chunk text 才會送到你設定的 Gemini-compatible endpoint。第三方 proxy 應視為可看到這些文字。

## 快速開始

Codex MCP 設定可以直接用 `npx -y scythe-context-mcp`，不一定要先全域安裝。全域安裝主要適合先確認 CLI 可執行，或在 Codex 設定中使用短命令。

```bash
npm install -g scythe-context-mcp
scythe-context-mcp --version
```

Runtime 目標是 Node.js 24 LTS。Node 26 可能可用，但在進入 LTS 前不作為主要驗收基準。

從原始碼執行：

```bash
git clone https://github.com/Lianye-Scythe/scythe-context-mcp.git
cd scythe-context-mcp
npm install
cp .env.example .env
npm run build
```

舊專案名 `repo-beacon-mcp` 已改為 `scythe-context-mcp`。舊的 `REPO_BEACON_*` 環境變數仍作為 fallback 相容，但新設定應改用 `SCYTHE_CONTEXT_*`。

## Codex 設定

Codex MCP 設定使用 `command`、`args`、`cwd`、`env` 與 `env_vars` 等欄位；可參考官方文件：[Model Context Protocol](https://developers.openai.com/codex/mcp) 與 [Configuration Reference](https://developers.openai.com/codex/config-reference)。

### 先選執行環境

| 情境 | 建議 |
| --- | --- |
| Codex 和 MCP 都在 Windows | 用 Windows `node.exe` + Windows npm `npx-cli.js`。 |
| Codex CLI 在 WSL/Linux/macOS | 用同一個環境內的 `npx` 或 `node dist/index.js`。 |
| Codex App on Windows 開 WSL repo | 目前 App 的 WSL MCP bridge 仍可能不穩；建議 MCP 跑 Windows Node，再用 `PWD` + `WSLENV` 把目前 WSL workspace 傳給 Windows process。 |

### Native Windows

請先用 `where node` 和 `npm root -g` 確認你自己的 Windows Node/npm 路徑；下面是 nvm4w 安裝位置的範例。

最小設定：

```toml
[mcp_servers.scythe_context]
command = 'C:\nvm4w\nodejs\node.exe'
args = ['C:\nvm4w\nodejs\node_modules\npm\bin\npx-cli.js', '-y', 'scythe-context-mcp']
env_vars = ["GEMINI_API_KEY"]
```

如果 `scythe-context-mcp` 已全域安裝且 Codex 啟動時的 PATH 能找到它，可以更短：

```toml
[mcp_servers.scythe_context]
command = "scythe-context-mcp"
env_vars = ["GEMINI_API_KEY"]
```

### WSL/Linux/macOS

Codex 和 MCP server 都在同一個 Unix-like 環境中執行時，最小設定是：

```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
env_vars = ["GEMINI_API_KEY"]
```

從原始碼執行時：

```toml
[mcp_servers.scythe_context]
command = "node"
args = ["/path/to/scythe-context-mcp/dist/index.js"]
env_vars = ["GEMINI_API_KEY"]
```

這裡 `args` 指向 Scythe Context MCP 的 build 入口；全域設定不要把 `cwd` 固定到某個 repo。Scythe 會優先使用工具呼叫的 `project_path`，再使用 Codex 啟動 MCP 時的 workspace `PWD` / process `cwd`。只有在專案 scoped `.codex/config.toml`、或你真的想 pin 某個 repo 時，才需要設定 `cwd` 或 `SCYTHE_CONTEXT_DEFAULT_PROJECT`。

### Windows Codex App + WSL repo

目前 Codex App on Windows 的 WSL agent mode 可能無法可靠啟動 WSL-side stdio MCP server。若你遇到 App 裡看不到 MCP tools、MCP handshake timeout、或 config path 混到 Windows/WSL 的問題，建議使用 Windows Node 啟動 MCP，並讓 Scythe Context 透過 WSL path 索引 repo。

最小設定：

```toml
[mcp_servers.scythe_context]
command = "/mnt/c/nvm4w/nodejs/node.exe"
args = ['C:\nvm4w\nodejs\node_modules\npm\bin\npx-cli.js', "-y", "scythe-context-mcp"]
cwd = "/mnt/c/Users/you"
env_vars = ["GEMINI_API_KEY", "PWD"]

[mcp_servers.scythe_context.env]
WSLENV = "PWD/p"
```

注意：

- `cwd` 放 Windows 可用目錄，例如 `/mnt/c/Users/you`。不要把 `cwd` 設成 WSL repo 的 UNC 目錄，因為 npm/npx 可能經過 CMD，而 CMD 不支援 UNC current directory。
- 這個 `cwd` 不是要索引的 repo，只是 Windows process 的安全啟動位置；真正的 WSL repo 由 `PWD/p` 傳入。
- `PWD/p` 會讓 WSL 把目前 workspace 路徑轉成 Windows process 可讀的 UNC path；所以不需要每換一個 repo 就改設定。
- 如果 `GEMINI_API_KEY` 已存在 Windows 使用者環境或由 Codex `env_vars` 直接轉發，就不需要把 key 放進 `WSLENV`。
- 不要用 Windows `node.exe` 直接執行 WSL checkout 裡的 `dist/index.js`，除非該 checkout 的 dependencies 是用 Windows npm 安裝的。`better-sqlite3` 和 `sqlite-vec` 都包含 native module，Windows Node 不能載入 Linux npm 安裝出的 native binary。

中轉站 URL、model、auth mode 可以直接寫在 Codex config 裡，不需要透過 `WSLENV`：

```toml
[mcp_servers.scythe_context.env]
WSLENV = "PWD/p"
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_MODEL = "gemini-embedding-2"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

### 可選強化設定

以下設定不是最小啟動必需，但在大型 repo、首次 `npx` 下載或想固定工具面時有用：

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

`enabled = true` 和 `required = false` 通常是預設行為，不需要特別寫。

如果你真的想固定某一個預設專案，可以在 `[mcp_servers.scythe_context.env]` 設 `SCYTHE_CONTEXT_DEFAULT_PROJECT`。一般多 repo 使用不需要這樣做；Scythe 會優先使用工具呼叫的 `project_path`，再使用 `PWD`，最後才使用 MCP process 的 `cwd`。

### Gemini / v1beta proxy

如果不填 URL/model/auth，預設會使用官方 Gemini 相容設定：

- `GEMINI_BASE_URL`: `https://generativelanguage.googleapis.com/v1beta`
- `GEMINI_MODEL`: `gemini-embedding-2`
- `GEMINI_AUTH_MODE`: `x-goog-api-key`
- `GEMINI_OUTPUT_DIMENSIONALITY`: `1536`

因此官方 Gemini 使用者通常只需要提供 `GEMINI_API_KEY`。第三方中轉站或自訂模型才需要覆蓋下面這些非秘密設定：

模型與 REST endpoint 可對照 Google 官方 [Gemini embeddings 文件](https://ai.google.dev/gemini-api/docs/embeddings)。

```toml
[mcp_servers.scythe_context.env]
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_MODEL = "gemini-embedding-2"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

`GEMINI_API_KEY` 建議放在 Codex 啟動環境或系統環境變數，並用 `env_vars = ["GEMINI_API_KEY"]` 轉發給 MCP server。除非只做本機臨時測試，否則不要把 key 寫進可同步或可提交的 config。

支援的 auth mode：

- `x-goog-api-key`
- `bearer`
- `query`

官方 Gemini 通常使用 `x-goog-api-key`；很多第三方中轉站使用 `bearer`。如果中轉站要求 query string key，可以使用 `query`，必要時再設定 `GEMINI_API_KEY_QUERY_PARAM`。

`WSLENV` 是 WSL interop 規則，不是 Codex 專用欄位。只有在 Windows Codex App + WSL repo 模式需要讓 WSL 把變數轉交給 Windows Node 時才需要。若 `GEMINI_API_KEY`、URL 或 model 只存在 WSL 環境變數，才把它們加進 `WSLENV`：

```toml
[mcp_servers.scythe_context.env]
WSLENV = "PWD/p:GEMINI_API_KEY/w:GEMINI_BASE_URL/w:GEMINI_MODEL/w:GEMINI_AUTH_MODE/w:GEMINI_OUTPUT_DIMENSIONALITY/w"
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_MODEL = "gemini-embedding-2"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

## 常用工作流

1. 先檢查索引狀態：

   ```text
   repo_index_status
   ```

2. 如果 metadata 不存在或 freshness 顯示 stale：

   ```text
   repo_reindex({ "dry_run": false })
   ```

3. 需要語義搜尋或 context pack 時，再建立 embeddings：

   ```text
   repo_reindex({ "dry_run": false, "index_embeddings": true })
   ```

4. 讓 Codex 針對任務拿上下文：

   ```text
   repo_context_pack({ "query": "where is auth token validation handled?" })
   ```

5. 對某個命中檔案展開 imports / reverse imports：

   ```text
   repo_related_files({ "path": "src/server/auth.ts" })
   ```

## MCP 工具

| Tool | 用途 |
| --- | --- |
| `repo_index_status` | 查看 index path、metadata/embedding coverage、freshness diagnostics 與建議動作。 |
| `repo_reindex` | 掃描專案並寫入 metadata；設定 `index_embeddings=true` 時才會呼叫 embedding provider。 |
| `repo_context_pack` | 針對任務查詢打包 primary snippets、match reasons、related files 與 suggested paths。 |
| `repo_semantic_search` | 對已索引 chunks 做 hybrid 或 semantic search，適合排查 ranking。 |
| `repo_related_files` | 查看單一檔案的 symbols、imports、importedBy。 |
| `gemini_embedding_probe` | 測試 Gemini 或 proxy 相容性，回傳 endpoint、latency、錯誤分類與可修復建議。 |

## 功能狀態

已完成：repo 掃描、chunking、SQLite metadata、SQLite FTS5、sqlite-vec、Gemini Embedding 2 provider、semantic/keyword/hybrid search、輕量 symbol/dependency graph、related-file lookup、`repo_context_pack`、provider diagnostics、index freshness diagnostics。

下一步：provider capability cache、安裝/原生依賴 doctor、embedding 失敗時的 keyword-only fallback、必要時加入 tree-sitter symbol extraction。

## 隱私與本機檔案

- `.scythe-context/`: 預設索引目錄，不提交。
- `.repo-beacon/`: 舊索引目錄名稱，仍被 ignore。
- `local/`: 私密 API 測試檔、參考 HTML、截圖等本機資料，不提交。
- `.env`: 本機設定，不提交。

不要把 API key、proxy token、私有程式碼片段或 index database 放進 issue、PR 或公開 logs。

## 文件

- [架構設計](docs/architecture.md)
- [開發計畫](docs/development-plan.md)
- [Gemini 相容性](docs/gemini-compatibility.md)
- [技術棧](docs/tech-stack.md)
- [Codex 整合審查](docs/codex-integration.md)

## 開發與發佈檢查

```bash
npm test
npm run build
npm audit --omit=dev
npm pack --dry-run
```

確認 package 不包含 `.env`、`.scythe-context/`, `.repo-beacon/`, `local/`, API key 或私密參考檔。
