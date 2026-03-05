# Orchestration Agent Design Document

## Problem Statement

When updating a shared React component library, changes need to be verified across
multiple consumer applications before they can be considered safe. This process involves:

1. Making changes in the library
2. Publishing a test version
3. Updating each consumer app to use the test version
4. Running build, tests, and lint in each consumer
5. Iterating if anything breaks

This is tedious and error-prone when done manually. An AI-assisted orchestration agent
can automate this loop across repositories.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR AGENT                        │
│              (Claude Code or GitHub Copilot)                 │
│                                                             │
│  Skills: /verdaccio, /orchestrate                           │
│  Auto-detects: paths, package managers, verify steps        │
│                                                             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  Phase 1  │→│   Phase 2    │→│       Phase 3          │ │
│  │ Resolve & │  │ Library      │  │  Verdaccio Publish    │ │
│  │ Clarify   │  │ Subagent     │  │  (scripts/)           │ │
│  └──────────┘  └──────────────┘  └───────────────────────┘ │
│                                           │                  │
│                                           ▼                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    Phase 4: Verify                       ││
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐        ││
│  │  │ Consumer 1  │  │ Consumer 2  │  │ Consumer N  │       ││
│  │  │ Subagent    │  │ Subagent    │  │ Subagent    │       ││
│  │  │ (parallel)  │  │ (parallel)  │  │ (parallel)  │       ││
│  │  └────────────┘  └────────────┘  └────────────┘        ││
│  └─────────────────────────────────────────────────────────┘│
│                         │                                    │
│                         ▼                                    │
│  ┌──────────────────────────────────────┐                   │
│  │  Phase 5: Iterate (max N retries)    │                   │
│  │  - Fix library or consumer           │                   │
│  │  - Re-publish, re-verify all         │                   │
│  │  - Loop until green or max reached   │                   │
│  └──────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

## Design Principles

### Convention Over Configuration

Instead of requiring a static `orchestration.config.json`, the system infers settings at runtime:

1. **Package manager** — detected from lockfiles (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm)
2. **Build/test/lint commands** — detected from `package.json` `scripts` section
3. **Library identity** — read from `package.json` `name` field
4. **Consumer discovery** — scan sibling directories for projects that depend on the library
5. **Verdaccio settings** — sensible defaults (port 4873, storage `/tmp/verdaccio-storage`)

The skills prompt the user interactively when something cannot be inferred.

### Optional Configuration Fallback

If an `orchestration.config.json` exists, the scripts accept it via `--config` flag (legacy mode).
This allows existing setups to keep working, but new usage doesn't require any config file.

## File Structure

```
agent-orchestration/
├── CLAUDE.md                          # Claude Code agent instructions
├── DESIGN.md                          # This document
├── .claude/
│   └── skills/
│       ├── verdaccio.md               # /verdaccio skill definition
│       └── orchestrate.md             # /orchestrate skill definition
├── .github/
│   └── copilot-instructions.md        # GitHub Copilot agent instructions
└── scripts/
    ├── verdaccio-start.sh             # Start local Verdaccio
    ├── verdaccio-stop.sh              # Stop local Verdaccio
    ├── verdaccio-publish.mjs          # Build + publish library locally
    └── consumer-update.mjs            # Update + verify a consumer app
```

## Script Interface

### verdaccio-publish.mjs

```
node verdaccio-publish.mjs --library <path> [--port <port>]
```

- Auto-detects package manager from lockfile
- Auto-detects build command from `package.json`
- Starts Verdaccio if not running
- Bumps version with `-local.<timestamp>` tag
- Publishes to local registry
- Writes version to `.local-version`

### consumer-update.mjs

```
node consumer-update.mjs --consumer <path> --library-name <name> [--port <port>] [--steps build,test]
```

- Auto-detects package manager from lockfile
- Auto-detects verify steps from `package.json` scripts (build, test, lint)
- Points consumer at Verdaccio via temporary `.npmrc`
- Installs the local library version
- Runs detected verify steps
- Writes results to `.results-<name>.json`
- Restores original `.npmrc` on completion

## Verdaccio Integration

### Why Verdaccio?

Verdaccio provides a local npm registry that:
- Allows publishing pre-release versions without polluting the real registry
- Proxies to npmjs.org for all other packages
- Runs locally with zero configuration needed

### Version Strategy

The publish script appends `-local.<timestamp>` to the library version:
```
1.2.3 → 1.2.3-local.1709571234567
```

This ensures:
- Each publish gets a unique version (no caching issues)
- It's clearly a local/test version
- The base version is preserved

### Registry Isolation

Consumer apps temporarily point at Verdaccio during verification:
1. `.npmrc` is modified to use `http://localhost:4873` as the registry
2. The library package is installed from Verdaccio
3. All other packages are proxied to npmjs.org by Verdaccio
4. After verification, `.npmrc` is restored from backup

## Defaults

| Setting | Default | How to Override |
|---------|---------|-----------------|
| Verdaccio port | 4873 | `--port` flag on scripts, `--verdaccio-port` on skill |
| Verdaccio storage | `/tmp/verdaccio-storage` | — |
| Max iterations | 5 | `--max-iterations` on skill |
| Verify steps | auto-detect from `package.json` | `--steps` flag on consumer-update |
| Package manager | auto-detect from lockfile | — |

## Cross-Platform Support

### Claude Code

Uses `.claude/skills/` for `/verdaccio` and `/orchestrate` commands, and subagents for parallel work.

### GitHub Copilot

Uses `.github/copilot-instructions.md` for workflow guidance and `/fleet` for parallel consumer verification.

Both platforms share the same scripts and auto-detection logic.

## Iteration Loop

```
                    ┌──────────────┐
                    │ Make library  │
                    │ changes       │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Publish to   │
                    │ Verdaccio    │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Verify all   │
               ┌────│ consumers    │
               │    └──────┬───────┘
               │           │
            FAIL        ALL PASS
               │           │
    ┌──────────▼──┐  ┌─────▼──────┐
    │ iteration   │  │   Done!    │
    │ < max?      │  │   Report   │
    └──────┬──────┘  └────────────┘
       YES │  NO
           │   │
    ┌──────▼┐ ┌▼──────────┐
    │ Fix   │ │ Stop &     │
    │ code  │ │ report     │
    └───┬───┘ └────────────┘
        │
        └──→ (back to Publish)
```

### Fix Decision Logic

When a consumer fails:
1. **Type errors / missing exports** → likely a library issue (fix in library)
2. **API usage mismatches** → could be either; check if the library API changed intentionally
3. **Lint errors** → usually a consumer-side fix
4. **Test assertion failures** → could be either; analyze the specific failure
5. **Build config errors** → usually a consumer-side fix

## Security Considerations

- Verdaccio runs on localhost only (not exposed to network)
- `.npmrc` modifications are always restored after verification
- Published versions use a `-local.*` prerelease tag (never a real version)
- No credentials are stored — Verdaccio's default allows unauthenticated local access
