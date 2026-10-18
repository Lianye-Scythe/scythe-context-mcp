# Agent lookup pilot: rg, keyword and hybrid

## Scope and decision

Recorded on 2026-10-18. This is a small read-only lookup pilot, not a code-editing evaluation, a whole-repository benchmark or a statistically conclusive productivity study. It compares agent workflows rather than requiring a particular retrieval algorithm for every query.

All 36 task/group cells completed. Parent-agent review found the requested behavior answers correct in all three workflows (12/12 each). Strict source-quote checks passed 11/12 for rg, 12/12 for keyword and 11/12 for hybrid. Keep rg for supplied identifiers, keyword as the local starting point for unknown locations, and hybrid optional. This pilot does not establish a general speed/token advantage for hybrid.

## Fixed conditions

- Codex CLI 0.163.0, `gpt-6.1-sol`, medium reasoning, matching the existing local configuration; Scythe engine commit `c7d6484`.
- Four pinned public source subtrees from Flask, Fastify, ripgrep/globset and PocketBase/security: 78 indexed files, 241 chunks. Commits, questions and held-out evidence anchors are in [agent-lookup-tasks.json](../benchmarks/agent-lookup-tasks.json).
- Twelve tasks fixed before the sessions: four supplied identifiers, four natural-language descriptions and four paraphrases. Each asks for the implementation and a specific conditional behavior. Answers need source evidence, not just a guessed file.
- One fresh ephemeral session per task/group: 36 scheduled cells, with the starting group rotated by task index. Each run has the same 120-second limit. No answer tuning or reruns of completed task attempts. The first batch completed five cells before account quota blocked 31 cells without tool execution. After quota reset, only those 31 blocked cells were resumed, retaining the original report and blocked attempts separately. This split adds a temporal/cache confound; it is not a clean uninterrupted timing trial.
- All groups may inspect directories and read source. The rg group uses rg/direct reads; Scythe groups start unknown-location lookup with their assigned keyword/hybrid mode, then may refine with rg or read files. A supplied identifier can go directly to rg in all groups. Report actual Scythe use rather than assuming every labeled group invoked it.
- The Scythe context suggestion is compact output, three results, a 2400-character primary context budget. Actual agent commands are retained. This setting is an evaluation condition, not a newly selected product default.
- User configuration, apps, plugins and nested agents are disabled for the client invocation. No MCP tools or Skills are part of the treatment. This tests explicit CLI workflow routing, not implicit Skill discovery or MCP overhead. Saved client authentication is reused; global settings are not edited.

Each session gets a new copy of the same source and prepared index. The private copied database's project root is rebased before a metadata refresh, preserving chunk/vector IDs. This avoids mixing the original and copied roots. Freshness and complete configured vector coverage are checked before execution. Hidden wrapper/trace files are outside source lookup. Source hashes are checked after every run; target dependencies and target code are not executed.

The lookup wrapper calls the source CLI's `main` entry in the same process, pins its project/mode, and records output size, exit code and effective mode. This avoids a nested subprocess restriction in the evaluation sandbox. Provider credentials are loaded by the wrapper through Scythe's existing protected configuration, not included in prompts or reports. The sandbox permits network access equally for all groups; task instructions limit remote activity to Scythe's configured embedding service.

## Acceptance and measurements

Automatic checks require a completed run, expected file/symbol, a bounded line range covering fixed source anchors, a quote found both in that source range and visible command output, and unchanged source. A command that attempts Scythe must produce a successful traced output; a hybrid lookup must report effective hybrid mode. A later successful rg answer does not make a failed Scythe lookup operational.

Short answers are also reviewed against the source for behavior correctness. This is parent-agent review, not an independent human or blinded reviewer. Per-run evidence flags and semantic review are separate; a right file and quote alone do not establish a correct explanation.

Metrics:

