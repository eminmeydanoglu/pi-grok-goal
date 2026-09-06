# Real Pi E2E evidence

Recorded on 2026-09-06 with Pi 0.85.1 and `pi-subagents` 0.65.1. UUIDs below are persisted runtime run identifiers, not mocks.

| Scenario | Result | Evidence |
|---|---|---|
| Normal success | PASS | Final workflow goal `249f070d-50a3-48dc-8a34-55aff2a323bb` completed after worker `3f67e5f1-6b78-477e-b69b-8a7df6eb5ca0` and skeptics `2b78304d-6d25-4fbd-99b1-76b72c7865b1`, `567f34e5-bdbd-40ba-b27b-97a30d700e80`, and `018bc080-2729-41b5-a178-742a7a382772`. |
| False completion | PASS | Workflow `0346fd01…`: candidate was rejected for packaging/Git gaps; gaps persisted and the retained worker resumed. |
| Same worker resume | PASS | Initial and resumed runs used the same persisted child `session.jsonl`; continuation run handles changed while retained session identity did not. |
| Verifier isolation | PASS | Distinct skeptic runs used only `read`, `find`/`ls`, `verify_command`, and `structured_output`; no worker transcript, shell, edit, or write tools. |
| Three-skeptic panel | PASS | Run `24b8c0b9…` used skeptic IDs `76345175…`, `ae3ab692…`, `21c80a51…`, launched in one `runs.all` batch. |
| Strategist | PASS | Workflow `cfc50298-8780-460c-8631-3a3b9f3a346e` invoked a fresh `goal-strategist` after repeated gaps and persisted its structured strategy. |
| No progress | PASS | The same workflow stopped at iteration/verification 3 with `no-progress`, `sameGapCount=3`, `strategistCount=1`. |
| Verifier/provider failure | PASS | A real provider quota failure and unavailable structured verifier output produced `infra-paused`, never completion. |
| Pause/resume | PASS | Active mission was paused, Pi restarted, and the same persisted contract/worker continuation was resumed. |
| Cancel/clear race | PASS | Clear was issued while three skeptics were active; package stop removed children. A discovered stop-before-state race was fixed by advancing durable generation before cancellation. |
| Restart persistence | PASS | A paused multiply goal was restored after a real Pi process restart and completed as workflow `3a74602e…`. |
| Real coding task | PASS | `e2e-fixture` gained subtract and multiply behavior/tests through real goal workflows; all seven tests pass. |

Additional destructive probes found and fixed: verifier filesystem mutation is rejected by Bubblewrap; worker commands now mount `.git` read-only after a hostile goal induced an attempted fake loose object. The exact corrupt test artifact was removed and `git fsck` passed.
