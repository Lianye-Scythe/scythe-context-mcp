# 技術棧與效能設計

## Runtime

目標 runtime：

- Node.js 24 LTS。
- `package.json` 設定為 `>=24.11.0 <27`。
- Node 26 可能可跑，但在進入 LTS 前不作為主要驗收基準。

原因：

- Codex MCP server 是本機長駐/短啟動工具，穩定性比追新 API 重要。
- Node 24 已提供穩定 `fetch`、ESM、Web API 與足夠新的 V8。
- 避免 Node 20 這類已不適合作為新專案基線的版本。

## Current Dependencies

| Package | 用途 | 策略 |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` | MCP server / stdio transport | 用最新 1.x 穩定版 |
| `zod` | MCP tool input schema | 用 v4；MCP SDK 支援 v3/v4 |
| `dotenv` | 本機 `.env` 載入 | 只用於 dev/local |
| `fast-glob` | repo scanner | Phase 1 使用 |
| `ignore` | `.gitignore` 規則 | Phase 1 使用 |
| `typescript` | typecheck/build | 用目前穩定版 |
| `tsx` | dev runner | 只用於開發 |
| `vitest` | unit tests | Phase 1 開始加入 |

Phase 2 預計新增：

| Package | 用途 | 備註 |
| --- | --- | --- |
| `better-sqlite3` | SQLite native driver | 同步 API 簡單、效能好，適合本機 MCP |
| `sqlite-vec` | SQLite vector extension | `vec0(embedding float[1536])` |

暫不引入：

- ORM：schema 很小，直接 SQL 更可控。
- LangChain/LlamaIndex：抽象太厚，對本機 code search 反而增加不可控成本。
- 外部向量 DB：MVP 不需要啟動 Qdrant/Weaviate 這類服務。
- tree-sitter：Phase 1 先做穩定文字 chunker，Phase 5 再引入 symbol graph。

## Storage Choice

正式索引從 Phase 2 使用：

- SQLite metadata。
- SQLite FTS5 keyword index。
- sqlite-vec vector table。

1536 維 float32 向量約 6 KB/chunk，不含 SQLite overhead。估算：

```text
1,000 chunks  ~= 6 MB vector raw data
10,000 chunks ~= 60 MB vector raw data
50,000 chunks ~= 300 MB vector raw data
```

這個量級仍適合本機 SQLite，但不適合 JSON vector 全表解析。

Spike 結論：

- Node 24 LTS + WSL 可載入 `sqlite-vec`。
- `better-sqlite3` 可建立 `vec0(embedding float[1536])` virtual table。
- 寫入 sqlite-vec virtual table 的 `rowid` 需要用 `BigInt` 綁定。
- vector 以 `Float32Array` buffer 寫入與查詢。

## Performance Targets

Phase 1 scanner/chunker：

- 小型 repo: < 1,000 files，dry-run 目標 < 2s。
- 中型 repo: < 10,000 files，dry-run 目標 < 10s。
- 大檔預設跳過或截斷，不允許單檔拖垮整次索引。

Phase 2 indexing：

- 增量索引必須以 file hash/chunk hash 避免重複 embedding。
- embedding batch size 預設 16-64，依 provider 錯誤調整。
- 中轉站不支援 batch 時 fallback 單筆，但要有 rate limit。
- `repo_reindex` 預設只寫 metadata；必須顯式 `index_embeddings=true` 才會產生 embedding API 成本。
- `max_embedding_chunks` 預設限制單次 embedding 數量，避免第一次索引大 repo 時成本失控。

Phase 3 search：

- 已建索引的小/中型 repo 查詢目標 < 500ms，不含 query embedding 網路時間。
- query embedding 網路時間單獨計入，tool response 要能指出 provider latency。
- topK retrieve 先取 50-100，再做 merge/rerank 回傳 8-12 個結果。

## Retrieval Quality Targets

搜尋不能只追 semantic similarity。最低標準：

- 自然語言 query 可找到非字面匹配的實作。
- 精確函式名、檔名、錯誤訊息不能被向量結果蓋掉。
- 中文 query 對英文程式碼要靠 embedding + keyword extraction 雙路徑補強。
- 結果必須有路徑、行號、短 snippet、match reason、grep keywords。

## Efficiency Controls

必要控制：

- `max_file_bytes`
- `max_chunk_chars`
- `max_chunks_per_file`
- `embedding_batch_size`
- `embedding_concurrency`
- `max_embedding_chunks`
- `max_results`
- `max_context_chars`

這些要在 Phase 1/2 進入 config，避免工具在大型 repo 上不可控。

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| 第三方 Gemini 中轉站不支援 batch | 索引慢或失敗 | provider capability cache + 單筆 fallback |
| sqlite-vec native extension 載入失敗 | Phase 2 卡住 | Spike 已通過；仍保留 FTS-only degrade mode |
| 大 repo 初次 embedding 成本高 | 慢、花費高 | dry-run 預估 chunks/token/cost；增量索引 |
| 純語義誤召回 | Codex 讀錯檔 | hybrid ranker、path/symbol boost、grep keywords |
| 私有碼送到第三方 provider | 隱私風險 | 明確 remote embedding 開關與文檔警告 |

## Recommendation

Phase 1 dry-run scanner/chunker 已完成。Phase 2 已完成 `better-sqlite3 + sqlite-vec` 載入 spike、schema 初始化、file/chunk metadata 寫入流程與 embedding index writer。Phase 3 已完成 semantic vector lookup；下一步是 keyword search + hybrid ranker。