- Wall time includes client startup, model work, tools and query embedding; snapshot preparation is excluded and recorded separately.
- Command calls are observed Codex command-execution items. One shell command can contain multiple operations; this is not an exact count of individual rg invocations.
- Captured command-output characters measure text returned by those commands, including path/line metadata and possible truncation. They are not bytes read from disk, unique context size or estimated tokens.
- Input, cached input and output tokens come from `turn.completed.usage`, as documented for [Codex JSON output](https://developers.openai.com/codex/noninteractive). Input includes repeated context across model calls; cached input is a subset, not an extra amount to add. Do not convert these counts into subscription quota or billing.
- Scythe traces distinguish metadata-only calls, keyword and actual hybrid queries. Hybrid query embeddings are separate provider work, not Codex model tokens.

| Workflow | Correct answers | Strict evidence checks | Median seconds | Total command calls | Total input tokens (cached subset) |
| --- | ---: | ---: | ---: | ---: | ---: |
| rg | 12/12 | 11/12 | 15.03 | 32 | 789,034 (556,288) |
| keyword | 12/12 | 12/12 | 15.93 | 29 | 735,278 (556,032) |
| hybrid | 12/12 | 11/12 | 14.90 | 31 | 770,323 (563,072) |

All 36 completed cells contribute to timing and usage, including quote-format failures. These totals exclude preflight diagnostic sessions and account-rejected attempts with unavailable usage. Output-token totals were rg 3,462, keyword 3,488 and hybrid 3,595. Median input tokens per cell were 53,264.5, 53,256.5 and 53,282 respectively: most cells were very similar; a few longer searches drive the total differences.

| Task type (four per group) | rg median seconds | Keyword median seconds | Hybrid median seconds |
| --- | ---: | ---: | ---: |
| identifier | 13.40 | 14.94 | 13.53 |
| natural | 13.33 | 15.17 | 14.71 |
| paraphrase | 21.53 | 18.02 | 20.65 |

| Task type | rg input tokens total | Keyword input tokens total | Hybrid input tokens total |
| --- | ---: | ---: | ---: |
| identifier | 209,713 | 209,615 | 209,681 |
| natural | 230,378 | 233,405 | 231,184 |
| paraphrase | 348,943 | 292,258 | 329,458 |

Observed keyword input tokens were 6.8% lower overall than rg, primarily from the four paraphrase tasks (292,258 versus 348,943). Keyword was faster than rg in 5/12 paired cells; hybrid in 7/12. This does not meet the full protocol's repeated-trial requirement. Natural-language tasks used nine command calls in each workflow, with no demonstrated command-count gain.

Actual Scythe use was eight keyword context calls and eight effective hybrid context calls, one per unknown-location task in each corresponding group. All supplied-identifier tasks used rg/direct reads in all groups; those controls do not measure forced keyword versus vector retrieval. The hybrid group made eight logical query-embedding calls; indexing was not performed by the agents. No unexpected tool types or source changes were observed.

Median captured command-output sizes were rg 3,447 characters, keyword 3,208 and hybrid 2,701.5. Smaller captured output is not by itself proof of lower model token use: client instructions, repeated context, answer formatting and extra turns also contribute.

The two strict failures were `fastify-identifier-hybrid` and `security-identifier-rg`: their explanations and source locations were correct, but the purported exact quotes joined separate lines and/or contained literal escaped characters. They remain strict failures. Neither used Scythe, so they are not evidence of vector-ranking errors. All 36 semantic answers were separately reviewed against the source by the implementation agent.

## Initialization cost

Fresh metadata indexing was measured once per subtree, including Node CLI startup, excluding source download/copy:

| Source subtree | Cold metadata seconds | Files | Chunks |
| --- | ---: | ---: | ---: |
| flask | 0.193 | 26 | 106 |
| fastify | 0.178 | 31 | 83 |
| globset | 0.147 | 11 | 39 |
| security | 0.118 | 10 | 13 |

Existing matching embeddings were reused: 241/241 chunks, `gemini-embedding-2`, 1536 dimensions. A fresh end-to-end embedding pass and provider billing were not measured again. Thus this pilot can report prepared-index lookup cost, not complete first-use embedding cost. Copy/rebase/refresh time is fixture preparation, not a substitute for cold indexing or embedding measurements.

## Preflight exclusions

Infrastructure preflights are retained separately under ignored `local/benchmark/agent-lookup-*` records and `/tmp/scythe-agent-*` logs. They are not included in the 36-session comparison:

- A first wrapper used a nested synchronous child process. In the client sandbox it returned an `EPERM` launch error with empty output despite a zero status field; the wrapper initially failed to inspect the launch error. Agents recovered via rg, which was not valid evidence of Scythe use.
- The in-process replacement initially referenced a non-exported dotenv path. It was corrected using the installed package's resolved export, and wrapper exceptions now produce failed traces.
- A two-session validation then confirmed nonempty keyword output and effective hybrid output before the fixed formal batch.

The final driver records failed lookup infrastructure and stops further account-backed runs. Formal failures and timeouts are retained, not silently replaced. The initial runner continued attempting cells after account quota rejection; this was fixed to stop at the first quota error. A new report can inherit earlier completed cells and resume only explicitly quota-blocked cells with no observed tool execution and no completed-turn usage report using `--resume-from`; retrieval/answer failures are not eligible for that retry. Driver and manifest hashes are recorded. Same-output continuation rejects changed driver/tasks/model/effort. Explicit `--resume-from` creates a separate report, records the previous driver hash, and requires matching tasks, model/effort, client version and engine commit. This allows an audited runner fix without rewriting earlier attempts.

One formal rg command excluded `!.scythe-context/**`; an overly broad evaluator string match mistook that for a Scythe invocation and stopped the runner. Invocation detection was corrected, a regression test added, and the inherited validation flag recomputed with an explicit `validationCorrection` note. The original report, timing, usage and answer were retained; no task answer was rerun for this correction.

## Reproduce from a source checkout

Prepare the pinned subtrees and complete vectors as described in the [fusion experiment](hybrid-fusion-evaluation.md#reproduce-from-a-source-checkout). Keep the task manifest and reports outside those source trees. Use the same engine build for all groups.

The runner consumes Codex account usage and calls the configured embedding service for hybrid lookups. Run manually, never as an automatic CI check:

```bash
npm run build
node scripts/agent-lookup-evaluation.mjs --sources-root /tmp/scythe-fusion --output local/benchmark/my-lookup-pilot.json --model gpt-6.1-sol --reasoning medium
```

For an initial check, use a different output file with `--tasks flask-natural --max-runs 2`. To continue after an account-quota interruption, use the same settings with a **new** output path plus `--resume-from <previous-report.json>`. The previous report stays unchanged. Rerunning the identical command/output resumes only unrecorded cells; existing failed runs remain recorded. The [sanitized measured cells](../benchmarks/agent-lookup-pilot-results.json) omit host paths and raw transcripts. Detailed transcripts and structured answers are saved next to the report in its `-runs/` directory. Keep them local and inspect for sensitive host details before sharing.

## Limits and next evidence

One repetition does not separate retrieval effects from model sampling, cache state, provider variation or machine load. Four small source subtrees have much less distraction than complete repositories. Several tasks target common libraries that may be familiar to the model; source-grounding checks reduce guessing but do not remove prior-knowledge effects. No TypeScript-specific project, C#, C++, Chinese task wording, source modification, test/build repair, or multi-hop change task is covered.

Treat this as a check of the evaluation method and routing decisions. For stronger claims, follow the [full task A/B protocol](codex-evaluation.md): whole repositories, independent tasks/labels, at least three repetitions, code changes with common acceptance tests, and separately measured first-use embeddings. Do not turn one pilot's medians into a general speed/token guarantee.
