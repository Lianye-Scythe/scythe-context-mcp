# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[繁體中文](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP 是給 Codex App / Codex CLI 使用的本機程式碼上下文引擎。它在 repo 內建立 SQLite/sqlite-vec 索引，結合語義搜尋、關鍵字搜尋、符號/依賴關係與 context packing，讓 Codex 更快拿到可操作的檔案、行號、片段與相關路徑。

## 為什麼用它

- **本機優先**：metadata、FTS 與向量索引都存在 repo 內的 `.scythe-context/`。
- **混合搜尋**：結合 Gemini embeddings、SQLite FTS5、path/symbol ranking，避免只靠單一召回方式。
- **Codex 友善輸出**：回傳 line ranges、snippets、match reasons、grep keywords、related files 與 suggested paths。
- **可接自己的 provider**：支援官方 Gemini API，也支援第三方 Gemini-compatible v1beta proxy。
- **可診斷**：內建 provider probe、index freshness、embedding coverage 與可修復建議。

隱私提醒：只有在執行 embedding 相關功能時，query 或 chunk text 才會送到你設定的 Gemini-compatible endpoint。第三方 proxy 應視為可看到這些文字。

## 功能狀態

已完成：

- repo 掃描、binary/large-file skip、chunking
- SQLite metadata、SQLite FTS5、sqlite-vec 向量索引
- Gemini Embedding 2 provider 與 batch fallback
- semantic / keyword / hybrid search
- 輕量 symbol/dependency graph
- related-file lookup、bounded multi-hop traversal
- `repo_context_pack` context budgeting 與 related snippet packing
- provider diagnostics 與 index freshness diagnostics

下一步：

- provider capability cache
- 更完整的安裝/原生依賴 doctor
- embedding 失敗時的 keyword-only fallback
- 必要時加入 tree-sitter symbol extraction

## 安裝

### 從 npm 安裝

套件發佈後可使用：

```bash
npm install -g scythe-context-mcp
```

### 從原始碼安裝

```bash
git clone https://github.com/Lianye-Scythe/scythe-context-mcp.git
cd scythe-context-mcp
npm install
cp .env.example .env
npm run build
```

Runtime 目標是 Node.js 24 LTS。Node 26 可能可用，但在進入 LTS 前不作為主要驗收基準。

舊專案名 `repo-beacon-mcp` 已改為 `scythe-context-mcp`。舊的 `REPO_BEACON_*` 環境變數仍作為 fallback 相容，但新設定應改用 `SCYTHE_CONTEXT_*`。

## Codex 設定

### npm binary

如果已用 npm 全域安裝：

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

### 本機 checkout

如果從原始碼執行：

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

支援的 auth mode：

- `x-goog-api-key`
- `bearer`
- `query`

啟動 Codex 前在 shell 或系統環境中設定 `GEMINI_API_KEY`，避免把 key 寫進可同步或可提交的設定檔。

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

## 隱私與本機檔案

- `.scythe-context/`: 預設索引目錄，不提交。
- `.repo-beacon/`: 舊索引目錄名稱，仍被 ignore。
- `local/`: 私密 API 測試檔、參考 HTML、截圖等本機資料，不提交。
- `.env`: 本機設定，不提交。

不要把 API key、proxy token、私有程式碼片段或 index database 放進 issue、PR 或公開 logs。

## 文件

- [架構設計](docs/ARCHITECTURE.md)
- [開發計畫](docs/DEVELOPMENT_PLAN.md)
- [Gemini 相容性](docs/GEMINI_COMPATIBILITY.md)
- [技術棧](docs/TECH_STACK.md)
- [Codex 整合審查](docs/CODEX_INTEGRATION.md)

## 開發與發佈檢查

```bash
npm test
npm run build
npm audit --omit=dev
npm pack --dry-run
```

確認 package 不包含 `.env`、`.scythe-context/`, `.repo-beacon/`, `local/`, API key 或私密參考檔。
