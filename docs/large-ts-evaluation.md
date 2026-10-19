# Larger TypeScript monorepo evaluation

Status: the separate local rg/keyword schedule is collected: 36 attempts, 31 completed answers, four rg timeouts and one keyword account-quota interruption. Hybrid remains pending after the earlier provider daily-quota failure; 4,352 of 5,976 vectors are retained. The provider was not retried during the local comparison.

## Local results

Collected across October 18–19, 2026 (Asia/Taipei), with the same frozen manifest and driver conditions. [Public results](../benchmarks/large-ts-lookup-results.json) retain every scheduled attempt, answers, usage, original checks, separate citation audits and manual reviews. Raw client logs stay in ignored local storage.

| Measurement | rg workflow | keyword-assigned workflow |
| --- | ---: | ---: |
| Scheduled attempts | 18 | 18 |
| Completed answers | 14 | 17 |
| 150-second timeouts | 4 | 0 |
| Account-quota interruptions | 0 | 1 |
| Correct answers among completed, manually reviewed | 14/14 | 17/17 |
| Original frozen evidence gate passed | 3 | 3 |
| All citation entries pass separate literal-source/observed-output audit | 12 | 13 |
| Citation audit plus frozen required file/symbol/span/behavior anchors | 10 | 13 |
| Actual Scythe context/search sessions, including the interrupted lookup | 0 | 13 |

All 36 attempts left source files unchanged and passed the observed lookup infrastructure checks. Both keyword-assigned Vue repetitions 2 and 3 used only rg/direct reads; they remain flagged by the original lookup-use check. The three identifier controls also legitimately used rg in both workflows. Completed answer correctness does not imply complete or exact source citations: some quotes added text/punctuation, and some reported spans missed frozen behavior anchors.

Per-task elapsed medians below exclude the account-quota interruption and include timeouts at their observed ~150-second cap. Read completion counts alongside latency. Session times exclude source/index fixture preparation.

| Task | rg completed | rg median seconds | keyword completed | keyword median seconds |
| --- | ---: | ---: | ---: | ---: |
| Exact identifier/depth control | 3/3 | 14.30 | 3/3 | 15.50 |
| React property tracking across packages | 1/3 | 150.06 | 2/3 | 18.81 |
| Chinese shared-client lifecycle | 3/3 | 20.88 | 3/3 | 23.65 |
| Persisted revision/age rejection | 2/3 | 17.32 | 3/3 | 21.01 |
| Chinese last-observer cancellation | 2/3 | 25.36 | 3/3 | 25.44 |
| Vue restoration/disposal | 3/3 | 13.46 | 3/3 | 12.77 |

### Matched completed discovery tasks

Ten task/repetition pairs completed in both groups after excluding the exact-identifier control. These cover four tasks; React has no completed matched pair. This is a surviving-pair comparison, not all-attempt productivity. Two of these keyword-assigned sessions did not actually call Scythe.

| Measurement on these same ten pairs | rg | keyword assigned |
| --- | ---: | ---: |
| Elapsed median seconds | 18.85 | 21.90 |
| Command calls, total | 38 | 32 |
| Captured command-output characters | 240,933 | 183,307 |
| Actual cumulative input tokens | 719,596 | 767,969 |
| Cached input tokens, included above | 466,560 | 552,320 |
| Uncached input tokens, difference of the two rows | 253,036 | 215,649 |
| Actual output tokens | 7,280 | 7,458 |

Keyword-assigned runs captured about 24% fewer output characters and made fewer commands, but their median elapsed time was longer and cumulative input tokens were about 6.7% higher. Uncached input was about 14.8% lower; cache state was not controlled, so neither total input nor uncached input alone establishes cost savings. Interrupted/timed-out usage is unknown, not zero. No monetary comparison is available.

An explicitly exploratory subset restricted to eight matched discovery pairs with an actual keyword call shows the same mixed pattern: 20.63 versus 24.55 seconds median (rg/keyword), 609,983 versus 659,103 input tokens, 211,647 versus 188,191 uncached input tokens, and 223,139 versus 169,160 captured output characters. This post-collection actual-use subset excludes both direct-read Vue sessions; it is not a replacement for the assigned-workflow results.

