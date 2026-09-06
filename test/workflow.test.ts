import assert from "node:assert/strict";
import test from "node:test";
import { buildGoalWorkflow, DEFAULT_BUDGETS } from "../src/workflow.ts";

const contract={objective:"Implement feature",acceptanceCriteria:[{id:"C1",requirement:"Feature works"}],constraints:[],nonGoals:[],verificationPlan:["Run test"]};
const worker=(outcome:"continue"|"candidate"|"blocked",summary=outcome)=>({outcome,completed:outcome==="candidate",...(outcome==="blocked"?{blockedReason:"Needs user input"}:{}),summary,claimedCriteria:[],evidence:[],workPlan:["work"]});
const pass={kind:"verdict",achieved:true,gaps:[]};
const fail=(problem="Feature is missing")=>({kind:"verdict",achieved:false,gaps:[{criterionId:"C1",problem}]});

interface Call { method:"run"|"all"; key?:string; input?:Record<string,unknown> }
function fakeRuntime(options:{workers:ReturnType<typeof worker>[];panels?:unknown[][];initialState?:unknown;failPlannerAttempts?:number;failPanelAttempts?:number}) {
 let snapshot=options.initialState; const calls:Call[]=[]; let nextId=0; let plannerFailures=options.failPlannerAttempts??0; let panelFailures=options.failPanelAttempts??0;
 const workers=[...options.workers],panels=[...(options.panels??[])];
 const runs={
  async run(key:string,input:Record<string,unknown>){
   calls.push({method:"run",key,input});
   if(key.startsWith("planner-")){if(plannerFailures-->0)return {ok:false,runId:`planner-failed-${++nextId}`};return {ok:true,runId:`planner-${++nextId}`,structuredOutput:{contract,workPlan:["work"]}};}
   if(key.startsWith("worker-")){const structuredOutput=workers.shift();if(!structuredOutput)throw new Error("No fake worker result");return {ok:true,runId:`worker-${++nextId}`,structuredOutput};}
   if(key.startsWith("strategist-"))return {ok:true,runId:`strategist-${++nextId}`,structuredOutput:{diagnosis:"repeat",recommendedStrategy:"change",avoidRepeating:["same"]}};
   throw new Error(`Unexpected run ${key}`);
  },
  async all(inputs:Record<string,unknown>[]){calls.push({method:"all",input:{inputs}});if(panelFailures-->0)return [{ok:false,runId:`skeptic-failed-${++nextId}`}];const panel=panels.shift();if(!panel)throw new Error("No fake skeptic panel");return panel.map((structuredOutput,index)=>({ok:true,runId:`skeptic-${++nextId}-${index}`,structuredOutput}));},
 };
 return {calls,state:{get:async()=>snapshot,set:async(_key:string,value:unknown)=>{snapshot=structuredClone(value);}},runs,snapshot:()=>snapshot as Record<string,any>};
}
async function execute(runtime:ReturnType<typeof fakeRuntime>,overrides:Partial<Parameters<typeof buildGoalWorkflow>[0]>={}) {
 const budgets={...DEFAULT_BUDGETS,maxWorkerIterations:4,maxVerificationRounds:4,strategistThreshold:2,maxStrategistInvocations:1,...overrides.budgets};
 const source=buildGoalWorkflow({goalId:"goal-1",generation:4,objective:"Implement feature",budgets,...overrides});
 return Function("state","runs",`return (async()=>{${source}})();`)(runtime.state,runtime.runs);
}

