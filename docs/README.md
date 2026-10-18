# Documentation

Start with the [English README](../README.md), [Traditional Chinese](../README.zh-TW.md), or [Simplified Chinese](../README.zh-CN.md). This index separates current guides from dated evidence and historical design records.

## Current guides

| Goal | Read |
| --- | --- |
| Configure Codex and choose Windows, WSL, Linux, or macOS startup | [Setup and advanced configuration](setup.md) |
| Diagnose startup, native modules, provider, or index failures | [Troubleshooting](troubleshooting.md) |
| Check language and project-reference navigation coverage | [Language support and limits](language-support.md) |
| Understand module boundaries, indexing, and retrieval | [Architecture](architecture.md) |
| Understand runtime and dependency choices | [Technology stack](tech-stack.md) |
| Configure or debug embedding request compatibility | [Gemini-compatible provider](gemini-compatibility.md) |
| Review Codex integration decisions | [Codex integration](codex-integration.md) |
| Contribute or publish | [Contributing](../CONTRIBUTING.md) · [Release process](release.md) |

Setup is the source for configuration examples. Troubleshooting links to those examples instead of maintaining another copy. Source code and `package.json` remain authoritative for implementation details and versions.

## Evaluation and maintenance records

- [Retrieval benchmark](benchmark.md): method, metrics, and recorded results.
- [Config-driven navigation](config-navigation.md): local TS/JS paths and Cargo target contexts, scope and fixed GitHub cases.
- [Index performance](index-performance.md): synthetic indexing/search latency, process memory, and chunk reuse measurements.
- [Dogfood evaluation](dogfood.md): repository-specific observations, not a controlled model productivity study.
- [Codex task A/B protocol](codex-evaluation.md) (Traditional Chinese): how to measure real task outcomes.
- [Dependency maintenance policy and PR cleanup](dependency-maintenance.md): automation scope and the 2026-10-12 dependency update.
- [Dependency security maintenance](dependency-security.md): audit and dependency review dated 2026-10-11.

Dates and environment details limit what these records establish. They are not general guarantees of speed, task completion, or ongoing security.

## Historical material

The [archive](archive/README.md) preserves early development phases, architecture proposals, and tree-sitter experiments. Use current guides for installation and supported behavior.
