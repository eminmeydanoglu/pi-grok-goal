# pi-grok-goal

Production-oriented `/goal` orchestration for Pi, built on `nicobailon/pi-subagents`. The main session orchestrates. A fresh planner creates an immutable acceptance contract, one retained worker implements it, and three fresh read-only skeptics independently verify the workspace. A worker can submit only a completion candidate; unanimous structured verification is the sole completion authority.

## Install

Requirements: Pi `>=0.85`, Node.js `>=22`, and a package-capable Pi installation. Background children require `@earendil-works/pi-server` and `@earendil-works/pi-client` beside the Pi npm package.

```bash
cd /path/to/pi-grok-goal
npm install
pi install .
```

Restart Pi and run `/subagents-doctor` once.

## Usage

```text
/goal Implement the requested feature, tests, and documentation
/goal status
/goal pause
/goal resume
/goal clear
```

Pause stops the package-owned workflow and persists `paused`. Resume attaches to the same Mission, loads durable state, and resumes the retained worker session. Clear stops active children, advances the generation, and persists `cancelled`, invalidating late results.

## Architecture and reliability

- Execution uses `pi-subagents` `workflowScript`, Goal Mission state, `runs.run`, `runs.all`, structured outputs, and retained `resume`; there is no second scheduler or persistence engine.
- Planner, skeptics, and strategist use fresh context. Skeptics launch as a three-item parallel batch with distinct run/session identities and no worker transcript.
- Planner, worker, verdict, and strategy results are schema-validated. Missing/malformed output and child/runtime errors become `infra-paused`, never success.
- The contract is serialized once and checked before review; only the work-plan HOW is mutable.
- Any substantive skeptic gap fails the round. Prior gaps are supplied to the next panel with anti-ratchet rules.
- Failure resumes the latest retained worker run. The runtime may allocate a new run id while preserving the identical child session file/session identity.
- The stable `workerRunId` identifies that retained worker; `workerResumeRunId` tracks the package's latest continuation handle. Worker commands run with only the workspace writable and `.git` mounted read-only.
- Recurring criterion families trigger a real fresh strategist. Continued recurrence after strategist budget becomes `no-progress`.
- Worker iterations, verification rounds, strategist calls, and tokens are bounded; exhaustion becomes `budget-limited`.
- Mission state persists the contract, work plan, worker id, attempts, verifier gaps and ids, fingerprint, strategies, budgets, and verified completion.

## Verification

```bash
npm run check
npm run test:e2e-fixture
```

The checked-in `e2e-fixture/` records the real coding smoke task used during development. Unit tests cover contract immutability, deterministic aggregation, semantic gap fingerprints, strategist/no-progress thresholds, budgets, stale-result tags, illegal transitions, retained-resume construction, parallel skeptic construction, and fail-closed outcomes.

Budgets are configurable with `PI_GOAL_TOKEN_BUDGET`, `PI_GOAL_MAX_WORKER_ITERATIONS`, `PI_GOAL_MAX_VERIFICATION_ROUNDS`, `PI_GOAL_MAX_STRATEGISTS`, `PI_GOAL_STRATEGIST_THRESHOLD`, `PI_GOAL_INFRA_RETRIES`, and `PI_GOAL_WALL_CLOCK_MS`. `PI_GOAL_MODEL` optionally pins the child model; otherwise the active Pi model is inherited.