test("actual workflow: generated source avoids nested async functions required by pi-subagents",()=>{
 const source=buildGoalWorkflow({goalId:"goal-1",generation:4,objective:"Implement feature",budgets:DEFAULT_BUDGETS});
 assert.doesNotMatch(source,/\basync\s*(?:function|\()/);
 assert.doesNotMatch(source,/\basync\s+[A-Za-z_$][\w$]*\s*=>/);
});

test("actual workflow: completed=false resumes retained worker without skeptics",async()=>{
 const runtime=fakeRuntime({workers:[worker("continue"),worker("candidate")],panels:[[pass,pass,pass]]}); const result=await execute(runtime);
 assert.equal(result.outcome,"complete"); assert.equal(runtime.calls.filter(c=>c.method==="all").length,1);
 const calls=runtime.calls.filter(c=>c.key?.startsWith("worker-")); assert.equal(calls.length,2); const [firstWorker,secondWorker]=calls; assert.ok(firstWorker&&secondWorker); assert.equal("resume" in (firstWorker.input??{}),false); assert.equal(secondWorker.input?.resume,"worker-2"); assert.equal(runtime.snapshot().verificationAttempt,1);
});
test("actual workflow: failed panel resumes retained worker and cannot self-certify",async()=>{
 const runtime=fakeRuntime({workers:[worker("candidate"),worker("candidate")],panels:[[pass,pass,fail()],[pass,pass,pass]]}); const result=await execute(runtime);
 assert.equal(result.outcome,"complete");assert.equal(runtime.calls.filter(c=>c.method==="all").length,2);const calls=runtime.calls.filter(c=>c.key?.startsWith("worker-"));const secondWorker=calls[1];assert.ok(secondWorker);assert.equal(secondWorker.input?.resume,"worker-2");
});
test("actual workflow: recurring gap invokes strategist",async()=>{
 const panel=[fail("Missing implementation"),fail("Missing implementation"),fail("Missing implementation")];const runtime=fakeRuntime({workers:[worker("candidate"),worker("candidate"),worker("candidate")],panels:[panel,panel,[pass,pass,pass]]});const result=await execute(runtime);
 assert.equal(result.outcome,"complete");assert.equal(runtime.calls.filter(c=>c.key?.startsWith("strategist-")).length,1);assert.equal(runtime.snapshot().strategistCount,1);
});
test("actual workflow: verifier infrastructure pauses, rather than becoming a worker gap",async()=>{
 const runtime=fakeRuntime({workers:[worker("candidate")],panels:[[pass,{kind:"infrastructure",reason:"bwrap unavailable"},pass]]});const result=await execute(runtime);
 assert.equal(result.outcome,"infra-paused");assert.equal(runtime.snapshot().status,"infra-paused");assert.equal(runtime.snapshot().priorVerificationGaps.length,0);
});
test("actual workflow: transient child failures honour infraRetries",async()=>{
 const runtime=fakeRuntime({failPlannerAttempts:1,workers:[worker("candidate")],panels:[[pass,pass,pass]]});const result=await execute(runtime);
 assert.equal(result.outcome,"complete");assert.equal(runtime.calls.filter(c=>c.key?.startsWith("planner-")).length,2);
});
test("actual workflow: transient verifier child failure retries the whole fresh panel",async()=>{
 const runtime=fakeRuntime({failPanelAttempts:1,workers:[worker("candidate")],panels:[[pass,pass,pass]]});const result=await execute(runtime);
 assert.equal(result.outcome,"complete");assert.equal(runtime.calls.filter(c=>c.method==="all").length,2);
});
test("actual workflow: corrupt digest fails closed and stale generation is ignored",async()=>{
 const corrupt={version:1,goalId:"goal-1",generation:4,objective:"Implement feature",status:"working",contract,contractDigest:"0".repeat(64),workPlan:["work"],workerIteration:0,verificationAttempt:0,verifierRunIds:[],priorVerificationGaps:[],sameGapCount:0,strategistCount:0,budgets:DEFAULT_BUDGETS,updatedAt:new Date().toISOString()};
 const runtime=fakeRuntime({initialState:corrupt,workers:[]});const result=await execute(runtime);assert.equal(result.outcome,"infra-paused");assert.match(String(runtime.snapshot().pauseReason),/Immutable GoalContract/);
 const stale=fakeRuntime({initialState:{...corrupt,generation:5,status:"cancelled"},workers:[]});assert.equal((await execute(stale)).outcome,"stale-ignored");
});
test("actual workflow: blocked worker is terminal and role models stay role-scoped",async()=>{
 const runtime=fakeRuntime({workers:[worker("blocked")],panels:[]});const result=await execute(runtime,{roleModels:{planner:"plan-model",worker:"work-model",skeptic:"verify-model",strategist:"strategy-model"}});
 assert.equal(result.outcome,"blocked");assert.equal(runtime.snapshot().status,"blocked");assert.equal(runtime.calls.filter(c=>c.method==="all").length,0);assert.equal(runtime.calls.find(c=>c.key?.startsWith("planner-"))?.input?.model,"plan-model");assert.equal(runtime.calls.find(c=>c.key?.startsWith("worker-"))?.input?.model,"work-model");
});
test("actual workflow: an already terminal generation is never reopened",async()=>{
 const runtime=fakeRuntime({initialState:{version:1,goalId:"goal-1",generation:4,status:"complete",verificationAttempt:1},workers:[]});
 const result=await execute(runtime);
 assert.equal(result.outcome,"stale-ignored");
 assert.equal(runtime.calls.length,0);
});
