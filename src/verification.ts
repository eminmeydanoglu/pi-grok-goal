import type { Gap, PanelAggregate, PanelResult, TaggedResult, VerificationResult, WorkerDisposition } from "./types.ts";
import { goalCore } from "./runtime-core.ts";

export type { PanelAggregate, PanelResult } from "./types.ts";
export const validateVerificationResult = (value: unknown): VerificationResult => goalCore.validateVerificationResult(value);
export const aggregatePanel = (results: readonly PanelResult[]): PanelAggregate => goalCore.aggregatePanel(results);
export const normalizeProblem = (problem: string): string => goalCore.normalizeProblem(problem);
export const gapFingerprint = (gaps: readonly Gap[]): string => goalCore.gapFingerprint(gaps);
export const isCurrentResult = (current: TaggedResult, incoming: TaggedResult): boolean => goalCore.isCurrentResult(current, incoming);
/** Resolve the explicit worker control outcome, including legacy completed-only claims. */
export const workerDisposition = (claim: unknown): WorkerDisposition => goalCore.workerDisposition(claim);
