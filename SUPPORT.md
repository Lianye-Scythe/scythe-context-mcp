# Support

For setup or usage problems, start with:

- [Troubleshooting and first-run checks](docs/troubleshooting.md)
- [Gemini compatibility](docs/gemini-compatibility.md)
- [Setup and platform configuration](docs/setup.md)
- [Documentation index](docs/README.md)

Before opening an issue, run the compact diagnostics when possible:

```text
repo_doctor
repo_index_status
```

For Gemini or proxy problems, run the following only when you intend to send the test text to the configured endpoint:

```text
gemini_embedding_probe({ "text": "short diagnostic test" })
```

Do not include API keys, proxy tokens, private source snippets, `.env`, `.scythe-context/`, `.repo-beacon/`, or `local/` files in public issues.
