import type { GoalSnapshot, GoalStatus } from "./types.ts";

const ALLOWED: Record<GoalStatus, readonly GoalStatus[]> = {
  planning: ["working", "infra-paused", "budget-limited", "paused", "cancelled"],
  working: ["verifying", "strategizing", "no-progress", "infra-paused", "budget-limited", "paused", "cancelled"],
  verifying: ["complete", "working", "strategizing", "infra-paused", "budget-limited", "paused", "cancelled"],
  strategizing: ["working", "no-progress", "infra-paused", "budget-limited", "paused", "cancelled"],
  paused: ["planning", "working", "verifying", "strategizing", "no-progress", "cancelled"],
  "no-progress": ["working", "strategizing", "paused", "cancelled"],
  blocked: ["working", "paused", "cancelled"],
  "budget-limited": ["working", "paused", "cancelled"],
  "infra-paused": ["planning", "working", "verifying", "strategizing", "paused", "cancelled"],
  complete: [], cancelled: [],
};
export function transition(snapshot: GoalSnapshot, status: GoalStatus, reason?: string): GoalSnapshot {
  if (!ALLOWED[snapshot.status].includes(status)) throw new Error(`Illegal goal transition: ${snapshot.status} -> ${status}`);
  return { ...snapshot, status, ...(reason ? { pauseReason: reason } : {}), updatedAt: new Date().toISOString() };
}
export function budgetState(s: GoalSnapshot): "ok" | "worker" | "verification" | "strategist" {
  if (s.workerIteration >= s.budgets.maxWorkerIterations) return "worker";
  if (s.verificationAttempt >= s.budgets.maxVerificationRounds) return "verification";
  if (s.strategistCount >= s.budgets.maxStrategistInvocations && s.sameGapCount >= s.budgets.strategistThreshold) return "strategist";
  return "ok";
}
