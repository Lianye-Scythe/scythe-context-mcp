# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP 透過 CLI＋Skill 或 MCP，協助 coding agent 在不知道檔案位置時找到程式碼。它在本機索引專案，回傳檔案路徑、行號範圍與相關檔案；可選的 Gemini embeddings 提供語義搜尋。

## 什麼時候適合使用

- 適合陌生專案、以功能概念查找程式碼，以及跨檔案追查符號或 imports。
- 已知路徑或精確字串時，使用 `rg` 或直接讀取檔案。
- 本機關鍵字搜尋不需要 API key；語義搜尋需要 Gemini-compatible endpoint。

專案已有搜尋 benchmark 與整合測試，但這些結果**不能證明** MCP 能提高 GPT‑6.1 Sol 任務完成率、速度或降低整體 token 用量。請參閱 [benchmark](docs/benchmark.md) 與[任務 A/B 評估流程](docs/codex-evaluation.md)。

## 語言支援

目標專案可以是 JS／TS、Python、Go、Rust、C#、C++ 或其他文字程式碼；只有 Scythe 本身需要 Node.js。從 0.1.19 起，本地 import 導航進一步支援 Python flat／`src` package 與相對 imports、最近一層 `go.mod` 所屬的 Go packages，以及傳統 Cargo 檔案模組和 Rust 明確錨定的路徑。升級到 0.1.22 後，即使索引顯示 fresh，也請執行一次 `scythe-context index --project /absolute/path/to/repo`，更新 metadata 並建立切塊快取。MCP 使用者也能在升級後的 server 呼叫 `repo_reindex`，設定 `dry_run=false`、`index_embeddings=false`。不需要重新產生 embeddings。解析採保守方式，不等同編譯器層級的符號解析。詳見[語言支援與限制](docs/language-support.md)。

0.1.20 加入 C# 結構與專案參考導航：namespace、型別與常見方法宣告，以及 `.csproj` 的靜態 `ProjectReference` 關聯。C# 的 `using` 會保留為未解析的 namespace／型別線索，不會當成檔案 import。這些功能只讀取原始碼與專案檔，不需要安裝或執行 .NET SDK；限制詳見同一份語言支援指南。

0.1.20 也加入 C++ 基礎導航：namespace、class／struct／enum、常見函式與方法，以及相對於目前檔案的雙引號 `#include` 關聯。系統標頭與巨集引用會保留為未解析。不需要安裝 C++ 工具鏈；目前不解析編譯器 include 路徑或建置設定。

0.1.22 加入 TypeScript／JavaScript 設定別名、本地與 workspace 設定繼承、明確的 project references 選擇、已宣告的 workspace 原始碼 exports，以及 Cargo library／binary 入口路徑。這些功能用於索引內的原始碼導航，不會執行建置設定，也不等同完整的編譯器或執行環境解析。詳見[設定驅動導航與 GitHub 驗證](docs/config-navigation.md)。

## CLI＋Skill（同一個套件）

從 0.1.18 起，同一個 `scythe-context-mcp` npm 套件提供 `scythe-context` CLI 與原有 MCP 入口。安裝一次後，可選擇 CLI＋Skill、MCP，或同時使用。從原始碼使用時，先執行 `npm run build`，再將下列 `scythe-context` 換成 `node /absolute/path/to/scythe-context-mcp/dist/command.js`。

```bash
npm install -g scythe-context-mcp@0.1.22
scythe-context status
# Run when metadata is missing/stale, or once after upgrading to 0.1.22:
scythe-context index
scythe-context search "where is auth token validation handled?"
scythe-context context "where is auth token validation handled?" --format compact
scythe-context related src/auth.ts
scythe-context doctor
```

CLI 的 search/context 預設使用本機 `keyword` 模式，只回傳路徑與行號；MCP 維持原有的 `hybrid` 預設。兩個介面共用參數驗證、索引、搜尋、fallback 與回傳格式處理；更換介面本身不會提高檢索準確度。

