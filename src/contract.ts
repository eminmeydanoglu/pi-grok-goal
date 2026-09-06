import { createHash } from "node:crypto";
import type { GoalContract } from "./types.ts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function validateContract(value: unknown): GoalContract {
  if (!value || typeof value !== "object") throw new Error("Planner did not return a GoalContract");
  const c = value as GoalContract;
  if (!c.objective?.trim()) throw new Error("GoalContract objective is empty");
  if (!Array.isArray(c.acceptanceCriteria) || c.acceptanceCriteria.length === 0) throw new Error("GoalContract requires acceptance criteria");
  const ids = new Set<string>();
  for (const criterion of c.acceptanceCriteria) {
    if (!criterion.id?.trim() || !criterion.requirement?.trim()) throw new Error("Malformed acceptance criterion");
    if (ids.has(criterion.id)) throw new Error(`Duplicate criterion id: ${criterion.id}`);
    ids.add(criterion.id);
  }
  for (const field of ["constraints", "nonGoals", "verificationPlan"] as const) if (!Array.isArray(c[field])) throw new Error(`GoalContract ${field} must be an array`);
  return structuredClone(c);
}

export function contractDigest(contract: GoalContract): string {
  return createHash("sha256").update(canonical(contract)).digest("hex");
}

export function assertContractUnchanged(contract: GoalContract, digest: string): void {
  if (contractDigest(contract) !== digest) throw new Error("Immutable GoalContract was mutated");
}
