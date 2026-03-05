# Verdaccio Local Registry Management

## Skill: /verdaccio

Manage the local Verdaccio npm registry for testing unpublished library versions.

### Commands

When the user invokes `/verdaccio`, determine which action they want:

#### Start
```bash
bash scripts/verdaccio-start.sh
```
Starts Verdaccio on port 4873 if not already running. Verify with:
```bash
curl -sf http://localhost:4873/-/ping && echo "Running" || echo "Not running"
```

#### Stop
```bash
bash scripts/verdaccio-stop.sh
```
Add `--clean` to also wipe the local storage.

#### Publish
1. Ensure Verdaccio is running first
2. Run the publish script:
```bash
node scripts/verdaccio-publish.mjs
```
3. The new version is saved to `.local-version`
4. Report the published version to the user

#### Status
```bash
curl -sf http://localhost:4873/-/ping && echo "Verdaccio is running" || echo "Verdaccio is not running"
```
If running, also show published packages:
```bash
npm search --registry http://localhost:4873 @myorg
```

### Important Notes
- Always check if Verdaccio is running before attempting to publish
- The publish script handles version bumping automatically (appends `-local.<timestamp>`)
- Original package.json versions are modified — the library repo will have uncommitted changes after publish
- Registry URL: http://localhost:4873
