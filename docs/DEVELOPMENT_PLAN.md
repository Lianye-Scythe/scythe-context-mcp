# 開發設計方案

## Phase 0: 初始化與設計

狀態：已完成。

交付：

- Git repository 初始化。
- TypeScript MCP server 骨架。
- Gemini Embedding 2 REST provider。
- 官方 Gemini / 第三方 v1beta 中轉站設定。
- 架構與開發文檔。

驗收：

- `npm run build` 成功。
- Codex 可啟動 MCP server。
- `repo_index_status` 可回傳狀態。
- `gemini_embedding_probe` 可測 provider。

## Phase 1: File Scanner + Chunker

狀態：已完成 dry-run MVP。

目標：能掃描 repo 並產生穩定 chunks。

工作項：

1. 實作 `.gitignore` 載入。
2. 實作內建 ignore 清單。
3. 偵測 binary / 大檔。
4. 實作文字 chunker。
5. 產出 chunk hash。
6. 加入 `repo_reindex` dry-run 模式。
7. 加入 scanner/chunker 單元測試。

工具變更：

```text
repo_reindex(project_path, force, dry_run)
repo_index_status(project_path)
```

驗收：

- 能列出會被索引的檔案數與 chunk 數。
- dry-run 會輸出 skipped files 與 skip reasons。
- 超過預設大小限制的檔案會被跳過或截斷，不能拖垮索引。
- HTML 參考檔這類大檔不會讓索引失控。
- chunk hash 對同內容穩定，換行與路徑處理有測試覆蓋。

## Phase 2: Local Storage

狀態：已完成。

目標：能把檔案、chunk、embedding metadata 存到本機。

MVP 儲存選型：

- SQLite metadata。
- sqlite-vec vector index。
- SQLite FTS5 keyword index。
- 測試可用 in-memory fake store，但正式索引不走 JSON vector。

工作項：

1. 建立 schema migration。
2. 實作 file/chunk upsert。
3. 實作 stale chunk cleanup。
4. 實作 embedding cache。
5. 記錄 provider/model/dimensions。
6. 建立 `embedding_sets`，避免不同 base URL/model/dimensions 的向量混用。
7. `embedBatch` 不支援時 fallback 到逐筆 `embedContent`。
8. 加入 embedding rate limit 與 batch size 設定。
9. sqlite-vec rowid 寫入使用 `BigInt`，避免 better-sqlite3 綁定成非整數型別。

已完成：

- SQLite metadata schema。
- dimension-specific sqlite-vec virtual table，例如 `vec_embeddings_1536`。
- file upsert。
- chunk insert de-duplication。
- embedding set de-duplication。
- embedding metadata id 與 sqlite-vec rowid 的連結測試。
- `repo_reindex(dry_run=false)` 寫入 `.repo-beacon/index.sqlite` 的 metadata index。
- `repo_reindex(dry_run=false, index_embeddings=true)` 會顯式呼叫 embedding provider，寫入 `embeddings` 與 `vec_embeddings_1536`。
- `max_embedding_chunks` 限制單次 embedding 工作量，避免成本失控。
- batch embedding 失敗時 fallback 到逐筆 embedding。
- `file_symbols` 與 `file_dependencies` 已加入 schema，與 chunk/embedding cache 解耦。

驗收：

- 重跑索引不重複 embedding 未變更 chunks。
- 更換 `GEMINI_MODEL` 或 dimensions 時會建立新 embedding set。
- 中轉站不支援 batch 時，索引仍可完成。
- 1536 維向量會被驗證 dimensions，一旦 provider 回傳維度不符就 fail fast。

## Phase 3: Semantic Search + Minimal Keyword

狀態：已完成。

目標：`repo_semantic_search` 真正返回相關程式碼片段。

工作項：

1. query embedding。
2. cosine similarity。
3. topK retrieve。
4. result formatter。
5. line range merge。
6. grep keyword suggestion。
7. 對 path、filename、symbol-looking tokens 加最低限度 boost。

回傳格式草案：

```json
{
  "query": "payment logging flow",
  "results": [
    {
      "path": "src/services/payments.ts",
      "startLine": 42,
      "endLine": 96,
      "score": 0.88,
      "matchType": "semantic",
      "snippet": "...",
      "grepKeywords": ["processPayment", "logger", "payment"]
    }
  ]
}
```

驗收：

- 自然語言查詢可找到非同字面命中的檔案。
- 返回結果可讓 Codex 直接接著 Read/Edit。
- 精確函式名查詢不應被純語義結果完全蓋掉。

已完成：

- query embedding。
- sqlite-vec KNN lookup。
- 回傳 path、line range、distance、snippet。
- index missing 時回傳可修復訊息。
- SQLite FTS5 keyword search。
- hybrid ranker 合併 semantic/keyword 結果。
- result formatter 回傳 `matchReason` 與 `grepKeywords`。

## Phase 4: Advanced Hybrid Search

狀態：MVP 已完成。

目標：改善 precision，避免純 embedding 漏掉符號名稱。

工作項：

1. 加入 keyword search。
2. path/name boost。
3. symbols boost。
4. query rewrite：從自然語言抽 grep keywords。
5. 結果去重與合併。

工具：

```text
repo_semantic_search(query, project_path, max_results, mode="hybrid")
```

驗收：

- 已知函式名搜尋優先命中精確檔案。
- 中文 query 仍可找到英文程式碼片段。

## Phase 5: Symbol Graph

狀態：輕量 MVP 已完成；tree-sitter / deeper graph 尚未實作。

目標：接近 context engine 的「關係理解」。

工作項：

1. 解析 imports/exports。已完成常見 TS/JS/Python/Go/Rust 的保守 regex 抽取。
2. 記錄 function/class/interface symbols。已完成常見 declarations。
3. 建立 file dependency graph。已完成 relative import resolution 與 reverse-import 查詢。
4. 查詢時加入 related files。已完成 `repo_related_files`，採按需展開。
5. 支援從 router -> service -> model 的鏈路返回。後續加入多跳 graph traversal。

驗收：

- `repo_reindex(dry_run=false)` 會寫入 symbols/dependencies 統計。
- `repo_index_status` 會回報 symbol/dependency rows。
- `repo_related_files(path)` 會返回該檔 symbols、imports、importedBy。
- 查詢 API 行為時，同時返回 route、handler、service、schema/test。後續多跳 traversal 完成後驗收。

## Phase 6: Codex Workflow Polish

狀態：context budget MVP 已完成；server instructions / AGENTS.md 尚未完成。

目標：讓 Codex 更穩定地使用工具。

工作項：

1. 補 server instructions。
2. 加一份可放入 `AGENTS.md` 的使用指南。
3. 對結果加 token budget。已完成字元級 MVP。
4. 支援 `max_context_chars`。已完成 `repo_semantic_search` 的 snippet 總字元限制。
5. 錯誤訊息加入可修復建議。

## 風險與取捨

- Gemini Embedding 2 品質高，但會把 chunk 送出本機；敏感 repo 要允許 provider 關閉或換本地 embedding。
- 第三方中轉站相容性不一致，所以 provider 必須保留 header/query/bearer 三種 auth。
- 大型 repo 需要增量索引和 rate limit，不能每次全量 embedding。
- 純 vector search 對精確 symbol 不一定好，hybrid search 是必要項。
