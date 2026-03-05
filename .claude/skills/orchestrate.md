# Full Orchestration Workflow

## Skill: /orchestrate

Run the complete library-update-and-verify orchestration loop.

### When Invoked

The user wants to make a change to a component library and verify it works across consumer apps.

### Arguments

The user may provide these inline with the command or they can be resolved interactively:

- `--library <path>` — Path to the library repo
- `--apps <path1> <path2> ...` — Paths to consumer app repos
- `--max-iterations <n>` — Max fix-and-retry loops (default: 5)
- `--verdaccio-port <port>` — Verdaccio port (default: 4873)

### Step-by-Step Procedure

#### 1. Resolve Library Location

If the user did **not** provide `--library`:
1. Check if an `orchestration.config.json` exists in the current repo. If it has a `library.path`, use that.
2. Otherwise, look for sibling directories (e.g., `ls ../`) that look like a component library (contain a `package.json` with a `main` or `exports` field).
3. If still ambiguous, **ask the user**: _"Which directory is the component library?"_ and present the candidates.

Read the library's `package.json` to determine:
- **Package name**: from `name` field
- **Package manager**: if a `pnpm-lock.yaml` exists use `pnpm`, if `yarn.lock` exists use `yarn`, otherwise `npm`
- **Build command**: look for `build` script in `package.json` scripts
- **Test command**: look for `test` script in `package.json` scripts
- **Lint command**: look for `lint` script in `package.json` scripts (optional, skip if absent)

#### 2. Resolve Consumer App Locations

If the user did **not** provide `--apps`:
1. Check if `orchestration.config.json` exists with a `consumers` array. If so, use those paths.
2. Otherwise, scan sibling directories (`ls ../`) for projects whose `package.json` lists the library package name as a dependency or devDependency.
3. If no consumers are found automatically, **ask the user**: _"Which directories are consumer apps that depend on `<library-name>`?"_

For each consumer app, read its `package.json` to determine:
- **Package manager**: detect from lockfile (same logic as library)
- **Verify steps**: collect available scripts from `package.json` — look for `build`, `test`, `lint`. Only include steps that actually exist as scripts.
- **Dependency name**: the library's package name (from step 1)

#### 3. Explore & Clarify

- Read relevant source files in the library repo to understand the current state
- Ask the user clarification questions about what changes they want
- Understand the scope: is this a new feature, bug fix, API change, etc.?
- If the change is a breaking API change, note which consumers will likely need updates

#### 4. Implement Library Changes

Launch a subagent to work in the library repo:
```
Agent(subagent_type="general-purpose", prompt="
  Working directory: <library-path>
  Task: <description of changes>

  Make the requested changes. Run the build and tests to verify:
  - Build: <detected-build-command>
  - Test: <detected-test-command>

  Report back: what files changed, what the changes do, and whether build/tests pass.
")
```

#### 5. Publish to Local Verdaccio

Use default Verdaccio settings (port 4873, storage `/tmp/verdaccio-storage`) unless the user provided overrides.

```bash
bash scripts/verdaccio-start.sh [port]
node scripts/verdaccio-publish.mjs --library <library-path> [--port <port>]
cat .local-version
```

#### 6. Verify Each Consumer

For each consumer, launch subagents **in parallel**:
```
Agent(subagent_type="general-purpose", prompt="
  Working directory: <consumer-path>
  The library <library-name> has been updated and published locally.

  Run this command to update and verify:
  node <orchestration-repo>/scripts/consumer-update.mjs --consumer <consumer-path> --library-name <library-name> [--port <port>]

  The script will auto-detect the package manager and verify steps from package.json.

  If verification fails:
  1. Read the error output carefully
  2. Determine if the fix belongs in this consumer app
  3. If yes: make the fix, then re-run verification
  4. Report: PASSED or FAILED with details
")
```

#### 7. Collect Results

```bash
cat .results-*.json
```
Parse each consumer's results. If all passed, go to step 9.

#### 8. Iterate on Failures (max iterations, default 5)

For each failure:
- If the fix is in the **library**: go back to step 4
- If the fix is in a **consumer**: launch a subagent for that consumer
- After fixes, repeat from step 5 (re-publish and re-verify all consumers)

Track the iteration count. If max iterations is reached, stop and report.

#### 9. Final Report

Summarize to the user:
- **Library changes**: list of files modified and what changed
- **Consumer fixes**: any changes made to consumer apps (and which ones)
- **Verification results**: pass/fail for each consumer, each step
- **Iterations**: how many rounds it took

Then clean up:
```bash
bash scripts/verdaccio-stop.sh --clean
```

### Defaults

| Setting | Default | Override |
|---------|---------|---------|
| Verdaccio port | 4873 | `--verdaccio-port` |
| Verdaccio storage | `/tmp/verdaccio-storage` | — |
| Verdaccio URL | `http://localhost:<port>` | — |
| Max iterations | 5 | `--max-iterations` |
| Verify steps | auto-detected from `package.json` | — |
| Allow consumer fixes | true | — |

### Error Handling

- If Verdaccio fails to start: check if the port is in use, try killing stale processes
- If publish fails: check library build output for errors
- If a consumer install fails: check .npmrc conflicts or network issues
- If max iterations reached: present all failure details and ask user for guidance

### Important Rules

- Never modify consumer apps from the library subagent or vice versa
- Always re-publish after library changes (don't skip)
- Always re-verify ALL consumers after any change (library or consumer)
- Keep the user informed of progress at each phase
