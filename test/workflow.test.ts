import assert from "node:assert/strict";
import test from "node:test";
import { buildGoalWorkflow, DEFAULT_BUDGETS } from "../src/workflow.ts";

const script=buildGoalWorkflow({goalId:"goal-1",generation:4,objective:"Implement feature",budgets:DEFAULT_BUDGETS});
test("workflow uses mission state and fresh planner",()=>{assert.match(script,/state\.get\("goal"\)/);assert.match(script,/agent:"goal-planner",context:"fresh"/)});
test("worker is retained and resumed from latest run id",()=>{assert.match(script,/workerRunId=worker\.runId/);assert.match(script,/resume:workerRunId/)});
test("three fresh skeptics launch as one parallel batch",()=>{assert.match(script,/runs\.all\(\[0,1,2\]/);assert.match(script,/agent:"goal-skeptic",context:"fresh"/)});
test("only unanimous verification reaches complete",()=>{assert.match(script,/verdicts\.every\(v=>v\.achieved&&v\.gaps\.length===0\)/);assert.match(script,/independentlyVerified:true/)});
test("strategist is actually invoked and no-progress is terminal outcome",()=>{assert.match(script,/runs\.run\("strategist-"/);assert.match(script,/outcome:"no-progress"/)});
test("infra and budgets fail closed",()=>{assert.match(script,/outcome:"infra-paused"/);assert.match(script,/outcome:"budget-limited"/)});
test("generation and verification tags are passed to verifiers",()=>{assert.match(script,/GOAL TAG/);assert.match(script,/verificationAttempt/)});
