# Full Orchestration Workflow

## Skill: /orchestrate

Run the complete library-update-and-verify orchestration loop.

### When Invoked

The user wants to make a change to the component library and verify it works across all consumer apps.

### Step-by-Step Procedure

#### 1. Load Configuration
```bash
cat orchestration.config.json
```
Read the config to know:
- Library path and commands
- Consumer app names, paths, and commands
- Max iteration count
- Verification steps

#### 2. Explore & Clarify
- Read relevant source files in the library repo to understand the current state
- Ask the user clarification questions about what changes they want
- Understand the scope: is this a new feature, bug fix, API change, etc.?
- If the change is a breaking API change, note which consumers will likely need updates

#### 3. Implement Library Changes
Launch a subagent to work in the library repo:
```
Agent(subagent_type="general-purpose", prompt="
  Working directory: <library-path>
  Task: <description of changes>

  Make the requested changes. Run the build and tests to verify:
  - Build: <buildCommand>
  - Test: <testCommand>

  Report back: what files changed, what the changes do, and whether build/tests pass.
")
```

#### 4. Publish to Local Verdaccio
```bash
bash scripts/verdaccio-start.sh
node scripts/verdaccio-publish.mjs
cat .local-version
```

#### 5. Verify Each Consumer
For each consumer defined in config, launch subagents **in parallel**:
```
Agent(subagent_type="general-purpose", prompt="
  Working directory: <consumer-path>
  The library @myorg/components has been updated and published locally.

  Run this command to update and verify:
  node <orchestration-repo>/scripts/consumer-update.mjs <consumer-name>

  If verification fails:
  1. Read the error output carefully
  2. Determine if the fix belongs in this consumer app
  3. If yes: make the fix, then re-run verification
  4. Report: PASSED or FAILED with details
")
```

#### 6. Collect Results
```bash
cat .results-*.json
```
Parse each consumer's results. If all passed, go to step 8.

#### 7. Iterate on Failures (max iterations from config)
For each failure:
- If the fix is in the **library**: go back to step 3
- If the fix is in a **consumer**: launch a subagent for that consumer
- After fixes, repeat from step 4 (re-publish and re-verify all consumers)

Track the iteration count. If `maxIterations` is reached, stop and report.

#### 8. Final Report
Summarize to the user:
- **Library changes**: list of files modified and what changed
- **Consumer fixes**: any changes made to consumer apps (and which ones)
- **Verification results**: pass/fail for each consumer, each step
- **Iterations**: how many rounds it took

Then clean up:
```bash
bash scripts/verdaccio-stop.sh --clean
```

### Error Handling
- If Verdaccio fails to start: check if port 4873 is in use, try killing stale processes
- If publish fails: check library build output for errors
- If a consumer install fails: check .npmrc conflicts or network issues
- If max iterations reached: present all failure details and ask user for guidance

### Important Rules
- Never modify consumer apps from the library subagent or vice versa
- Always re-publish after library changes (don't skip)
- Always re-verify ALL consumers after any change (library or consumer)
- Keep the user informed of progress at each phase
