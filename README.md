# Scythe Context MCP

Scythe Context MCP 是給 Codex App / Codex CLI 使用的本機程式碼上下文引擎。目標是提供類似 Augment Context Engine / fast-context-mcp 的能力，但資料與索引留在本機，embedding provider 可接官方 Gemini API 或第三方 v1beta 中轉站。

目前狀態：已具備 repo 掃描、chunk、SQLite/sqlite-vec metadata 與 embedding index、語義搜尋、FTS keyword search、hybrid ranking、輕量 symbol/dependency graph、related-file lookup、搜尋 context budget、context packer、bounded multi-hop related-file traversal 與 opt-in related snippet packing。下一階段優先做 provider diagnostics、錯誤訊息硬化與索引新鮮度訊號；tree-sitter symbols 會在 regex extraction 明確成為 retrieval 品質瓶頸時再加入。

## Quick Start

```bash
npm install
cp .env.example .env
npm run build
```

Runtime target: Node.js 24 LTS. Node 26 may work, but it is not the baseline until it enters LTS.

舊專案名 `repo-beacon-mcp` 已改為 `scythe-context-mcp`。既有本機 Codex thread 可暫時透過舊路徑 symlink 繼續運作；新的 MCP 設定請使用新路徑與 `[mcp_servers.scythe_context]`。舊的 `REPO_BEACON_*` 環境變數仍作為 fallback 相容，但新設定應改用 `SCYTHE_CONTEXT_*`。

在 Codex `~/.codex/config.toml` 或受信任專案的 `.codex/config.toml` 中加入：

```toml
[mcp_servers.scythe_context]
command = "node"
args = ["/home/po120/Git/scythe-context-mcp/dist/index.js"]
cwd = "/home/po120/Git/scythe-context-mcp"
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

如果使用第三方 v1beta 中轉站：

```toml
[mcp_servers.scythe_context]
command = "node"
args = ["/home/po120/Git/scythe-context-mcp/dist/index.js"]
cwd = "/home/po120/Git/scythe-context-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 120
env_vars = ["GEMINI_API_KEY"]

[mcp_servers.scythe_context.env]
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

啟動 Codex 前在 shell 或系統環境中設定 `GEMINI_API_KEY`，避免把 key 寫進可同步或可提交的設定檔。

## MCP Tools

- `repo_index_status`: 查看專案、索引路徑、provider 設定與目前實作狀態。
- `gemini_embedding_probe`: 發一個 embedding request，測官方 Gemini 或中轉站是否相容；成功/失敗都回傳 endpoint、latency 與可修復建議，不回傳 API key。
- `repo_reindex`: 掃描專案；`dry_run=true` 回報計畫，`dry_run=false` 寫入 file/chunk metadata 到 `.scythe-context/index.sqlite`。只有設定 `index_embeddings=true` 時才會呼叫 Gemini 寫入向量，並受 `max_embedding_chunks` 限制。
- `repo_semantic_search`: 對已建立 embeddings 的本機索引做 hybrid 搜尋，回傳檔案、行號、score/distance 與 snippet；可用 `mode=semantic` 排查純向量結果。支援 `max_context_chars` 控制整次回傳的 snippet 總字元數，預設 12000。
- `repo_related_files`: 對已索引檔案回傳該檔 symbols、imports，以及哪些檔案 import 它。適合在 `repo_semantic_search` 找到候選檔案後展開上下文。
- `repo_context_pack`: 針對任務查詢打包 primary snippets、match reasons、grep keywords、symbols、imports、importedBy 與 suggested paths；支援 `max_seed_files`、`max_related_files`、`related_depth` 控制 bounded multi-hop traversal。related traversal 會優先 source 檔，並標註 `role`。可用 `include_related_snippets=true` 加入少量 related snippets，並由 `max_related_context_chars` 使用獨立 budget 控制。

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Development Plan](docs/DEVELOPMENT_PLAN.md)
- [Gemini Compatibility](docs/GEMINI_COMPATIBILITY.md)
- [Tech Stack](docs/TECH_STACK.md)
- [Codex Integration Review](docs/CODEX_INTEGRATION.md)

## Local-only Files

本地參考資料與私密 API 檔放在 `local/`，此目錄被 `.gitignore` 排除，不會進 git。建議：

- `local/references/`: 手動保存的文章、HTML、截圖等參考資料。
- `local/secrets/`: API key、中轉站測試檔、私密設定。

索引目錄預設為 `.scythe-context/`；舊 `.repo-beacon/` 也仍被 ignore，避免遷移期間誤提交。
