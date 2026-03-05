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
Use `/fleet` to verify all consumer apps **in parallel**. Each consumer verification
is independent and should run as a separate subagent:

```
/fleet Verify all consumer apps against the locally published library version.
For each consumer defined in orchestration.config.json, run:
  node scripts/consumer-update.mjs <consumer-name>
Then read .results-<consumer-name>.json and report pass/fail.
```

If `/fleet` is not available, run them sequentially:
```bash
node scripts/consumer-update.mjs app-one
node scripts/consumer-update.mjs app-two
```

### 5. Iterate on Failures
- Read `.results-<name>.json` for failure details
- Fix issues in the library or consumer app as appropriate
- Re-publish and re-verify (max 5 iterations)
- Use `/fleet` to parallelize consumer fixes when they are independent of each other

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
