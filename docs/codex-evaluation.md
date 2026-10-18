# Codex 任務 A/B 評估

目的：確認 Scythe 是否改善 GPT‑6.1 Sol 的實際任務完成時間與正確率。現有 `bench:context` 測量搜尋品質與估算輸出大小，不能代替這項評估。本文件提供操作流程與紀錄格式；目前尚未完成本文所述的完整修改任務、多次重複 A/B 實驗，也不宣稱已證明整體收益。另見 [rg／keyword／hybrid 唯讀查找先導評測（英文）](agent-lookup-pilot.md)，其範圍與限制不同。

## 固定條件

選擇至少三個常用 repo，涵蓋不同大小或語言。在每個 repo 選三種任務：精確符號／已知檔案修改、自然語言定位、跨檔案行為修正。先固定起始 commit、需求、驗收命令與預期行為；不要依據 Scythe 回傳結果才選題或設定答案。

每個任務使用兩個乾淨 checkout，從同一個 commit 開始。兩組使用同一版 Codex、GPT‑6.1 Sol、相同推理設定、權限、其他 MCP 與網路環境；使用新 chat，避免先前探索結果影響比較。不要分享另一組的搜尋結果或修正內容。

實際啟動比較前，確認 Scythe 設定指向這次 build，而非尚未發布的新版本號。不要修改全域 MCP 設定來做比較；在專案設定或當次執行中切換該 server，並檢查工具清單確認開關生效。Codex 支援專案 scoped `.codex/config.toml` 與 MCP `enabled` 設定，詳見 [官方 MCP 文件](https://developers.openai.com/codex/mcp)。不要把 API key 寫入紀錄。

## 比較組

| 組別 | Scythe | 工作方式 |
| --- | --- | --- |
| A：baseline | 停用 | 使用原有讀檔、`rg` 與其他已固定的工具 |
| B：local | 啟用 | 未知位置用 `repo_context_pack(mode="keyword")`，已知位置直接讀檔／`rg` |
| C：hybrid（可選） | 啟用 | 未知位置用 hybrid；query 和需索引的 chunk text 會送到已設定的 embedding endpoint |

先比較 A/B，確認本機索引是否值得使用，再獨立比較 B/C，確認 embeddings 的增量收益。所有組別都提供相同 repo 的 `AGENTS.md`；若其中強制規定先使用 Scythe，則在共用任務提示中明確給出當次組別的工具規則，避免 baseline 被迫使用停用的工具。不要只要求 B 組使用特定搜尋、卻限制 A 組自行調整 `rg` 查詢。

對需要索引的組別先建立並確認 metadata freshness；C 組另外確認 embedding coverage。把首次建立索引的耗時與遠端請求成本單獨記錄，再分別呈現「含初始索引」與「已有索引」的完成時間。

每個組別／任務至少執行三次；交替或隨機安排組別順序。固定相同停止條件（例如完成或達到相同時間上限），記錄失敗與逾時，不能只保留成功的 run。

## 共用提示模板

```text
模型：GPT‑6.1 Sol，推理設定：<相同設定>
起始 commit：<commit>
本次組別：<A / B / C>
工具規則：<依上表填寫；rg 和直接讀檔皆可使用>

任務：<相同需求，不提供實作檔案線索，除非這是已知檔案任務>
驗收：<相同的測試／build／實際流程要求>
範圍：<允許修改的功能與必須保留的行為>

請完成修改與驗證，回報實際測試結果，不要提交或發布。
```

## 紀錄

每個 run 使用一列，保存結果在不提交的 `local/benchmark/`。實際 token 數據來自客戶端可取得的 usage；取不到時記為 unavailable，不能用工具的字元／4估算值替代，也不能把 API tokens 直接換算成 ChatGPT 訂閱配額。

```csv
repo,commit,task,group,run,model,reasoning,codex_version,success,wall_seconds,index_seconds,tool_calls,input_tokens,output_tokens,cached_input_tokens,embedding_requests,acceptance_result,notes
```

由相同驗收程序檢查所有組別：測試、build 和必要的真實流程，並檢查是否引入範圍外修改。測試通過但不符合需求仍算失敗。任務存在未完成部分也要記錄。

比較每種任務的成功率、完成時間中位數、總工具呼叫、實際 token 使用與 embedding 請求。成功與失敗都保留；時間統計註明是否只計成功 run。報告分 repo／任務類型呈現，不以此 repo 的搜尋命中率推論所有專案。

採用判準：在正確率不下降的前提下，未知位置／跨檔案任務是否穩定減少總時間或總上下文成本。精確符號任務若沒有收益，保留直接 `rg` 的路由。若 B 已足夠好而 C 增益有限，優先保留本機搜尋，把 hybrid 留給語義定位需求。
