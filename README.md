# agent-orchestration

Cross-platform AI agent orchestration for updating a React component library and verifying
changes across multiple consumer apps using a local Verdaccio registry.

## Supported Platforms

- **Claude Code** — full subagent orchestration with `/verdaccio` and `/orchestrate` skills
- **GitHub Copilot** — instructions-based workflow via `.github/copilot-instructions.md`

## Quick Start

1. **Run** — invoke `/orchestrate` (Claude Code) or ask Copilot to follow the workflow
2. The agent will ask for your library and consumer app paths (or auto-detect them from sibling directories)
3. Build, test, and lint commands are inferred from each project's `package.json`
4. The agent publishes locally, verifies consumers, and fixes issues automatically

## How It Works

```
Library changes → Verdaccio publish → Consumer verification → Fix & repeat
```

See [DESIGN.md](DESIGN.md) for the full architecture and design rationale.

## Prerequisites

- [Verdaccio](https://verdaccio.org/) installed (`npm i -g verdaccio`)
- Node.js 18+
- Library and consumer repos as sibling directories
