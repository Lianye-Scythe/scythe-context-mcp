# Scythe Context MCP

> **已停止維護 — 2026-10-19。** 本專案停止開發與發版，公開封存原始碼、歷史使用說明及評測結果。評測未證明相對 `rg` 具有普遍的速度或 token 節省優勢，詳見[最後的大型 TypeScript 評測](docs/large-ts-evaluation.md)。既有 npm 版本保留供參考；下方安裝步驟為歷史設定說明。

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP 協助 coding agent 找到相關程式碼，追查符號、imports 與反向引用，透過 CLI＋Skill 或 MCP 回傳檔案路徑、行號與必要片段。本機關鍵字搜尋不需要 API key；語義搜尋是選配功能。

## 什麼時候適合使用

| 需求 | 優先使用 |
| --- | --- |
| 已知檔案、精確識別字、錯誤訊息或正規表示式 | 直接讀檔或 `rg`。 |
| 在陌生專案中取得排序結果與相關檔案脈絡 | Scythe 關鍵字搜尋與導航。 |
| 相關實作可能與功能描述使用不同用詞 | 選配的 hybrid 向量混合搜尋。 |

關鍵字搜尋仍依賴詞彙匹配。Scythe 提供的額外能力是排序與跨檔脈絡，不需要讓每次 `rg` 查找都改用它。

## 選擇使用介面

兩個介面由同一個 `scythe-context-mcp` npm 套件提供，可以二選一，也能同時使用。

| 介面 | 適用情境 | 搜尋預設 |
| --- | --- | --- |
| CLI＋Skill | Agent 能執行 shell 指令並載入技能，或直接在終端機搜尋。 | 本機 `keyword`。 |
| MCP | 使用支援 MCP 工具的客戶端。 | `hybrid`；純本機查找請指定 `mode="keyword"`。 |

Scythe 需要 Node.js `>=24.11.0 <27`；Node.js 24 是已測試的基準。目標專案不需要 Node.js。請在與檔案相同的執行環境安裝、執行 Scythe；詳見 [Windows、WSL、Linux 與 macOS 設定](docs/setup.md)。

## 快速開始

### CLI＋Skill

**1. 安裝 CLI 並搜尋專案。** 將路徑與查詢換成自己的專案及相關詞彙：

```bash
cd /absolute/path/to/your/repo
npm install -g scythe-context-mcp@0.1.24
scythe-context index
scythe-context context "auth token" --format compact --max-results 1
```

範例使用 `--max-results 1` 限制為一筆，方便展示；實際使用可移除此參數以取得更多結果。

`index` 將本機 metadata 寫入 `.scythe-context/`，不會請求 embeddings；原始碼變更後需要更新。直接在終端機執行這些指令不必安裝 Skill。

**2. 為 agent 安裝 Skill。** 先找到全域 npm 套件目錄：

```bash
npm root -g
```