以 `--project /absolute/repo/path` 覆寫預設專案。搜尋加上 `--json` 可取得結構化結果；status/index/related/doctor 預設就輸出 JSON。`--format` 控制詳細程度（search/context 使用 `paths`、`compact`、`snippets`，其他命令使用 `compact`、`full`）。`--output /absolute/result.json` 將結構化結果存成檔案，只印出路徑，方便按需讀取。其他預算與選項見 `--help`。搜尋無結果或 hybrid fallback 時 exit code 為 0；操作失敗或查找時缺少索引則回傳非零。doctor 有 error 時回傳非零，只有 warning 時回傳 0。

需要語意搜尋時，明確使用 `index --embeddings`，以及 `search`／`context --mode hybrid` 或 `--mode semantic`；這些操作會將 chunks 或查詢送至設定的 endpoint。`index --dry-run` 只預覽 metadata 索引，不寫入，也不呼叫 embedding。

套件內的 [Skill](skills/scythe-context/SKILL.md) 說明何時搜尋、讀取檔案範圍、更新索引及使用 embeddings。將 `skills/scythe-context/` 複製至 agent 的技能目錄即可供它探索；CLI 也必須在該 agent 的執行環境中可用。目前不會自動安裝 Skill。`scythe-context` 無參數時顯示 help；`scythe-context-mcp` 無參數時仍啟動 MCP stdio。兩個入口都接受上述子命令，也能以 `serve` 明確啟動 MCP。

## MCP 快速開始：本機搜尋

需要 Node.js 24.11+，支援範圍為 `>=24.11.0 <27`；Node.js 24 是已測試的基準。Node 與 npm 應在 MCP server 所用的同一環境中執行。

Codex CLI 在 Linux、macOS 或 WSL 執行時，將以下設定加入 `~/.codex/config.toml`（或你設定的 Codex home）。受信任的專案可使用 `.codex/config.toml`：

```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
```

不必全域安裝；`npx` 會在第一次使用時下載套件。原生 Windows 或 Windows Codex App 搭配 WSL 專案，請改用[平台設定指南](docs/setup.md)。

修改設定後重新啟動 Codex。CLI 可透過 `/mcp` 查看連線；App 則確認 Scythe 工具已出現。

請 Codex 執行以下 **MCP 工具呼叫，不是 shell 指令**。將專案路徑換成 server 所在環境的絕對路徑：

```text
repo_index_status({ "project_path": "/absolute/path/to/your/repo" })
repo_reindex({ "project_path": "/absolute/path/to/your/repo", "dry_run": false, "index_embeddings": false })
repo_context_pack({ "project_path": "/absolute/path/to/your/repo", "query": "where is auth token validation handled?", "mode": "keyword" })
```

只有索引不存在或過期時才執行 `repo_reindex`。它將 metadata 寫入 `.scythe-context/`；`index_embeddings=false` 不會將程式碼區塊送到 embedding endpoint。

成功查找會回傳包含路徑與行號的 `primaryResults`。`repo_context_pack` 預設為 `response_mode="paths_only"`；接著讓 Codex 讀取命中的檔案範圍。需要短片段時指定 `response_mode="compact"`。設定失敗時，先使用 `repo_doctor` 與[疑難排解指南](docs/troubleshooting.md)。

## 可選語義搜尋與隱私

將 `GEMINI_API_KEY` 保留在啟動 Codex 的環境中，再透過既有 server 設定轉發。不要提交 key。接著建立向量並使用 hybrid 搜尋：

```toml
# Add this field to the existing [mcp_servers.scythe_context] table.
env_vars = ["GEMINI_API_KEY"]
```

```text
repo_reindex({ "project_path": "/absolute/path/to/your/repo", "dry_run": false, "index_embeddings": true })
repo_context_pack({ "project_path": "/absolute/path/to/your/repo", "query": "where is auth token validation handled?", "mode": "hybrid" })
```

