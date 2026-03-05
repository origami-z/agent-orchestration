# Copilot Instructions: Component Library Orchestration

You are helping with a component library update workflow. This repository orchestrates
changes across a component library and multiple consumer apps, using a local Verdaccio
npm registry for testing.

## How It Works

The system auto-detects project settings at runtime:
- **Paths**: Library and consumer app locations are resolved interactively or from sibling directories
- **Package managers**: Detected from lockfiles (npm/pnpm/yarn)
- **Commands**: Build, test, and lint commands are inferred from each project's `package.json` scripts

No static configuration file is required.

## Workflow

When asked to update the library and verify across apps:

### 1. Resolve Locations
- Identify the library repo (scan siblings for a publishable package, or ask the user)
- Identify consumer apps (scan siblings for projects that depend on the library, or ask the user)

### 2. Make Library Changes
- Work in the library repo to implement the requested changes
- Run build and tests (detected from `package.json` scripts) to verify locally

### 3. Publish Locally via Verdaccio
```bash
bash scripts/verdaccio-start.sh
node scripts/verdaccio-publish.mjs --library <library-path>
```

### 4. Verify Consumer Apps
Use `/fleet` to verify all consumer apps **in parallel**:
```
/fleet For each consumer app, run:
  node scripts/consumer-update.mjs --consumer <app-path> --library-name <pkg-name>
Then read .results-<name>.json and report pass/fail.
```

If `/fleet` is not available, run sequentially:
```bash
node scripts/consumer-update.mjs --consumer ../app-one --library-name @myorg/components
node scripts/consumer-update.mjs --consumer ../app-two --library-name @myorg/components
```

### 5. Iterate on Failures
- Read `.results-<name>.json` for failure details
- Fix issues in the library or consumer app as appropriate
- Re-publish and re-verify (max 5 iterations)

### 6. Report Results
Summarize what changed and whether all consumers pass.

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/verdaccio-start.sh [port]` | Start local Verdaccio registry (default port 4873) |
| `scripts/verdaccio-stop.sh [--clean]` | Stop Verdaccio (`--clean` to wipe storage) |
| `scripts/verdaccio-publish.mjs --library <path>` | Build + publish library to local registry |
| `scripts/consumer-update.mjs --consumer <path> --library-name <name>` | Update consumer and run verification |

## Key Rules
- Library changes and consumer changes should be separate steps
- Always re-publish after library changes
- Always re-verify ALL consumers after any change
- Max 5 iteration attempts before asking the user for help
- Scripts auto-detect package managers and verify steps from `package.json`
