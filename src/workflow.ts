import { plannerSchema, strategySchema, verdictSchema, workerSchema } from "./schemas.ts";
import { PLANNER_PROMPT, SKEPTIC_PROMPT, STRATEGIST_PROMPT, WORKER_PROMPT } from "./prompts.ts";
import type { GoalBudgets } from "./types.ts";

export const DEFAULT_BUDGETS: GoalBudgets = {
  tokenBudget: 400_000, maxWorkerIterations: 8, maxVerificationRounds: 6,
  maxStrategistInvocations: 2, strategistThreshold: 2, infraRetries: 1,
};

const q = (value: unknown) => JSON.stringify(value);

export function buildGoalWorkflow(input: { goalId: string; generation: number; objective: string; budgets: GoalBudgets }): string {
  const { goalId, generation, objective, budgets } = input;
  return `
const meta=${q({goalId,generation})};
const budgets=${q(budgets)};
const objective=${q(objective)};
try{
const saved=await state.get("goal");
let contract;
let workPlan;
let worker=null;
let workerRunId=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.workerRunId||null:null;
let priorGaps=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.priorVerificationGaps||[]:[];
let lastFingerprint=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.gapFingerprint||"":"";
let sameGapCount=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.sameGapCount||0:0;
let strategistCount=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.strategistCount||0:0;
let strategy=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.strategy||null:null;
let verificationAttempt=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.verificationAttempt||0:0;
let workerIteration=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.workerIteration||0:0;
if(saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation&&saved.contract){contract=saved.contract;workPlan=saved.workPlan||[];}
else{
 const planner=await runs.run("planner-g"+meta.generation,{agent:"goal-planner",context:"fresh",task:${q(PLANNER_PROMPT)}+"\\n\\nUSER OBJECTIVE:\\n"+objective,outputSchema:${q(plannerSchema)}});
 if(!planner.ok||!planner.structuredOutput)throw new Error("Planner failed closed: structured contract unavailable");
 contract=planner.structuredOutput.contract;
 workPlan=planner.structuredOutput.workPlan;
}
const immutableContract=JSON.stringify(contract);
const normalize=(s)=>s.toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim().split(/\\s+/).filter(Boolean).sort().slice(0,12).join("-");
const fingerprint=(gaps)=>Array.from(new Set(gaps.map(g=>(g.criterionId||"OBJECTIVE").toUpperCase()+":"+normalize(g.problem)))).sort().join("|");
await state.set("goal",{version:1,...meta,objective,status:"working",contract,workPlan,workerIteration,verificationAttempt,priorVerificationGaps:priorGaps,sameGapCount,strategistCount,budgets,updatedAt:new Date().toISOString()});
while(workerIteration<budgets.maxWorkerIterations&&verificationAttempt<budgets.maxVerificationRounds){
 workerIteration++;
 const workerTask=${q(WORKER_PROMPT)}+"\\n\\nIMMUTABLE CONTRACT:\\n"+immutableContract+"\\n\\nWORK PLAN:\\n"+JSON.stringify(workPlan)+"\\n\\nPRIOR GAPS:\\n"+JSON.stringify(priorGaps)+"\\n\\nSTRATEGY:\\n"+JSON.stringify(strategy);
 worker=workerRunId
  ?await runs.run("worker-resume-"+workerIteration,{resume:workerRunId,task:workerTask})
  :await runs.run("worker-initial",{agent:"goal-worker",context:"fresh",task:workerTask,outputSchema:${q(workerSchema)}});
 if(!worker.ok||!worker.structuredOutput)throw new Error("Worker failed to produce a structured completion candidate");
 workerRunId=worker.runId;
 workPlan=worker.structuredOutput.workPlan;
 if(JSON.stringify(contract)!==immutableContract)throw new Error("Immutable contract mutation detected");
 verificationAttempt++;
 await state.set("goal",{version:1,...meta,objective,status:"verifying",contract,workPlan,workerRunId,workerIteration,verificationAttempt,priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,strategy,budgets,updatedAt:new Date().toISOString()});
 const verifierTask=${q(SKEPTIC_PROMPT)}+"\\n\\nGOAL TAG:\\n"+JSON.stringify({...meta,verificationAttempt})+"\\n\\nIMMUTABLE CONTRACT:\\n"+immutableContract+"\\n\\nCURRENT WORK PLAN:\\n"+JSON.stringify(workPlan)+"\\n\\nWORKER CLAIM (UNTRUSTED):\\n"+JSON.stringify(worker.structuredOutput)+"\\n\\nPRIOR GAPS:\\n"+JSON.stringify(priorGaps);
 const panel=await runs.all([0,1,2].map(i=>({key:"skeptic-"+verificationAttempt+"-"+i,agent:"goal-skeptic",context:"fresh",task:verifierTask+"\\nYou are skeptic "+(i+1)+".",outputSchema:${q(verdictSchema)}})));
 if(panel.length!==3||panel.some(r=>!r.ok||!r.structuredOutput)){
  await state.set("goal",{version:1,...meta,objective,status:"infra-paused",contract,workPlan,workerRunId,workerIteration,verificationAttempt,verifierRunIds:panel.map(r=>r.runId).filter(Boolean),priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,strategy,budgets,pauseReason:"Verifier infrastructure or structured-output failure",updatedAt:new Date().toISOString()});
  return {outcome:"infra-paused",goalId:meta.goalId,generation:meta.generation,workerRunId};
 }
 const verdicts=panel.map(r=>r.structuredOutput);
 const gaps=verdicts.flatMap(v=>v.gaps);
 if(verdicts.every(v=>v.achieved&&v.gaps.length===0)){
  const completionResult={independentlyVerified:true,at:new Date().toISOString(),verdicts};
  await state.set("goal",{version:1,...meta,objective,status:"complete",contract,workPlan,workerRunId,workerIteration,verificationAttempt,verifierRunIds:panel.map(r=>r.runId),priorVerificationGaps:[],sameGapCount,strategistCount,strategy,budgets,completionResult,updatedAt:new Date().toISOString()});
  return {outcome:"complete",goalId:meta.goalId,generation:meta.generation,workerRunId,verifierRunIds:panel.map(r=>r.runId),completionResult};
 }
 const fp=fingerprint(gaps);
 const recurring=gaps.some(g=>priorGaps.some(p=>(g.criterionId||"OBJECTIVE").toUpperCase()===(p.criterionId||"OBJECTIVE").toUpperCase()));
 sameGapCount=recurring?sameGapCount+1:1;
 lastFingerprint=fp;
 priorGaps=gaps;
 if(sameGapCount>=budgets.strategistThreshold){
  if(strategistCount>=budgets.maxStrategistInvocations){
   await state.set("goal",{version:1,...meta,objective,status:"no-progress",contract,workPlan,workerRunId,workerIteration,verificationAttempt,verifierRunIds:panel.map(r=>r.runId),priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,strategy,budgets,pauseReason:"Recurring semantic gaps after strategist budget",updatedAt:new Date().toISOString()});
   return {outcome:"no-progress",goalId:meta.goalId,generation:meta.generation,workerRunId,gaps};
  }
  strategistCount++;
  await state.set("goal",{version:1,...meta,objective,status:"strategizing",contract,workPlan,workerRunId,workerIteration,verificationAttempt,priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,budgets,updatedAt:new Date().toISOString()});
  const strategist=await runs.run("strategist-"+strategistCount,{agent:"goal-strategist",context:"fresh",task:${q(STRATEGIST_PROMPT)}+"\\n\\nIMMUTABLE CONTRACT:\\n"+immutableContract+"\\n\\nWORK PLAN:\\n"+JSON.stringify(workPlan)+"\\n\\nRECURRING GAPS:\\n"+JSON.stringify(priorGaps)+"\\n\\nWORKER SUMMARY:\\n"+worker.structuredOutput.summary,outputSchema:${q(strategySchema)}});
  if(!strategist.ok||!strategist.structuredOutput)throw new Error("Strategist structured output unavailable");
  strategy=strategist.structuredOutput;
 }
 await state.set("goal",{version:1,...meta,objective,status:"working",contract,workPlan,workerRunId,workerIteration,verificationAttempt,priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,strategy,budgets,updatedAt:new Date().toISOString()});
}
await state.set("goal",{version:1,...meta,objective,status:"budget-limited",contract,workPlan,workerRunId,workerIteration,verificationAttempt,priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,strategy,budgets,pauseReason:"Worker or verification round budget exhausted",updatedAt:new Date().toISOString()});
return {outcome:"budget-limited",goalId:meta.goalId,generation:meta.generation,workerRunId,gaps:priorGaps};
}catch(error){
 const message=error&&error.message?error.message:String(error);
 const existing=await state.get("goal");
 await state.set("goal",{...(existing||{version:1,...meta,objective,workPlan:[],workerIteration:0,verificationAttempt:0,priorVerificationGaps:[],sameGapCount:0,strategistCount:0,budgets}),status:"infra-paused",pauseReason:message,updatedAt:new Date().toISOString()});
 return {outcome:"infra-paused",goalId:meta.goalId,generation:meta.generation,error:message};
}`;
}
