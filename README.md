# Repo Beacon MCP

Repo Beacon MCP 是給 Codex App / Codex CLI 使用的本機程式碼上下文引擎。目標是提供類似 Augment Context Engine / fast-context-mcp 的能力，但資料與索引留在本機，embedding provider 可接官方 Gemini API 或第三方 v1beta 中轉站。

目前狀態：已具備 repo 掃描、chunk、SQLite/sqlite-vec metadata 與 embedding index、語義搜尋、FTS keyword search、hybrid ranking、輕量 symbol/dependency graph、related-file lookup、搜尋 context budget、context packer 與 bounded multi-hop related-file traversal。下一階段是 related snippet packing、tree-sitter symbols 與更完整的 Codex workflow polish。

## Quick Start

```bash
npm install
cp .env.example .env
npm run build
```

Runtime target: Node.js 24 LTS. Node 26 may work, but it is not the baseline until it enters LTS.

在 Codex 設定中加入：

```toml
[mcp_servers.repo_beacon]
command = "node"
args = ["/home/po120/Git/repo-beacon-mcp/dist/index.js"]
env = {
  GEMINI_API_KEY = "your-key",
  GEMINI_OUTPUT_DIMENSIONALITY = "1536"
}
startup_timeout_sec = 20
tool_timeout_sec = 120
```

如果使用第三方 v1beta 中轉站：

```toml
[mcp_servers.repo_beacon]
command = "node"
args = ["/home/po120/Git/repo-beacon-mcp/dist/index.js"]
env = {
  GEMINI_API_KEY = "your-proxy-key",
  GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta",
  GEMINI_AUTH_MODE = "bearer",
  GEMINI_OUTPUT_DIMENSIONALITY = "1536"
}
```

## MCP Tools

- `repo_index_status`: 查看專案、索引路徑、provider 設定與目前實作狀態。
- `gemini_embedding_probe`: 發一個 embedding request，測官方 Gemini 或中轉站是否相容。
- `repo_reindex`: 掃描專案；`dry_run=true` 回報計畫，`dry_run=false` 寫入 file/chunk metadata 到 `.repo-beacon/index.sqlite`。只有設定 `index_embeddings=true` 時才會呼叫 Gemini 寫入向量，並受 `max_embedding_chunks` 限制。
- `repo_semantic_search`: 對已建立 embeddings 的本機索引做 hybrid 搜尋，回傳檔案、行號、score/distance 與 snippet；可用 `mode=semantic` 排查純向量結果。支援 `max_context_chars` 控制整次回傳的 snippet 總字元數，預設 12000。
- `repo_related_files`: 對已索引檔案回傳該檔 symbols、imports，以及哪些檔案 import 它。適合在 `repo_semantic_search` 找到候選檔案後展開上下文。
- `repo_context_pack`: 針對任務查詢打包 primary snippets、match reasons、grep keywords、symbols、imports、importedBy 與 suggested paths；支援 `max_seed_files`、`max_related_files`、`related_depth` 控制 bounded multi-hop traversal。related traversal 會優先 source 檔，並標註 `role`。可用 `include_related_snippets=true` 加入少量 related snippets，並由 `max_related_context_chars` 使用獨立 budget 控制。

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Development Plan](docs/DEVELOPMENT_PLAN.md)
- [Gemini Compatibility](docs/GEMINI_COMPATIBILITY.md)
- [Tech Stack](docs/TECH_STACK.md)

## Local-only Files

本地參考資料與私密 API 檔放在 `local/`，此目錄被 `.gitignore` 排除，不會進 git。建議：

- `local/references/`: 手動保存的文章、HTML、截圖等參考資料。
- `local/secrets/`: API key、中轉站測試檔、私密設定。
