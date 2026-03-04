# Copilot Instructions: Component Library Orchestration

You are helping with a component library update workflow. This repository orchestrates
changes across a component library and multiple consumer apps, using a local Verdaccio
npm registry for testing.

## Repository Structure

```
../component-library/   # React component library (monorepo, single package: @myorg/components)
../app-one/             # Consumer app (npm)
../app-two/             # Consumer app (pnpm)
../agent-orchestration/ # This repo — orchestration config and scripts
```

## Configuration

All settings are in `orchestration.config.json`. Read it to understand paths, commands,
and consumer app details.

## Workflow

When asked to update the library and verify across apps:

### 1. Explore & Plan
- Read `orchestration.config.json`
- Explore the library codebase to understand the current state
- Ask the user what changes are needed

### 2. Make Library Changes
- Work in the library repo (`../component-library/`)
- Run build and tests to verify the changes work locally

### 3. Publish Locally via Verdaccio
```bash
# Start Verdaccio if needed
bash scripts/verdaccio-start.sh

# Build, version bump, and publish
node scripts/verdaccio-publish.mjs
```

### 4. Verify Consumer Apps
For each consumer app:
```bash
node scripts/consumer-update.mjs <consumer-name>
```
This installs the new version and runs build + test + lint.

### 5. Iterate on Failures
- Read `.results-<name>.json` for failure details
- Fix issues in the library or consumer app as appropriate
- Re-publish and re-verify (max 5 iterations)

### 6. Report Results
Summarize what changed and whether all consumers pass.

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/verdaccio-start.sh` | Start local Verdaccio registry |
| `scripts/verdaccio-stop.sh` | Stop Verdaccio (`--clean` to wipe storage) |
| `scripts/verdaccio-publish.mjs` | Build + publish library to local registry |
| `scripts/consumer-update.mjs <name>` | Update consumer and run verification |

## Key Rules
- Library changes and consumer changes should be separate steps
- Always re-publish after library changes
- Always re-verify ALL consumers after any change
- Max 5 iteration attempts before asking the user for help
- Consumer apps may use different package managers (npm or pnpm)
