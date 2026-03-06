# Agent Orchestration for Component Library Updates

This repository contains an orchestration system for updating a React component library
and verifying the changes across multiple consumer applications using a local Verdaccio registry.

## How It Works

The orchestration is driven by **skills** (`/orchestrate` and `/verdaccio`) that interactively
resolve paths, detect package managers, and infer build/test/lint commands from each project's
`package.json`. No static configuration file is required.

## Key Scripts

- `scripts/verdaccio-start.sh [port]` — Start Verdaccio local registry (default port 4873)
- `scripts/verdaccio-stop.sh [--clean]` — Stop Verdaccio (use `--clean` to wipe storage)
- `scripts/verdaccio-publish.mjs --library <path> [--port <port>]` — Build + publish library to local Verdaccio
- `scripts/consumer-update.mjs --consumer <path> --library-name <name> [--port <port>]` — Update a consumer app and run verification

All scripts auto-detect the package manager (npm/pnpm/yarn) from lockfiles, and infer
verification steps (build, test, lint) from the project's `package.json` scripts.

## Custom Skills

- `/verdaccio` — Manage the local Verdaccio registry (start, stop, publish)
- `/orchestrate` — Run the full orchestration workflow (implement → publish → verify → iterate)

### Orchestration Workflow (via `/orchestrate`)

1. **Resolve locations** — The skill asks for the library path and consumer app paths if not provided. It scans sibling directories and checks `package.json` dependencies to auto-detect consumers.
2. **Infer commands** — Build, test, and lint commands are detected from each project's `package.json` scripts. Package managers are detected from lockfiles.
3. **Implement** — A subagent works in the library repo to make the requested changes.
4. **Publish** — The library is built and published to a local Verdaccio registry.
5. **Verify** — Each consumer app is updated and verified in parallel via subagents.
6. **Iterate** — If consumers fail, fixes are applied and the loop repeats (max 5 iterations by default).
7. **Report** — Summary of all changes and results.

## Optional Configuration

If an `orchestration.config.json` exists, the scripts will use it as a fallback (legacy mode).
This is optional — the skills and scripts work without it by inferring everything at runtime.

## Rules for Subagents

- When working in the **library repo**, focus only on the library code. Do not modify consumer apps.
- When working in a **consumer repo**, focus only on adapting that consumer. Do not modify the library.
- Always read error output carefully before attempting fixes.
- The orchestrator (this repo's context) is the only place that coordinates cross-repo work.
