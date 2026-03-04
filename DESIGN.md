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
│  Reads: orchestration.config.json                           │
│  Skills: /verdaccio, /orchestrate                           │
│                                                             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  Phase 1  │→│   Phase 2    │→│       Phase 3          │ │
│  │ Explore & │  │ Library      │  │  Verdaccio Publish    │ │
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

## File Structure

```
agent-orchestration/
├── CLAUDE.md                          # Claude Code agent instructions
├── DESIGN.md                          # This document
├── orchestration.config.json          # Central configuration
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

## Configuration Schema

`orchestration.config.json` is the single source of truth:

```jsonc
{
  "library": {
    "name": "@myorg/components",     // npm package name
    "path": "../component-library",  // relative path from this repo
    "buildCommand": "npm run build",
    "testCommand": "npm test",
    "lintCommand": "npm run lint",
    "packageManager": "npm"          // npm or pnpm
  },
  "consumers": [
    {
      "name": "app-one",              // identifier for scripts
      "path": "../app-one",           // relative path from this repo
      "packageManager": "npm",
      "installCommand": "npm install",
      "buildCommand": "npm run build",
      "testCommand": "npm test",
      "lintCommand": "npm run lint",
      "dependencyName": "@myorg/components"
    }
    // ... more consumers
  ],
  "verdaccio": {
    "port": 4873,
    "storage": "/tmp/verdaccio-storage",
    "url": "http://localhost:4873"
  },
  "orchestration": {
    "maxIterations": 5,
    "verifySteps": ["build", "test", "lint"],
    "allowConsumerFixes": true
  }
}
```

## Cross-Platform Support

### Claude Code

Claude Code uses:
- **CLAUDE.md** at repo root for agent instructions and workflow documentation
- **Custom skills** in `.claude/skills/` for invocable commands (`/verdaccio`, `/orchestrate`)
- **Subagents** via the `Agent` tool for parallelized work in separate repos

The orchestrator skill (`/orchestrate`) launches:
1. A **library subagent** — works in the component library to implement changes
2. **Consumer subagents** (in parallel) — each verifies one consumer app
3. Iteration is managed by the orchestrator reading result files

### GitHub Copilot

GitHub Copilot uses:
- **`.github/copilot-instructions.md`** for workspace-level instructions
- The same scripts and config as Claude Code
- Copilot doesn't have native subagent support, so the workflow is sequential:
  the agent works through each step itself, using the scripts for heavy lifting

Both platforms share the same:
- `orchestration.config.json` configuration
- Shell/Node scripts for Verdaccio and consumer management
- Overall workflow structure

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

The orchestrator (or its subagents) should analyze error output to determine
where the fix belongs.

## Subagent Design (Claude Code)

### Library Subagent
- **Working directory**: library repo path
- **Task**: implement specific changes, run build + tests
- **Scope**: only modifies library code
- **Reports**: files changed, build/test results

### Consumer Subagent (one per app)
- **Working directory**: consumer app path
- **Task**: run consumer-update script, fix issues if verification fails
- **Scope**: only modifies that consumer's code
- **Reports**: pass/fail per verification step, error details if failed
- **Can run in parallel** with other consumer subagents

### Orchestrator
- **Working directory**: this repo (agent-orchestration)
- **Coordinates**: launches subagents, reads results, decides next action
- **Maintains state**: iteration count, which consumers passed/failed
- **Does not modify** library or consumer code directly

## Usage Examples

### Claude Code

```
# Start the full orchestration
> /orchestrate

# Just manage Verdaccio
> /verdaccio start
> /verdaccio publish
> /verdaccio stop
```

### GitHub Copilot

In VS Code with Copilot agent mode, open a terminal in the orchestration repo and ask:
```
@workspace Update the Button component to support a "loading" prop and verify
it works in all consumer apps
```

Copilot will follow `.github/copilot-instructions.md` to execute the workflow.

## Adding a New Consumer App

1. Edit `orchestration.config.json` and add a new entry to the `consumers` array
2. Ensure the consumer repo exists as a sibling directory
3. The consumer must have the library listed as a dependency
4. Provide the correct package manager and commands

## Security Considerations

- Verdaccio runs on localhost only (not exposed to network)
- `.npmrc` modifications are always restored after verification
- Published versions use a `-local.*` prerelease tag (never a real version)
- No credentials are stored — Verdaccio's default allows unauthenticated local access
