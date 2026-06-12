# Gemini Embedding 2 與第三方 v1beta 中轉站相容設計

## 官方 Gemini REST 格式

官方 Gemini Embedding 2 REST endpoint：

```text
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent
```

官方 key header：

```text
x-goog-api-key: $GEMINI_API_KEY
```

Repo Beacon 預設設定：

```env
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_MODEL=gemini-embedding-2
GEMINI_AUTH_MODE=x-goog-api-key
GEMINI_API_KEY_HEADER=x-goog-api-key
GEMINI_OUTPUT_DIMENSIONALITY=1536
```

## Embedding 2 query/document 格式

Gemini Embedding 2 不用 `task_type` 欄位，而是在文字中加 task prefix。

查詢：

```text
task: code retrieval | query: {query}
```

文件 chunk：

```text
title: {path or symbol} | text: {chunk}
```

Repo Beacon 的 `GeminiEmbeddingProvider` 會自動套用這個格式。

## Output dimensionality

預設使用 1536 維：

```env
GEMINI_OUTPUT_DIMENSIONALITY=1536
```

建議：

- `768`: 省空間，速度快，適合非常小的個人 repo 或低成本模式。
- `1536`: Repo Beacon 預設，精度與成本較平衡。
- `3072`: 最高精度，但索引體積與相似度計算成本較高。

## 第三方 v1beta 中轉站

很多中轉站會保留 Google v1beta path：

```text
POST https://proxy.example.com/v1beta/models/gemini-embedding-2:embedContent
```

這種情況只要改：

```env
GEMINI_BASE_URL=https://proxy.example.com/v1beta
GEMINI_API_KEY=proxy-key
```

如果中轉站使用 Bearer token：

```env
GEMINI_AUTH_MODE=bearer
```

會送出：

```text
Authorization: Bearer proxy-key
```

如果中轉站使用 query key：

```env
GEMINI_AUTH_MODE=query
GEMINI_API_KEY_QUERY_PARAM=key
```

會送出：

```text
...?key=proxy-key
```

如果中轉站自訂 header：

```env
GEMINI_AUTH_MODE=x-goog-api-key
GEMINI_API_KEY_HEADER=Authorization
```

注意：這種模式會送 `Authorization: {key}`，不會自動加 `Bearer `；需要 Bearer 時應使用 `GEMINI_AUTH_MODE=bearer`。

## Batch 相容性

官方 batch endpoint：

```text
POST /v1beta/models/gemini-embedding-2:batchEmbedContents
```

部分中轉站可能只支援 `embedContent`，不支援 batch。Phase 2 實作索引時需要：

1. 優先嘗試 batch。
2. 如果回傳 404/501/不支援，fallback 到逐筆 `embedContent`。
3. 記錄 provider capability cache，避免每次重試 batch。

目前 scaffold 中 `embedBatch` 已按官方 batch 格式送出，但還沒有 fallback。這是 Phase 2 的必要項。

## Codex MCP 設定範例

官方 Gemini：

```toml
[mcp_servers.repo_beacon]
command = "node"
args = ["/home/po120/Git/repo-beacon-mcp/dist/index.js"]
env = {
  GEMINI_API_KEY = "your-google-ai-studio-key",
  GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta",
  GEMINI_AUTH_MODE = "x-goog-api-key"
}
```

Bearer 中轉站：

```toml
[mcp_servers.repo_beacon]
command = "node"
args = ["/home/po120/Git/repo-beacon-mcp/dist/index.js"]
env = {
  GEMINI_API_KEY = "your-proxy-key",
  GEMINI_BASE_URL = "https://proxy.example.com/v1beta",
  GEMINI_AUTH_MODE = "bearer"
}
```

Query key 中轉站：

```toml
[mcp_servers.repo_beacon]
command = "node"
args = ["/home/po120/Git/repo-beacon-mcp/dist/index.js"]
env = {
  GEMINI_API_KEY = "your-proxy-key",
  GEMINI_BASE_URL = "https://proxy.example.com/v1beta",
  GEMINI_AUTH_MODE = "query",
  GEMINI_API_KEY_QUERY_PARAM = "key"
}
```

## 測試方式

啟動 MCP 後呼叫：

```text
gemini_embedding_probe({ "text": "find code that handles payment logging" })
```

成功時應回：

```json
{
  "model": "gemini-embedding-2",
  "dimensions": 1536,
  "sample": [0.01, -0.02]
}
```

如果失敗，優先檢查：

1. `GEMINI_BASE_URL` 是否已包含 `/v1beta`。
2. 中轉站是否真的支援 `models/{model}:embedContent`。
3. auth 是 header、Bearer 還是 query。
4. 中轉站是否支援 `output_dimensionality`。
5. 模型名稱是否要用 `gemini-embedding-2` 或 `models/gemini-embedding-2`。
