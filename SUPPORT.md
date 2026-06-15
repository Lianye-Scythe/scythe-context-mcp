# Support

For setup or usage problems, start with:

- [Troubleshooting and first-run checks](docs/troubleshooting.md)
- [Gemini compatibility](docs/gemini-compatibility.md)
- [Codex integration review](docs/codex-integration.md)

Before opening an issue, run the compact diagnostics when possible:

```text
repo_doctor
repo_index_status
```

For Gemini or proxy problems, also run:

```text
gemini_embedding_probe({ "text": "short diagnostic test" })
```

Do not include API keys, proxy tokens, private source snippets, `.env`, `.scythe-context/`, `.repo-beacon/`, or `local/` files in public issues.
