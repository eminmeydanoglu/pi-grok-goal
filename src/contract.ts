import type { GoalContract } from "./types.ts";
import { goalCore } from "./runtime-core.ts";

/** Canonical form used for every persisted immutable-contract digest. */
export const canonicalContract = (value: unknown): string => goalCore.canonical(value);
export const validateContract = (value: unknown): GoalContract => goalCore.validateContract(value);
export const contractDigest = (contract: GoalContract): string => goalCore.contractDigest(contract);
export const assertContractUnchanged = (contract: GoalContract, digest: string): void => goalCore.assertContractUnchanged(contract, digest);