The observed keyword workflow completed more attempts and usually needed fewer commands on matched tasks. It did not demonstrate universal speed or token savings. Keep direct reads/rg for supplied identifiers and ranked keyword lookup as an optional discovery aid. The sample does not establish why rg sessions timed out, nor whether hybrid would improve these tasks; no production retrieval defaults were changed.

## Fixed protocol

- Public repository: [TanStack/query](https://github.com/TanStack/query/tree/ddff3a70be3255d6154cbb828fb9b00a209ba382), commit `ddff3a70be3255d6154cbb828fb9b00a209ba382`.
- Complete snapshot: 27 package directories and 1,072 TS/TSX files. Default Scythe scan indexes 3,571 files, 5,976 chunks and 13,231,190 bytes; 39 candidates are skipped (38 binary, one too large). Built-in/root ignore rules also apply. This is about 32 times the indexed-file count of the earlier ts-pattern check, not a claim about every large repository.
- Corpus chunks include docs 2,574, examples 952, integrations 101, package tests 1,227, other package files 1,059 and root/other files 63. Documentation, tests, examples and similarly named adapters remain as realistic distractors.
- Original plan: [six fixed tasks](../benchmarks/large-ts-lookup-tasks.json), three workflows and three repetitions (54 fresh sessions). Actual collection: 36 local rg/keyword attempts; the 18 hybrid cells have not run. One exact-identifier control; five discovery/disambiguation questions, including cross-package traces, two Chinese prompts and a Vue question that supplies the shared `useBaseQuery` name. Every expected source anchor was checked to fall inside an indexed chunk before retrieval runs.
- Codex CLI 0.163.0, `gpt-6.1-sol`, medium reasoning. Source engine `6916355`; no production ranking changes during collection. Skills, MCP, web tools, target execution and source edits are forbidden. Project instruction loading is disabled for the controlled runs.
- The original three-way design rotates the leading workflow, so each of rg, keyword and hybrid leads once per task. The separate two-group design alternates order; with three repeats, each task has a 2:1 leading-order split, balanced across the six tasks. Known identifiers can use rg immediately in all groups. Unknown locations start with the assigned Scythe mode, up to five primary chunks and 4,000 snippet characters, then can use rg/direct reads. Agents generate their own queries. Two keyword-assigned Vue sessions used only rg/direct reads: the supplied function name makes the permitted identifier shortcut ambiguous. Retain their frozen lookup-use failures; report actual Scythe use and an explicitly exploratory actual-use pair subset rather than attributing those sessions to keyword retrieval.
- An isolated source/index copy per session preserves symlinks and chunk/vector IDs. A transparent in-process wrapper pins the project/mode, supplies protected provider configuration and records actual mode. No credentials enter prompts or public results.

The manual driver is [large-ts-lookup-evaluation.mjs](../scripts/large-ts-lookup-evaluation.mjs). Run only from a source checkout after explicitly authorizing account/provider usage:

```bash
node scripts/large-ts-lookup-evaluation.mjs \
  --groups rg,keyword \
  --project /absolute/prepared/tanstack-query \
  --output /absolute/private/agent-runs.json
```

The default three-way run requires a fresh index and complete configured vectors. A separate `--groups rg,keyword` report can measure local workflows against fresh metadata without vectors; it must not be presented as the original completed three-way experiment. Its group order rotates over the selected groups. Report conditions include the selected groups, preventing incompatible reports from being merged. Each cell has a 150-second limit. Results are checkpointed atomically; resume requires unchanged manifest, driver, engine commit, model, CLI and repetition count. Completed results and failures are retained. Only a recognized account-quota failure with no observed commands or token usage can be attempted again, preserving the old record separately. Provider fallback stops further measurements for inspection.

## Measurements and grading

Keep initial metadata/indexing cost, vector preparation time and prepared-index lookup time separate. Fresh SQLite metadata indexing took 6.42 seconds, excluding snapshot download/copy; the filesystem cache was not controlled. Vector preparation first encountered HTTP 429 rate limits and used bounded jobs with cooldowns. Later responses explicitly identified `EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier`, limit 1,000, in three consecutive completed jobs. Automatic retries and the waiting model queue were stopped; partial vectors remain reusable with the same provider configuration. The compatible endpoint does not expose enough information to infer its upstream key pool or reset time. Provider billing is unavailable; chunk characters are not token or monetary usage.

For each group, retain all three attempts per task before aggregating per-task medians. Show timeouts separately and include their capped elapsed time in latency summaries; exclude recognized account-quota interruptions from latency comparison. Token comparisons use completed matched task/repetition pairs, and missing usage remains unknown rather than zero. Report completion, source grounding, parent-reviewed answer correctness, command calls, captured command output and actual client input/cached-input/output usage separately. Cached input is a subset of Codex input. Three repeats are not a statistically conclusive productivity study.

Each required implementation file must have bounded evidence covering the frozen behavior anchors and a literal contiguous quote in the reported source span and observed command output. Multiple bounded spans for the same file can jointly cover the anchors. Frozen symbol aliases allow nested helper or enclosing-class names where appropriate. Strict evidence failures remain distinct from semantic answer correctness; alternative valid traces require review rather than rewriting the gate. The frozen gate does not strip `nl -ba` line prefixes from observed stdout, so it can reject literal multi-line source quotes that were read with line numbers. Preserve that original gate and report a separate citation audit: remove only digit/tab line prefixes from observed stdout while retaining literal quote equality against the reported source span, and check every cited entry (including optional extra files). This audit does not repair altered quotes or missing behavior anchors.

A separate fixed-query keyword/hybrid comparison is planned but has not run because full vectors are unavailable. It would use the identical original task prompt, up to eight primary chunks and 8,000 snippet characters, and grade every expected implementation file, not merely the first relevant file. Raw rg is not given an entire natural-language question as a literal pattern. These ranking checks help distinguish retrieval behavior from the agent's query rewriting; they are separate from task timings.

## Antigravity compatibility spot check

Antigravity CLI 1.4.2, existing configured `Gemini 3.8 Flash (Medium)`, passed the English React/core property-tracking and Chinese Provider/core lifecycle tasks. Both expanded the installed user Skill, made one keyword context call, read the implementations in both packages, returned correct explanations and left source unchanged. These local checks need no embedding request. They are not a cross-model timing comparison.

## Preparation corrections

Preparation issues were identified and corrected:

- The first local-only driver startup incorrectly tried the deliberately disabled Scythe wrapper in the rg baseline. It stopped before any account session; baseline readiness now uses the already verified metadata status.
- A cold-index copy initially dereferenced symlinks, changing the corpus. That timing was excluded and repeated with symlinks preserved, matching the original 3,571 files/5,976 chunks.
- An own-project `npm run verify` accidentally discovered and executed some external snapshot tests under ignored `local/`. The attempt failed due to missing target dependencies/environment and was excluded. `npm test` now adds the additive `--exclude "local/**"` flag; no maintained test or assertion was removed. The original 351 tests in 36 files, build, smoke, audit and package checks passed afterward, as did the existing benchmark gate. A fresh archive comparison confirmed all 3,611 regular source-file contents still match the pinned commit.

No target dependencies were installed. Preserve these corrections and all original failures when publishing results. This evaluation remains read-only lookup work, not implementation, debugging acceptance tests or a general claim of speed/token savings.


## Archive-time validation (2026-10-19)

Maintenance ended after this evaluation. Hybrid remains unmeasured; no further collection or releases are planned. The public results above remain the original local comparison, separate from the own-repository checks below.

`npm run verify` passed all 351 tests in 36 files, build, executable/smoke checks, production dependency audit (zero vulnerabilities) and package dry run. The final documentation and data snapshot was pushed in commit `8cc9865`. Its [GitHub CI run](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/runs/39182161964) passed unit tests and build but failed the existing own-repository keyword search gate: hit@5 was 60/61 (0.9836) against the unchanged 1.0 requirement, with MRR 0.8511. The `npm-package-files` case did not return an expected implementation path in its first five results. A local rerun reproduced the failure.

This later result supersedes the earlier preparation-time gate pass for the expanded archive corpus. It does not change the recorded TanStack task results. The ranking limitation and original failed CI are retained; no ranking behavior, expected answers or acceptance thresholds were changed to obtain a green archive.
