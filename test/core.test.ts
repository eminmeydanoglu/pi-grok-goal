import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { assertContractUnchanged, canonicalContract, contractDigest, validateContract } from "../src/contract.ts";
import { GOAL_CORE_RUNTIME_SOURCE } from "../src/runtime-core.ts";
import { aggregatePanel, gapFingerprint, isCurrentResult, validateVerificationResult, workerDisposition } from "../src/verification.ts";
import { budgetState, transition } from "../src/state.ts";
import { DEFAULT_BUDGETS } from "../src/workflow.ts";
import type { GoalSnapshot, VerificationVerdict } from "../src/types.ts";

const contract = validateContract({objective:"Ship it",acceptanceCriteria:[{id:"AC1",requirement:"Works"}],constraints:[],nonGoals:[],verificationPlan:["npm test"]});
const pass: VerificationVerdict={kind:"verdict",achieved:true,gaps:[]};
const fail: VerificationVerdict={kind:"verdict",achieved:false,gaps:[{criterionId:"AC1",problem:"Required test does not pass"}]};
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
test("contract digest is canonical, SHA-256, and detects persisted tampering",()=>{
  const reordered={...contract,constraints:["one","two"]};
  const reorderedKeys={verificationPlan:reordered.verificationPlan,nonGoals:reordered.nonGoals,constraints:reordered.constraints,acceptanceCriteria:reordered.acceptanceCriteria,objective:reordered.objective};
  assert.equal(canonicalContract(reordered),canonicalContract(reorderedKeys));
  assert.match(contractDigest(contract),/^[a-f0-9]{64}$/);
  assert.equal(contractDigest(contract),createHash("sha256").update(canonicalContract(contract)).digest("hex"));
  assert.throws(()=>assertContractUnchanged(contract,"x".repeat(64)),/mutated|digest/);
  assert.throws(()=>validateContract({...contract,extra:true}),/Malformed/);
  assert.throws(()=>validateContract({...contract,constraints:[42]}),/array of strings/);
  assert.throws(()=>validateContract({...contract,acceptanceCriteria:[{id:"AC1",requirement:"Works",surprise:true}]}),/Malformed acceptance/);
});
test("embedded core computes UTF-8 SHA-256 when the workflow VM has no TextEncoder",()=>{
  const core=runInNewContext(`${GOAL_CORE_RUNTIME_SOURCE};goalCore`,{TextEncoder:undefined}) as { contractDigest(value:typeof contract):string; canonical(value:typeof contract):string };
  const unicode=validateContract({...contract,objective:"Çarpım 🔒"});
  assert.equal(core.contractDigest(unicode),createHash("sha256").update(core.canonical(unicode)).digest("hex"));
});
test("unanimous panel passes",()=>assert.equal(aggregatePanel([result(pass,"1"),result(pass,"2"),result(pass,"3")]).outcome,"pass"));
test("one substantive skeptic failure fails panel",()=>assert.equal(aggregatePanel([result(pass,"1"),result(pass,"2"),result(fail,"3")]).outcome,"fail"));
test("malformed/crashed panel is infrastructure failure, never pass",()=>assert.equal(aggregatePanel([result(pass,"1"),result(pass,"2"),{kind:"infrastructure",error:"invalid output"}]).outcome,"infra"));
test("verifier result discriminates infrastructure from a substantive failure",()=>{
  assert.deepEqual(validateVerificationResult({kind:"infrastructure",reason:"bwrap unavailable"}),{kind:"infrastructure",reason:"bwrap unavailable"});
  assert.deepEqual(validateVerificationResult({kind:"verdict",achieved:false,gaps:[{problem:"test fails"}]}),{kind:"verdict",achieved:false,gaps:[{problem:"test fails"}]});
  assert.throws(()=>validateVerificationResult({kind:"verdict",achieved:true,gaps:[{problem:"contradiction"}]}),/cannot contain gaps/);
  assert.throws(()=>validateVerificationResult({kind:"infrastructure",reason:""}),/Malformed/);
  assert.throws(()=>validateVerificationResult({kind:"verdict",achieved:false,gaps:[],extra:true}),/Malformed/);
});
test("explicit and legacy worker outcomes have safe continuation semantics",()=>{
  assert.equal(workerDisposition({completed:false}),"continue");
  assert.equal(workerDisposition({completed:true}),"candidate");
  assert.equal(workerDisposition({outcome:"continue",completed:false}),"continue");
  assert.equal(workerDisposition({outcome:"candidate",completed:true}),"candidate");
  assert.equal(workerDisposition({outcome:"blocked",completed:false,blockedReason:"Need user credential"}),"blocked");
  assert.throws(()=>workerDisposition({outcome:"candidate",completed:false}),/disagree/);
  assert.throws(()=>workerDisposition({outcome:"blocked",completed:false}),/blockedReason/);
});
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
test("worker may reach blocked and only an explicit resume reopens it",()=>{
  assert.equal(transition(snapshot("working"),"blocked","Waiting for user input").status,"blocked");
  assert.equal(transition(snapshot("blocked"),"working").status,"working");
  assert.throws(()=>transition(snapshot("planning"),"blocked"),/Illegal/);
});
test("budget exhaustion is distinct from completion",()=>{
  const s=snapshot(); s.workerIteration=s.budgets.maxWorkerIterations;
  assert.equal(budgetState(s),"worker"); assert.notEqual(s.status,"complete");
});
test("strategist trigger budget and no-progress bound",()=>{
  const s=snapshot(); s.sameGapCount=s.budgets.strategistThreshold; s.strategistCount=s.budgets.maxStrategistInvocations;
  assert.equal(budgetState(s),"strategist");
});
