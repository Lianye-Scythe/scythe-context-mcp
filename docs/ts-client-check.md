# TypeScript client integration check

Recorded on 2026-10-18. Both Codex CLI and Antigravity CLI discovered the installed user Skill and invoked the installed Scythe CLI. This checks installation and read-only source lookup; it is not a coding-productivity study or a general ranking benchmark. The sanitized task questions, answers, usage and checks are in [the result file](../benchmarks/ts-client-check-results.json).

## Setup

- Full [gvergnaud/ts-pattern](https://github.com/gvergnaud/ts-pattern/tree/f11be73acb18e1d653d4f252e7d75981d873a2e6) snapshot, commit `f11be73acb18e1d653d4f252e7d75981d873a2e6`: 113 indexed files, 247 chunks. Dependencies were not installed and project code, lifecycle scripts and tests were not executed.
- Installed Scythe 0.1.24, Node 24.21.0, Codex CLI 0.163.0 (`gpt-6.1-sol`, medium), Antigravity CLI 1.4.2 (existing configured model: `Gemini 3.8 Flash (Medium)`). The npm registry still listed 0.1.24 as latest; the existing CLI was reused.
- Codex already had an identical Skill under its configured `CODEX_HOME/skills`; no duplicate was added. Antigravity's user Skill was installed in `~/.gemini/antigravity-cli/skills/scythe-context/`. Both copies were later synchronized with the proxy guidance described below.
- Public-source vectors were prepared once using source checkout `6916355` and the configured `gemini-embedding-2` compatible service, 1536 dimensions, batch size 1: 247/247 chunks, 144.47 seconds. This preparation time is separate from lookup times; monetary cost was not measured.
- Each session used a fresh source/index copy. Only that copied database's project root was rebased, preserving chunk/vector IDs. Antigravity fixtures also indexed one local configuration chunk disabling inherited MCP servers; its extra chunk had no vector, while all 247 original chunks retained theirs.
- A transparent PATH wrapper invoked the installed package in process, supplied existing protected provider configuration, pinned the fixture path and recorded actual output mode. Agent prompts contained no credentials. Global client settings and network grants were unchanged.

## Original runs

Three questions were fixed before the runs: an exact `isMatching` identifier/error question, a runtime early-exit question without a supplied symbol, and a paraphrased type-system question about removing scalar cases without expanding nested alternatives. The latter targets the actual `DeepExclude` primitive fast path, not just a runtime JavaScript function.

For each client, the two unknown-location questions used rg, keyword and hybrid workflows in fresh sessions, with one attempt per cell. A separate exact-identifier check explicitly invoked the installed Skill. Scythe workflows could use rg and direct reads after retrieval. Agents generated their own queries, so these are workflow observations, not fixed-query algorithm comparisons. No target source changed in any of the 14 runs.

| Client | Question | rg | keyword | requested hybrid |
| --- | --- | --- | --- | --- |
| Codex | Runtime early exit | 14.65 s | 13.95 s | 14.60 s, actual hybrid |
| Codex | Scalar exclusion type | 22.56 s | 16.40 s | 19.96 s, actual hybrid |
| Antigravity | Runtime early exit | 41.16 s | No answer at 100 s limit | 29.38 s, **keyword fallback** |
| Antigravity | Scalar exclusion type | 46.42 s | 58.00 s | 43.06 s, **keyword fallback** |

Both exact-identifier/Skill checks completed correctly: Codex 16.86 s and Antigravity 32.99 s. Both agents chose an additional keyword lookup even though direct rg was permitted for the supplied identifier; this does not demonstrate optimal routing.

All seven Codex runs and six of seven Antigravity runs returned the correct implementation and behavior explanation, with a literal contiguous source quote within the reported line span. Review was performed by the parent agent, not an independent blinded reviewer. The missing Antigravity answer remains an incomplete result.

Codex separately read the installed Skill file in three of its five explicit Skill runs. Its two hybrid runs announced Skill use without a separate file-read event. Antigravity's startup events confirmed Skill expansion in all five explicit Skill runs. Exported Antigravity `view_file` events may contain only a file summary, so exported text length is not a complete measure of context read.

Two operational limits matter:

1. Antigravity reached its `--print-timeout 100s` limit in the keyword runtime task. Stderr reported partial output, but the CLI exited 0 with a `SUCCESS` envelope and no response or structured answer. Neither status was accepted as task completion.
2. Both original Antigravity hybrid requests reported `fetch failed`, with actual mode keyword. They are **not successful vector-search measurements**, even though their final answers were correct.

In the Codex scalar-exclusion hybrid run, the primary three results were README sections and a test type catalog. The agent found the implementation through a later rg call. Keyword's primary results included `DistributeUnions.ts`, with `DeepExclude.ts` in related/suggested files. This is useful failure evidence; the queries differed, so it does not isolate an embedding-model or fusion defect.

## Proxy diagnosis and follow-up

A separate diagnostic kept the same Antigravity sandbox, provider, project and query. API-key and configured-endpoint presence were confirmed without printing values. The shell supplied HTTP/HTTPS proxy variables and already permitted the endpoint domain:

| Node startup | Observed request | Effective mode |
| --- | --- | --- |
| Default | `TypeError`, cause `EAI_AGAIN` | keyword fallback |
| `NODE_USE_ENV_PROXY=1` | HTTP 200 | hybrid |

This isolates a missing Node proxy opt-in in this environment. It does not identify a provider outage or require removing sandbox restrictions. [Node's official proxy guide](https://nodejs.org/learn/http/enterprise-network-configuration) documents the startup opt-in; [Antigravity's sandbox guide](https://www.antigravity.google/docs/sandbox?tab=cli) separately documents domain permissions.

The shared Skill now instructs remote commands to use `NODE_USE_ENV_PROXY=1 scythe-context ...` when the shell provides an HTTP/HTTPS proxy, without exposing proxy URLs. Setting it only in Scythe's runtime-loaded `.env` is too late for Node startup. The updated Skill was deployed to both clients. Follow-up agent runs are stored separately from the original comparison; failures above are retained.

Both follow-ups explicitly invoked the updated Skill and told it that the shell supplied a proxy, without giving the command prefix. Antigravity applied `NODE_USE_ENV_PROXY=1` itself, performed actual hybrid lookups, read source and returned correct answers and contiguous quotes: 32.04 s for the runtime question and 40.01 s for the type question. Source files remained unchanged. These confirm the proxy guidance works in that environment; they do not replace original cells or establish implicit Skill selection. Query wording and result limits were agent-selected again, so these are repair-verification runs rather than timing comparisons.

## Interpretation

The check establishes that CLI + Skill installation works across these two clients and can locate TypeScript runtime and type-level implementations in this repository. It also found a real client-environment integration gap and an empty-success/timeout reporting pitfall.

It does not establish that hybrid is generally faster, cheaper or necessary. There were only two compared questions per client, one attempt each, different model-generated queries, and client/model/cache/startup differences. The earlier [agent lookup pilot](agent-lookup-pilot.md) remains a separate experiment. Keep rg for known strings, keyword for local ranked lookup, and embeddings optional.

Instrumentation preflights are excluded: an extensionless wrapper initially inherited the target package's ESM setting while using CommonJS, and a later diagnostic helper had a placeholder-substitution syntax error. Those records were retained locally. The formal wrapper was corrected and checked before the 14 recorded runs; no failed answer was selectively replaced.