在該目錄內，透過 agent 的技能安裝流程安裝整個 `scythe-context-mcp/skills/scythe-context/` 資料夾，或將它複製到 agent 設定的技能目錄。Skill 會指引何時使用 `rg`、Scythe 與 embeddings。npm 安裝或升級**不會**安裝、更新這份獨立副本；各客戶端的安裝位置與啟用方式，詳見 [Skill 安裝指南（英文）](docs/client-integration.md#install-and-discover-the-skill)。

### MCP

**以下為 Codex 設定範例。** Claude Code 與 Antigravity CLI 請參閱[各客戶端的 MCP 註冊方式（英文）](docs/client-integration.md#register-mcp-when-choosing-that-interface)。

Codex 在 Linux、macOS 或 WSL 執行時，將以下內容加入 `~/.codex/config.toml`（或你設定的 Codex home），再重新啟動客戶端。原生 Windows 或 Windows App＋WSL 請使用[平台設定指南](docs/setup.md)。

```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
```

請 agent 執行以下 **MCP 工具呼叫，不是 shell 指令**。請替換路徑；只有 metadata 不存在或過期時才重新索引：

```text
repo_index_status({ "project_path": "/absolute/path/to/your/repo" })
repo_reindex({ "project_path": "/absolute/path/to/your/repo", "dry_run": false, "index_embeddings": false })
repo_context_pack({ "project_path": "/absolute/path/to/your/repo", "query": "auth token", "mode": "keyword" })
```

此範例明確指定 keyword，因此查找留在本機。設定失敗時，使用 `repo_doctor` 與[疑難排解](docs/troubleshooting.md)。

## 搜尋結果長什麼樣

以下是含 `src/auth.ts`、`src/app.ts` 兩個檔案的範例專案，執行上述指令的實際輸出；專案路徑已正規化。實際結果依你的專案而定：

```text
Project: /absolute/path/to/your/repo
Mode: keyword
src/auth.ts:1-3
  keyword/path match
export function validateToken(token: string) {
  return token.length > 0;
}
Related: src/auth.ts (source)
Related: src/app.ts (source)
Suggested: src/auth.ts
Suggested: src/app.ts
```

Agent 可接著讀取回傳的行號範圍，並追查相關檔案。`search`、`related`、`status`、`doctor`、JSON、長度預算與結果存檔，詳見[指令與輸出參考（英文）](docs/setup.md#cli-commands-and-mcp-tools)。

## 語言支援

文字搜尋適用於支援的文字檔案；結構與本機導航範圍如下：

| 語言 | 導航範圍 |
| --- | --- |
| JS／TS | 宣告、相對 imports、設定別名與繼承、明確的 project references、已宣告的 workspace 原始碼 exports。 |
| Python | 宣告、flat／`src` packages、相對 imports。 |
| Go | 宣告與最近一層 `go.mod` 模組內的 packages。 |
| Rust | 宣告、Cargo 檔案模組、明確錨定路徑、靜態 library／binary 入口。 |
| C# | Namespace、型別、常見方法宣告與靜態 `.csproj` 專案參考；`using` 保留為線索。 |
| C++ | Namespace、型別、常見函式宣告與相對於目前檔案的精確雙引號 includes。 |

不需要目標語言的編譯器或 SDK。導航採保守的原始碼解析，各語言限制詳見[語言支援](docs/language-support.md)與[設定驅動導航](docs/config-navigation.md)。舊版使用者請參閱[索引升級說明（英文）](docs/setup.md#upgrading-an-existing-index)。

## 選配：embeddings

已知可能出現在程式碼裡的詞彙時，先用 keyword。若用詞差異讓本機結果不足，hybrid 可結合關鍵字與向量檢索，semantic 則只使用向量。Skill 會在值得使用且符合任務授權範圍時，指引首次建立與後續更新向量。

Embeddings 需要 Gemini-compatible endpoint。建立向量時會發送程式碼區塊；hybrid／semantic 在有相符程式碼向量時會發送查詢文字，可能產生服務費用。沒有相符向量時，hybrid 會退回本機搜尋，semantic 會在發送查詢前回傳錯誤。CLI 預設 keyword，MCP 預設 hybrid。

詳見[語義搜尋、憑證、更新與隱私（英文）](docs/semantic-search.md)。只有 API key 不會自動產生向量，也不會讓 CLI 自動切換模式。

## 限制與隱私

- 檔案修改後需要更新索引，目前沒有自動監看。相關檔案是導航線索，不等同編譯器綁定或完整執行期呼叫圖。
- 使用根目錄的 `.gitignore` 排除私人檔案；勿將 `.scythe-context/`、舊版 `.repo-beacon/`、`.env` 與 `local/` 納入版本控制。
- 搜尋 benchmark 不代表 agent 完成任務更快或總 token 更少。詳見 [benchmark](docs/benchmark.md) 與[任務 A/B 評估流程](docs/codex-evaluation.md)。

## 更多資訊

- [客戶端設定：Codex CLI、Claude Code、Antigravity CLI（英文）](docs/client-integration.md)
- [文件索引](docs/README.md) · [設定與指令參考](docs/setup.md) · [疑難排解](docs/troubleshooting.md)
- [架構（英文）](docs/architecture.md) · [流程驗證與剩餘限制（英文）](docs/retrieval-workflow-audit.md)
- [更新紀錄](CHANGELOG.md) · [貢獻與原始碼開發](CONTRIBUTING.md) · [發布流程](docs/release.md)
