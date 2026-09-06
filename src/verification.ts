import type { Gap, TaggedResult, VerificationVerdict } from "./types.ts";

export type PanelResult =
  | { kind: "verdict"; runId: string; verdict: VerificationVerdict }
  | { kind: "infrastructure"; runId?: string; error: string };

export function aggregatePanel(results: PanelResult[]): { outcome: "pass" | "fail" | "infra"; gaps: Gap[]; verdicts: VerificationVerdict[] } {
  if (results.length !== 3 || results.some((r) => r.kind === "infrastructure")) return { outcome: "infra", gaps: [], verdicts: results.flatMap((r) => r.kind === "verdict" ? [r.verdict] : []) };
  const verdicts = results.map((r) => (r as Extract<PanelResult, {kind: "verdict"}>).verdict);
  const gaps = verdicts.flatMap((v) => v.gaps);
  return verdicts.every((v) => v.achieved && v.gaps.length === 0)
    ? { outcome: "pass", gaps: [], verdicts }
    : { outcome: "fail", gaps, verdicts };
}

const STOP_WORDS = new Set(["a", "an", "the", "is", "are", "to", "of", "and", "or", "bir", "bu", "ve", "ile", "icin", "için"]);
export function normalizeProblem(problem: string): string {
  return problem.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((w) => w && !STOP_WORDS.has(w)).sort().slice(0, 12).join("-");
}
export function gapFingerprint(gaps: Gap[]): string {
  return [...new Set(gaps.map((g) => `${g.criterionId?.trim().toUpperCase() || "OBJECTIVE"}:${normalizeProblem(g.problem)}`))].sort().join("|");
}
export function isCurrentResult(current: TaggedResult, incoming: TaggedResult): boolean {
  return current.goalId === incoming.goalId && current.generation === incoming.generation && current.verificationAttempt === incoming.verificationAttempt;
}
