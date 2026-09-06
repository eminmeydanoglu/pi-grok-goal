import type { GoalSnapshot, GoalStatus } from "./types.ts";
import { goalCore } from "./runtime-core.ts";

export function canTransition(from: GoalStatus, to: GoalStatus): boolean { return goalCore.canTransition(from, to); }
export function transition(snapshot: GoalSnapshot, status: GoalStatus, reason?: string): GoalSnapshot {
  if (!canTransition(snapshot.status, status)) throw new Error(`Illegal goal transition: ${snapshot.status} -> ${status}`);
  return { ...snapshot, status, ...(reason ? { pauseReason: reason } : {}), updatedAt: new Date().toISOString() };
}
export function budgetState(s: GoalSnapshot): "ok" | "worker" | "verification" | "strategist" {
  if (s.workerIteration >= s.budgets.maxWorkerIterations) return "worker";
  if (s.verificationAttempt >= s.budgets.maxVerificationRounds) return "verification";
  if (s.strategistCount >= s.budgets.maxStrategistInvocations && s.sameGapCount >= s.budgets.strategistThreshold) return "strategist";
  return "ok";
}
