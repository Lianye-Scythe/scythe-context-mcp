# Retrieval workflow verification

Scope: the 0.1.24 retrieval and Skill update, checked on 2026-10-18. This records the tested user workflow and its limits; it does not establish that every repository or agent decision is covered.

## Problems found and corrected

- Vector storage separated endpoint/model/dimension sets, but retrieval selected candidates by dimension alone. Retrieval now filters the configured set before nearest-neighbor selection, including exclusion of detached vector rows.
- Status and doctor could report another same-dimension set as usable coverage. They now report the configured set, including missing chunks.
- A successful query embedding could label a metadata-only lookup as hybrid even without code vectors. Missing configured vectors now cause local hybrid fallback or a semantic error before any query request.
- Natural-language registration lookup could lose the implementation behind numerous usages. Bounded declaration recovery now handles explicit snake_case/camelCase names in definition/registration queries, including indented const declarations. Usage/caller queries retain their existing candidate behavior.
- The Skill covered use of existing vectors more clearly than initial creation and updates. It now includes those steps, process-level credential checks, job limits, partial coverage, reuse, and failure handling. The release guide includes these checks.

Verification at the release candidate: 328 tests passed, the unchanged 61-case keyword gate passed (hit@5 1.00), build/package checks passed, and production dependency audit reported zero vulnerabilities. No dependencies were added or upgraded.

## Verification matrix

| Scenario | Evidence |
| --- | --- |
| Exact string / known path / ranked lookup / relationship lookup | Skill routing reviewed against CLI commands; CLI and MCP local workflows tested with a configured fixture provider and zero API requests. |
| Missing metadata index | CLI/MCP return a missing-index result without API calls. |
| Metadata-only index | Hybrid falls back; semantic errors; neither sends a query. |
| First embedding run and limited coverage | Real CLI fixture endpoint and a small real-provider flow create one vector, report one missing, and resume. |
| Unchanged source | Repeated embedding indexing reports zero embedded chunks and makes no fixture API calls. |
| Changed source | Metadata is refreshed and only the changed file's missing vector is embedded in the small flow. |
| Deleted source | Coverage shrinks without re-embedding surviving chunks; semantic results exclude deleted data. |
| Provider / endpoint / model / dimension changes | Coverage rejects incompatible sets; native SQLite vector tests isolate same-dimension model and endpoint candidates before limiting results. CLI checks model, endpoint and dimension switches. |
| Provider failure during indexing | CLI exits nonzero; metadata remains fresh and keyword retrieval works; a subsequent successful run fills the missing vector. |
| Query timeout or wrong dimensions | CLI/MCP preserve hybrid fallback and semantic errors with usable code vectors already present. |
| Natural-language identifier lookup | Added snake_case/camelCase regression fixtures; existing 61-case keyword gate retains its cases and thresholds. |
| Language navigation and interface parity | Existing multilingual fixtures and CLI/MCP parity tests remain part of the full test suite. |
| Packaging and installed use | Release checks compare the published tarball with the release checkout and run the real-provider lifecycle through the installed CLI. Installed Skill is compared separately. |

The real-provider flow uses two temporary generic TypeScript files, not the working repository: initial create 1, resume 1, unchanged 0, changed 1, deletion 0, followed by a successful hybrid query. Temporary source/index data is removed afterward. It proves provider connectivity and the vector lifecycle for that sample, not retrieval quality across arbitrary codebases.

## Remaining limits

- The agent chooses tools from Skill instructions; the CLI is not an automatic router or background index watcher. Skill format validation and command tests cannot prove that an agent will always choose optimally.
- Metadata freshness uses size/mtime before hashing changed candidates. A same-size edit with a deliberately preserved mtime may appear fresh; explicit indexing hashes content and detects it.
- Coverage counts describe indexed chunks. Ignored files, file-size/chunk limits, partial embedding jobs, and conservative language parsing still bound retrieval. File-path order determines which missing chunks are embedded first, not task relevance.
- CLI credentials come from its process environment or working-directory `.env`. A key stored only in MCP server settings is not automatically available to CLI, and `--project` does not select a different `.env`. Current-workspace configuration does not configure every other workspace.
- Semantic and hybrid retrieval do not provide compiler binding, guaranteed semantic matches, or proven task-level token/time savings. Those require separate evaluation.
- Updating the npm package does not install or refresh a separately installed Skill. A published-package check and installed-Skill check are distinct release steps.
