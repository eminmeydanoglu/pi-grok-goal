export const GOAL_STATUSES = [
  "planning", "working", "verifying", "strategizing", "paused", "no-progress",
  "blocked", "budget-limited", "infra-paused", "complete", "cancelled",
] as const;
export type GoalStatus = typeof GOAL_STATUSES[number];

export interface AcceptanceCriterion { id: string; requirement: string; verification?: string }
export interface GoalContract {
  objective: string;
  acceptanceCriteria: AcceptanceCriterion[];
  constraints: string[];
  nonGoals: string[];
  verificationPlan: string[];
}
export interface Evidence { kind: "command" | "file" | "behavior" | "note"; description: string; value?: string }
export interface WorkerClaim {
  completed: boolean; summary: string; claimedCriteria: string[]; evidence: Evidence[]; workPlan: string[];
}
export interface Gap { criterionId?: string; problem: string; evidence?: string }
export interface VerificationVerdict { achieved: boolean; gaps: Gap[]; notes?: string[] }
export interface Strategy { diagnosis: string; recommendedStrategy: string; avoidRepeating: string[] }
export interface GoalBudgets {
  tokenBudget: number; maxWorkerIterations: number; maxVerificationRounds: number;
  maxStrategistInvocations: number; strategistThreshold: number; infraRetries: number;
}
export interface GoalSnapshot {
  version: 1; goalId: string; generation: number; objective: string; status: GoalStatus;
  contract?: GoalContract; contractDigest?: string; workPlan: string[]; workerRunId?: string;
  workerIteration: number; verificationAttempt: number; verifierRunIds: string[];
  priorVerificationGaps: Gap[]; gapFingerprint?: string; sameGapCount: number;
  strategistCount: number; strategy?: Strategy; budgets: GoalBudgets;
  completionResult?: { independentlyVerified: true; at: string; verdicts: VerificationVerdict[] };
  pauseReason?: string; activeAsyncRunId?: string; updatedAt: string;
}
export interface TaggedResult { goalId: string; generation: number; verificationAttempt: number }