這些呼叫會將專案程式碼區塊與查詢文字送到設定的 endpoint，可能產生 provider 費用。預設為 `https://generativelanguage.googleapis.com/v1beta`、模型 `gemini-embedding-2`、1536 維。Proxy 與驗證設定請參閱[設定指南](docs/setup.md)。

**MCP 搜尋模式預設是 `hybrid`，快速開始則明確指定 `keyword`；CLI 的 search/context 預設為 `keyword`。** 有設定 key 時，省略 `mode` 可能將查詢送到 provider。請使用 `mode="keyword"` 避免 embedding 請求。

| 模式 | Embedding 請求 | 查詢 embedding 失敗時 |
| --- | --- | --- |
| `keyword` | 無；只需要 metadata | 不適用 |
| `hybrid`（MCP 預設） | 傳送查詢；索引向量提供語義查找 | 退回 keyword 並回報 fallback |
| `semantic` | 傳送查詢；需要索引向量 | 回報錯誤，不退回 keyword |

`GEMINI_REQUEST_TIMEOUT_MS` 預設為 `10000`，限制每次 embedding 請求，包含讀取回應本文；不限制整個索引工作的時間。`gemini_embedding_probe` 也會將測試文字送到 endpoint。第三方 proxy 能看到傳送給它的文字。

索引保存在 `.scythe-context/`。請勿將該目錄、舊版 `.repo-beacon/`、`.env` 或 `local/` 納入版本控制。使用 `.gitignore` 排除不應索引的私人檔案，啟用 embeddings 前先確認範圍。不要在公開 issue 或 log 中附上秘密、私人程式碼或索引資料庫。

## 工具與目前限制

| 工具 | 用途 |
| --- | --- |
| `repo_index_status` | 檢查 metadata、embedding 覆蓋率與索引新鮮度。 |
| `repo_reindex` | 更新 metadata；只有 `index_embeddings=true` 才傳送區塊建立向量。 |
| `repo_context_pack` | 依任務查找程式碼；預設回傳路徑與行號。 |
| `repo_semantic_search` | 檢查 keyword、hybrid 或 semantic 排序；預設 compact 輸出。 |
| `repo_related_files` | 查看檔案的符號、imports 與反向 imports。 |
| `repo_doctor` | 不呼叫外部 API，檢查本機設定與索引狀態。 |
| `gemini_embedding_probe` | 用提供的文字測試設定的 embedding endpoint。 |

符號與 imports 預設使用 regex 擷取；tree-sitter 為實驗功能，需要另行設定 grammar。相關檔案結果是導航線索，並非完整的執行期呼叫圖。檔案變更後需要更新索引；embedding 覆蓋率可能不完整。

## 文件

- [文件索引](docs/README.md)
- [平台設定與進階設定](docs/setup.md)
- [疑難排解](docs/troubleshooting.md)
- [搜尋 benchmark](docs/benchmark.md) · [實際使用評估](docs/dogfood.md)
- [Codex 任務 A/B 評估流程（繁體中文）](docs/codex-evaluation.md)
- [架構（英文）](docs/architecture.md) · [Gemini provider 細節（英文）](docs/gemini-compatibility.md)
- [貢獻指南](CONTRIBUTING.md) · [發布流程](docs/release.md) · [更新紀錄](CHANGELOG.md)

## 開發

請在執行 Node 的環境安裝相依套件，尤其是 Windows 與 WSL：

```bash
git clone https://github.com/Lianye-Scythe/scythe-context-mcp.git
cd scythe-context-mcp
npm ci
npm run build
npm run verify
```

從原始碼設定 MCP 時，讓 `node` 指向 `dist/index.js` 的絕對路徑；請參閱[設定指南](docs/setup.md)。使用者可見行為變更時，請同步更新三種語言的 README。
