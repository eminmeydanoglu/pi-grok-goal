import assert from "node:assert/strict";
import test from "node:test";
import { assertContractUnchanged, contractDigest, validateContract } from "../src/contract.ts";
import { aggregatePanel, gapFingerprint, isCurrentResult } from "../src/verification.ts";
import { budgetState, transition } from "../src/state.ts";
import { DEFAULT_BUDGETS } from "../src/workflow.ts";
import type { GoalSnapshot, VerificationVerdict } from "../src/types.ts";

const contract = validateContract({objective:"Ship it",acceptanceCriteria:[{id:"AC1",requirement:"Works"}],constraints:[],nonGoals:[],verificationPlan:["npm test"]});
const pass: VerificationVerdict={achieved:true,gaps:[]};
const fail: VerificationVerdict={achieved:false,gaps:[{criterionId:"AC1",problem:"Required test does not pass"}]};
const result=(verdict:VerificationVerdict,runId:string)=>({kind:"verdict" as const,runId,verdict});

test("goal contract digest detects mutation",()=>{
  const digest=contractDigest(contract); assert.doesNotThrow(()=>assertContractUnchanged(contract,digest));
  const changed=structuredClone(contract); changed.acceptanceCriteria[0]!.requirement="Weakened";
  assert.throws(()=>assertContractUnchanged(changed,digest),/mutated/);
});
test("contract rejects malformed and duplicate criteria",()=>{
  assert.throws(()=>validateContract({objective:"x",acceptanceCriteria:[],constraints:[],nonGoals:[],verificationPlan:[]}));
  assert.throws(()=>validateContract({objective:"x",acceptanceCriteria:[{id:"A",requirement:"x"},{id:"A",requirement:"y"}],constraints:[],nonGoals:[],verificationPlan:[]}));
});
test("unanimous panel passes",()=>assert.equal(aggregatePanel([result(pass,"1"),result(pass,"2"),result(pass,"3")]).outcome,"pass"));
test("one substantive skeptic failure fails panel",()=>assert.equal(aggregatePanel([result(pass,"1"),result(pass,"2"),result(fail,"3")]).outcome,"fail"));
test("malformed/crashed panel is infrastructure failure, never pass",()=>assert.equal(aggregatePanel([result(pass,"1"),result(pass,"2"),{kind:"infrastructure",error:"invalid output"}]).outcome,"infra"));
test("same semantic gap fingerprints identically",()=>{
  assert.equal(gapFingerprint([{criterionId:"ac1",problem:"The required TEST does not pass."}]),gapFingerprint([{criterionId:"AC1",problem:"Required test does not pass"}]));
});
test("stale result requires exact goal, generation, and attempt",()=>{
  const current={goalId:"g",generation:2,verificationAttempt:3};
  assert.equal(isCurrentResult(current,{...current}),true);
  assert.equal(isCurrentResult(current,{...current,generation:1}),false);
  assert.equal(isCurrentResult(current,{...current,verificationAttempt:2}),false);
});

function snapshot(status:GoalSnapshot["status"]="working"):GoalSnapshot{return {version:1,goalId:"g",generation:1,objective:"x",status,workPlan:[],workerIteration:0,verificationAttempt:0,verifierRunIds:[],priorVerificationGaps:[],sameGapCount:0,strategistCount:0,budgets:DEFAULT_BUDGETS,updatedAt:new Date(0).toISOString()}}
test("state machine blocks illegal completion from worker",()=>assert.throws(()=>transition(snapshot("working"),"complete"),/Illegal/));
test("verification may complete and terminal state cannot reopen",()=>{
  assert.equal(transition(snapshot("verifying"),"complete").status,"complete");
  assert.throws(()=>transition(snapshot("complete"),"working"));
});
test("budget exhaustion is distinct from completion",()=>{
  const s=snapshot(); s.workerIteration=s.budgets.maxWorkerIterations;
  assert.equal(budgetState(s),"worker"); assert.notEqual(s.status,"complete");
});
test("strategist trigger budget and no-progress bound",()=>{
  const s=snapshot(); s.sameGapCount=s.budgets.strategistThreshold; s.strategistCount=s.budgets.maxStrategistInvocations;
  assert.equal(budgetState(s),"strategist");
});
