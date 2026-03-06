# Verdaccio Local Registry Management

## Skill: /verdaccio

Manage the local Verdaccio npm registry for testing unpublished library versions.

### Arguments

All arguments are optional with sensible defaults:

- `--port <port>` — Verdaccio port (default: 4873)
- `--library <path>` — Path to the library repo (required for `publish`, auto-detected otherwise)

### Commands

When the user invokes `/verdaccio`, determine which action they want:

#### Start
```bash
bash scripts/verdaccio-start.sh [port]
```
Starts Verdaccio on port 4873 (or the specified port) if not already running. Verify with:
```bash
curl -sf http://localhost:<port>/-/ping && echo "Running" || echo "Not running"
```

#### Stop
```bash
bash scripts/verdaccio-stop.sh
```
Add `--clean` to also wipe the local storage.

#### Publish

1. Ensure Verdaccio is running first (start it if not)
2. Resolve the library path:
   - Use `--library` if provided
   - Otherwise check if `orchestration.config.json` exists and has `library.path`
   - Otherwise scan sibling directories for a library-looking project
   - If ambiguous, **ask the user** which directory is the library
3. Run the publish script:
```bash
node scripts/verdaccio-publish.mjs --library <library-path> [--port <port>]
```
4. The new version is saved to `.local-version`
5. Report the published version to the user

#### Status
```bash
curl -sf http://localhost:<port>/-/ping && echo "Verdaccio is running" || echo "Verdaccio is not running"
```
If running, also show published packages:
```bash
npm search --registry http://localhost:<port> --long 2>/dev/null || echo "No packages found"
```

### Defaults

| Setting | Default |
|---------|---------|
| Port | 4873 |
| Storage | `/tmp/verdaccio-storage` |
| URL | `http://localhost:4873` |

### Important Notes

- Always check if Verdaccio is running before attempting to publish
- The publish script handles version bumping automatically (appends `-local.<timestamp>`)
- Original package.json versions are modified — the library repo will have uncommitted changes after publish
