# Agent Orchestration for Component Library Updates

This repository contains an orchestration system for updating a React component library
and verifying the changes across multiple consumer applications using a local Verdaccio registry.

## Repository Layout

All repos are sibling directories:
```
../component-library/   # The component library (monorepo, single publishable package)
../app-one/             # Consumer app (npm)
../app-two/             # Consumer app (pnpm)
../agent-orchestration/ # This repo (orchestration config, scripts, agent instructions)
```

## Configuration

- `orchestration.config.json` — defines library, consumers, Verdaccio settings, and orchestration params.
- Edit this file to add/remove consumers, change commands, or adjust max iterations.

## Key Scripts

- `scripts/verdaccio-start.sh` — Start Verdaccio local registry
- `scripts/verdaccio-stop.sh` — Stop Verdaccio (use `--clean` to wipe storage)
- `scripts/verdaccio-publish.mjs` — Build + publish library to local Verdaccio
- `scripts/consumer-update.mjs <name>` — Update a consumer app and run verification

## Orchestration Workflow

When asked to update the component library and verify across consumers, follow this workflow:

### Phase 1: Explore & Plan
1. Read `orchestration.config.json` to understand the current setup
2. Explore the component library repo to understand the codebase
3. Ask clarification questions about the desired changes
4. Form a plan for the library changes

### Phase 2: Implement in Library
1. Launch a subagent (or work directly) in the library repo to make changes
2. Run the library's own build and tests to ensure basic correctness

### Phase 3: Publish Locally
1. Ensure Verdaccio is running: `bash scripts/verdaccio-start.sh`
2. Publish to local registry: `node scripts/verdaccio-publish.mjs`
3. The published version is written to `.local-version`

### Phase 4: Verify in Consumers
1. For each consumer app, run: `node scripts/consumer-update.mjs <consumer-name>`
2. This installs the local version and runs build + test + lint
3. Results are written to `.results-<consumer-name>.json`

### Phase 5: Iterate (max 5 iterations)
1. If any consumer fails, read the `.results-*.json` files to understand failures
2. Determine if the fix belongs in the library or the consumer app
3. Make fixes, then repeat from Phase 3
4. Stop after `orchestration.maxIterations` failed attempts

### Phase 6: Report
1. Summarize which consumers passed/failed
2. List all changes made (library + any consumer fixes)
3. Clean up: `bash scripts/verdaccio-stop.sh --clean`

## Rules for Subagents

- When working in the **library repo**, focus only on the library code. Do not modify consumer apps.
- When working in a **consumer repo**, focus only on adapting that consumer. Do not modify the library.
- Always read error output carefully before attempting fixes.
- The orchestrator (this repo's context) is the only place that coordinates cross-repo work.

## Custom Skills

- `/verdaccio` — Manage the local Verdaccio registry (start, stop, publish)
- `/orchestrate` — Run the full orchestration workflow (implement → publish → verify → iterate)
