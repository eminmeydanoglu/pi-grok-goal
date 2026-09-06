# pi-grok-goal

Production-oriented `/goal` orchestration for Pi, built on `nicobailon/pi-subagents`. The main session orchestrates. A fresh planner creates an immutable acceptance contract, one retained worker implements it, and three fresh read-only skeptics independently verify the workspace. A worker can submit only a completion candidate; unanimous structured verification is the sole completion authority.

## Install

Requirements: Linux, Bubblewrap (`bwrap`), Pi `>=0.85`, Node.js `>=22`, and a package-capable Pi installation. Background children require `@earendil-works/pi-server` and `@earendil-works/pi-client` beside the Pi npm package. On Debian/Ubuntu, install Bubblewrap with `sudo apt install bubblewrap`.

```bash
cd /path/to/pi-grok-goal
npm install
pi install .
```

Restart Pi and run `/subagents-doctor` once. Then ask Pi to run `verifier_sandbox_doctor`; it proves that Bubblewrap can create the required unprivileged namespace on this host. Installing `bwrap` alone is insufficient when the host disables unprivileged user namespaces.

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
- Planner, worker, verdict, and strategy results are schema-validated. A verifier distinguishes a substantive contract verdict from an `infrastructure` result; missing/malformed output and child/runtime errors become `infra-paused`, never success.
- The contract is canonicalized, SHA-256 digested, persisted with its digest, and verified on every resume. A missing or changed digest is corrupt state, not a new immutable baseline; only the work-plan HOW is mutable.
- A worker `continue` result persists progress and resumes the same retained worker without spending a verifier round. Only a `candidate` result starts the skeptic panel. A genuine external dependency can reach explicit `blocked` with a reason.
- Any substantive skeptic gap fails the round. Prior gaps are supplied to the next panel with anti-ratchet rules.
- Failure resumes the latest retained worker run. The runtime may allocate a new run id while preserving the identical child session file/session identity.
- The stable `workerRunId` identifies that retained worker; `workerResumeRunId` tracks the package's latest continuation handle. Worker commands run with only the workspace writable and `.git` mounted read-only.
- Recurring criterion families trigger a real fresh strategist. Continued recurrence after strategist budget becomes `no-progress`.
- Worker iterations, verification rounds, strategist calls, tokens, and transient child/provider retries are bounded; exhaustion becomes `budget-limited` and exhausted infrastructure retries become `infra-paused`.
- The decision core is one runtime-safe source embedded into the production workflow and exercised by TypeScript wrappers and deterministic workflow execution tests; there is no separately reimplemented production fingerprint, aggregation, contract, or stale-result logic.
- The package pins and guards `pi-subagents` `0.65.1` while its private mission persistence seam is necessary. All private imports and mission storage resolution live behind one compatibility adapter that respects the upstream mission-store configuration.
- Mission state persists the contract, work plan, worker id, attempts, verifier gaps and ids, fingerprint, strategies, budgets, and verified completion.

## Sandbox policy

`verify_command` executes without a shell in a Linux Bubblewrap namespace. It mounts the host filesystem read-only, provides an isolated writable `/tmp`, and has **no network access by default**. Verification that genuinely requires network access may opt in explicitly for that Pi process with:

```bash
PI_GOAL_VERIFIER_NETWORK=1 pi
```

This opt-in deliberately shares the host network namespace and should be used only for trusted repositories and a concrete verification need.

The verifier sandbox is an **integrity** boundary: it prevents the verifier from changing the workspace, Git metadata, or other host files. It is not a complete **confidentiality** boundary. The read-only `/` mount means a malicious repository instruction could potentially read files already readable by the Pi user. Keeping verifier networking disabled reduces exfiltration risk, but does not make arbitrary repository instructions safe. Do not run untrusted code or repositories under an account that can read secrets.

`worker_command` intentionally retains network access because normal implementation and dependency/test workflows may require it. It has a writable workspace and `/tmp`; Git metadata remains read-only.

## Verification

```bash
npm run check
npm run test:e2e-fixture
```

`npm run check` is the deterministic regression suite, including the production workflow integration harness; it makes no live model/provider calls. `npm run test:e2e-fixture` checks the checked-in fixture package only. The checked-in `e2e-fixture/` and `E2E_RESULTS.md` record development evidence from a real Pi coding smoke task, but are not a substitute for a live Pi run after changing runtime or provider behavior.

Unit and deterministic integration tests cover contract immutability, aggregation, semantic gap fingerprints, strategist/no-progress thresholds, budgets, stale-result tags, illegal transitions, retained-resume construction, completion gating, parallel skeptic construction, and fail-closed outcomes. For an actual live Pi/provider E2E, start from a disposable repository, run `/subagents-doctor` and `verifier_sandbox_doctor`, invoke `/goal`, and retain the resulting Mission/run IDs as evidence.

Budgets are configurable with `PI_GOAL_TOKEN_BUDGET`, `PI_GOAL_MAX_WORKER_ITERATIONS`, `PI_GOAL_MAX_VERIFICATION_ROUNDS`, `PI_GOAL_MAX_STRATEGISTS`, `PI_GOAL_STRATEGIST_THRESHOLD`, `PI_GOAL_INFRA_RETRIES`, and `PI_GOAL_WALL_CLOCK_MS`. `PI_GOAL_MODEL` optionally pins all child models; role overrides are `PI_GOAL_PLANNER_MODEL`, `PI_GOAL_WORKER_MODEL`, `PI_GOAL_SKEPTIC_MODEL`, and `PI_GOAL_STRATEGIST_MODEL`. Child ambient extensions are disabled to prevent loading this parent extension recursively; a required provider extension must be listed explicitly in comma-separated `PI_GOAL_CHILD_EXTENSIONS`. `PI_GOAL_VERIFIER_NETWORK=1` is the separate, explicit verifier-network opt-in described above.
