# Repo Beacon MCP

Repo Beacon MCP 是給 Codex App / Codex CLI 使用的本機程式碼上下文引擎。目標是提供類似 Augment Context Engine / fast-context-mcp 的能力，但資料與索引留在本機，embedding provider 可接官方 Gemini API 或第三方 v1beta 中轉站。

目前狀態：專案骨架與設計文檔已建立，MCP server 可註冊工具，Gemini Embedding 2 provider 已具備官方與中轉站相容設定。實際 repo 掃描、chunk、vector store、hybrid search 還在下一階段。

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
- `repo_semantic_search`: 對已建立 embeddings 的本機索引做語義搜尋，回傳檔案、行號、distance 與 snippet。

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Development Plan](docs/DEVELOPMENT_PLAN.md)
- [Gemini Compatibility](docs/GEMINI_COMPATIBILITY.md)
- [Tech Stack](docs/TECH_STACK.md)
