# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP 透過 CLI＋Skill 或 MCP，為 coding agent 提供本機程式碼搜尋、import 導航與有範圍限制的脈絡整理。在陌生專案中找到相關檔案路徑、行號、符號與檔案關聯；從本機關鍵字搜尋開始，不需要 API key 或 embedding 服務。

## 什麼時候適合使用

- 適合陌生專案、以功能概念查找程式碼，以及跨檔案追查符號或 imports。
- 已知路徑或精確字串時，使用 `rg` 或直接讀取檔案。
- 本機關鍵字搜尋不需要 API key；語義搜尋需要 Gemini-compatible endpoint。

## 選擇使用介面

兩個介面由同一個 npm 套件提供，共用索引與檢索引擎。可以二選一，也能同時使用。

| 介面 | 適用情境 | 搜尋預設 |
| --- | --- | --- |
| CLI＋Skill | Agent 能執行 shell 指令並載入技能，或想直接在終端機搜尋。 | 本機 `keyword`，不發送 embedding 請求。 |
| MCP | 使用支援 MCP 工具的客戶端。 | `hybrid`；純本機搜尋請明確指定 `mode="keyword"`。 |

執行 Scythe 的環境需要 Node.js `>=24.11.0 <27`；Node.js 24 是已測試的基準。目標專案不需要使用 Node.js。Windows、WSL、Linux 與 macOS 請參閱[平台設定](docs/setup.md)。

## CLI＋Skill（同一個套件）

同一個 `scythe-context-mcp` npm 套件提供 `scythe-context` CLI 與原有 MCP 入口。安裝一次後，可選擇 CLI＋Skill、MCP，或同時使用。從原始碼使用時，先執行 `npm run build`，再將下列 `scythe-context` 換成 `node /absolute/path/to/scythe-context-mcp/dist/command.js`。

```bash
npm install -g scythe-context-mcp@0.1.23
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

## 語言支援

文字搜尋適用於支援的文字檔案；結構與 import 導航則依語言提供：

| 語言 | 導航範圍 |
| --- | --- |
| JS／TS | 常見宣告與 imports、設定別名與繼承、明確的 project references、已宣告的 workspace 原始碼 exports。 |
| Python | 常見宣告、flat／`src` packages 與相對 imports。 |
| Go | 常見宣告及最近一層 `go.mod` 模組內的 packages。 |
| Rust | 常見宣告、Cargo 檔案模組、明確錨定路徑及靜態 library／binary 入口。 |
| C# | Namespace、型別、常見方法宣告與靜態 `.csproj` 專案參考；`using` 保留為 namespace／型別線索。 |
| C++ | Namespace、型別、常見函式宣告與相對於目前檔案的精確雙引號 includes。 |

導航採保守解析，不等同編譯器層級的綁定或完整執行時呼叫圖；不需要目標語言的 SDK 或編譯器。詳見[語言支援與限制](docs/language-support.md)及[設定驅動導航](docs/config-navigation.md)。

從 0.1.22 之前的版本升級時，即使索引顯示 fresh，也請執行一次 `scythe-context index --project /absolute/path/to/repo`。MCP 使用者可呼叫 `repo_reindex`，指定 `dry_run=false`、`index_embeddings=false`。這會更新導航 metadata 並建立切塊快取，不會請求 embeddings。

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

專案已有搜尋 benchmark 與整合測試，但這些結果**不能證明** MCP 能提高 GPT‑6.1 Sol 任務完成率、速度或降低整體 token 用量。請參閱 [benchmark](docs/benchmark.md) 與[任務 A/B 評估流程](docs/codex-evaluation.md)。

## 選配：使用 embeddings 的語義搜尋

先使用關鍵字搜尋與 import 導航。若相關程式碼與查詢用詞不同、本機結果不足，再嘗試 hybrid 或 semantic，並在自己的專案比較結果。Embeddings 是選配，語言導航與脈絡整理都不依賴它。

啟用時需要 Gemini-compatible endpoint；建立向量索引會發送程式碼區塊，hybrid／semantic 搜尋會發送查詢文字，可能產生服務費用。設定、指令、模式差異與隱私說明請見[選配語義搜尋指南（英文）](docs/semantic-search.md)。

CLI search/context 預設為 `keyword`，MCP 預設為 `hybrid`。設定 key 後，MCP 查詢可能連線至 provider；純本機搜尋請明確指定 `mode="keyword"`。

若設定的 endpoint／模型／維度沒有程式碼向量，hybrid 會退回 keyword，semantic 則回傳錯誤，兩者都不會先發送查詢。

請勿將 `.scythe-context/`、舊版 `.repo-beacon/`、`.env` 與 `local/` 納入版本控制；使用 `.gitignore` 排除不應索引的私人檔案。

## 文件

- [文件索引](docs/README.md)
- [平台設定與進階設定](docs/setup.md)
- [疑難排解](docs/troubleshooting.md)
- [搜尋 benchmark](docs/benchmark.md) · [實際使用評估](docs/dogfood.md)
- [Codex 任務 A/B 評估流程（繁體中文）](docs/codex-evaluation.md)
- [架構（英文）](docs/architecture.md) · [選配語義搜尋（英文）](docs/semantic-search.md)
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
