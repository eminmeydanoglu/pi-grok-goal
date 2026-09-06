import { plannerSchema, strategySchema, verdictSchema, workerSchema } from "./schemas.ts";
import { PLANNER_PROMPT, SKEPTIC_PROMPT, STRATEGIST_PROMPT, WORKER_PROMPT } from "./prompts.ts";
import type { GoalBudgets } from "./types.ts";

export const DEFAULT_BUDGETS: GoalBudgets = {
  tokenBudget: 400_000, maxWorkerIterations: 8, maxVerificationRounds: 6,
  maxStrategistInvocations: 2, strategistThreshold: 2, infraRetries: 1, wallClockMs: 3_600_000,
};

const q = (value: unknown) => JSON.stringify(value);

export function buildGoalWorkflow(input: { goalId: string; generation: number; objective: string; budgets: GoalBudgets }): string {
  const { goalId, generation, objective, budgets } = input;
  return `
const meta=${q({goalId,generation})};
const budgets=${q(budgets)};
const objective=${q(objective)};
const persist=(value)=>state.get("goal").then(current=>{if(current&&current.goalId===meta.goalId&&(current.generation!==meta.generation||current.status==="cancelled"||(current.verificationAttempt||0)>(value.verificationAttempt||0)))throw new Error("STALE_GOAL_RESULT");return state.set("goal",value);});
try{
const saved=await state.get("goal");
let contract;
let workPlan;
let worker=null;
let workerRunId=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.workerRunId||null:null;
let workerResumeRunId=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.workerResumeRunId||workerRunId:null;
let workerClaim=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.workerClaim||null:null;
let verificationHistory=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.verificationHistory||[]:[];
let priorGaps=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.priorVerificationGaps||[]:[];
let lastFingerprint=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.gapFingerprint||"":"";
let sameGapCount=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.sameGapCount||0:0;
let strategistCount=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.strategistCount||0:0;
let strategy=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.strategy||null:null;
let verificationAttempt=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.verificationAttempt||0:0;
let workerIteration=saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation?saved.workerIteration||0:0;
if(saved&&saved.goalId===meta.goalId&&saved.generation===meta.generation&&saved.contract){contract=saved.contract;workPlan=saved.workPlan||[];}
else{
 await persist({version:1,...meta,objective,status:"planning",workPlan:[],workerIteration,verificationAttempt,verifierRunIds:[],priorVerificationGaps:[],sameGapCount,strategistCount,budgets,updatedAt:new Date().toISOString()});
 const planner=await runs.run("planner-g"+meta.generation,{agent:"goal-planner",context:"fresh",task:${q(PLANNER_PROMPT)}+"\\n\\nUSER OBJECTIVE:\\n"+objective,outputSchema:${q(plannerSchema)}});
 if(!planner.ok||!planner.structuredOutput)throw new Error("Planner failed closed: structured contract unavailable");
 contract=planner.structuredOutput.contract;
 workPlan=planner.structuredOutput.workPlan;
}
const immutableContract=JSON.stringify(contract);
const normalize=(s)=>s.toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim().split(/\\s+/).filter(Boolean).sort().slice(0,12).join("-");
const fingerprint=(gaps)=>Array.from(new Set(gaps.map(g=>(g.criterionId||"OBJECTIVE").toUpperCase()+":"+normalize(g.problem)))).sort().join("|");
await persist({version:1,...meta,objective,status:"working",contract,workPlan,workerRunId,workerResumeRunId,workerClaim,workerIteration,verificationAttempt,verifierRunIds:[],priorVerificationGaps:priorGaps,sameGapCount,strategistCount,verificationHistory,budgets,updatedAt:new Date().toISOString()});
while(workerIteration<budgets.maxWorkerIterations&&verificationAttempt<budgets.maxVerificationRounds){
 workerIteration++;
 const workerTask=${q(WORKER_PROMPT)}+"\\n\\nIMMUTABLE CONTRACT:\\n"+immutableContract+"\\n\\nWORK PLAN:\\n"+JSON.stringify(workPlan)+"\\n\\nPRIOR GAPS:\\n"+JSON.stringify(priorGaps)+"\\n\\nSTRATEGY:\\n"+JSON.stringify(strategy);
 worker=workerResumeRunId
  ?await runs.run("worker-resume-"+workerIteration,{resume:workerResumeRunId,task:workerTask})
  :await runs.run("worker-initial",{agent:"goal-worker",context:"fresh",task:workerTask,outputSchema:${q(workerSchema)}});
 if(!worker.ok||!worker.structuredOutput)throw new Error("Worker failed to produce a structured completion candidate");
 if(!workerRunId)workerRunId=worker.runId;
 workerResumeRunId=worker.runId;
 workerClaim=worker.structuredOutput;
 workPlan=worker.structuredOutput.workPlan;
 if(JSON.stringify(contract)!==immutableContract)throw new Error("Immutable contract mutation detected");
 verificationAttempt++;
 await persist({version:1,...meta,objective,status:"verifying",contract,workPlan,workerRunId,workerResumeRunId,workerClaim,workerIteration,verificationAttempt,verifierRunIds:[],priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,strategy,verificationHistory,budgets,updatedAt:new Date().toISOString()});
 const verifierTask=${q(SKEPTIC_PROMPT)}+"\\n\\nGOAL TAG:\\n"+JSON.stringify({...meta,verificationAttempt})+"\\n\\nIMMUTABLE CONTRACT:\\n"+immutableContract+"\\n\\nCURRENT WORK PLAN:\\n"+JSON.stringify(workPlan)+"\\n\\nWORKER CLAIM (UNTRUSTED):\\n"+JSON.stringify(worker.structuredOutput)+"\\n\\nPRIOR GAPS:\\n"+JSON.stringify(priorGaps);
 const panel=await runs.all([0,1,2].map(i=>({key:"skeptic-"+verificationAttempt+"-"+i,agent:"goal-skeptic",context:"fresh",task:verifierTask+"\\nYou are skeptic "+(i+1)+".",outputSchema:${q(verdictSchema)}})));
 if(panel.length!==3||panel.some(r=>!r.ok||!r.structuredOutput)){
  await persist({version:1,...meta,objective,status:"infra-paused",contract,workPlan,workerRunId,workerResumeRunId,workerClaim,workerIteration,verificationAttempt,verifierRunIds:panel.map(r=>r.runId).filter(Boolean),priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,strategy,verificationHistory,budgets,pauseReason:"Verifier infrastructure or structured-output failure",updatedAt:new Date().toISOString()});
  return {outcome:"infra-paused",goalId:meta.goalId,generation:meta.generation,workerRunId};
 }
 const verdicts=panel.map(r=>r.structuredOutput);
 const gaps=verdicts.flatMap(v=>v.gaps);
 const fp=fingerprint(gaps);
 verificationHistory.push({attempt:verificationAttempt,verifierRunIds:panel.map(r=>r.runId),verdicts,gaps,fingerprint:fp});
 if(verdicts.every(v=>v.achieved&&v.gaps.length===0)){
  const completionResult={independentlyVerified:true,at:new Date().toISOString(),verdicts};
  await persist({version:1,...meta,objective,status:"complete",contract,workPlan,workerRunId,workerResumeRunId,workerClaim,workerIteration,verificationAttempt,verifierRunIds:panel.map(r=>r.runId),priorVerificationGaps:[],sameGapCount,strategistCount,strategy,verificationHistory,budgets,completionResult,updatedAt:new Date().toISOString()});
  return {outcome:"complete",goalId:meta.goalId,generation:meta.generation,workerRunId,verifierRunIds:panel.map(r=>r.runId),completionResult};
 }
 const recurring=Boolean(fp)&&fp===lastFingerprint;
 sameGapCount=recurring?sameGapCount+1:1;
 lastFingerprint=fp;
 priorGaps=gaps;
 if(sameGapCount>=budgets.strategistThreshold){
  if(strategistCount>=budgets.maxStrategistInvocations){
   await persist({version:1,...meta,objective,status:"no-progress",contract,workPlan,workerRunId,workerResumeRunId,workerClaim,workerIteration,verificationAttempt,verifierRunIds:panel.map(r=>r.runId),priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,strategy,verificationHistory,budgets,pauseReason:"Recurring semantic gaps after strategist budget",updatedAt:new Date().toISOString()});
   return {outcome:"no-progress",goalId:meta.goalId,generation:meta.generation,workerRunId,gaps};
  }
  strategistCount++;
  await persist({version:1,...meta,objective,status:"strategizing",contract,workPlan,workerRunId,workerResumeRunId,workerClaim,workerIteration,verificationAttempt,verifierRunIds:panel.map(r=>r.runId),priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,verificationHistory,budgets,updatedAt:new Date().toISOString()});
  const strategist=await runs.run("strategist-"+strategistCount,{agent:"goal-strategist",context:"fresh",task:${q(STRATEGIST_PROMPT)}+"\\n\\nIMMUTABLE CONTRACT:\\n"+immutableContract+"\\n\\nWORK PLAN:\\n"+JSON.stringify(workPlan)+"\\n\\nRECURRING GAPS:\\n"+JSON.stringify(priorGaps)+"\\n\\nWORKER SUMMARY:\\n"+worker.structuredOutput.summary,outputSchema:${q(strategySchema)}});
  if(!strategist.ok||!strategist.structuredOutput)throw new Error("Strategist structured output unavailable");
  strategy=strategist.structuredOutput;
 }
 await persist({version:1,...meta,objective,status:"working",contract,workPlan,workerRunId,workerResumeRunId,workerClaim,workerIteration,verificationAttempt,verifierRunIds:panel.map(r=>r.runId),priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,strategy,verificationHistory,budgets,updatedAt:new Date().toISOString()});
}
await persist({version:1,...meta,objective,status:"budget-limited",contract,workPlan,workerRunId,workerResumeRunId,workerClaim,workerIteration,verificationAttempt,verifierRunIds:[],priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,strategy,verificationHistory,budgets,pauseReason:"Worker or verification round budget exhausted",updatedAt:new Date().toISOString()});
return {outcome:"budget-limited",goalId:meta.goalId,generation:meta.generation,workerRunId,gaps:priorGaps};
}catch(error){
 const message=error&&error.message?error.message:String(error);
 const existing=await state.get("goal");
 if(message==="STALE_GOAL_RESULT")return {outcome:"stale-ignored",goalId:meta.goalId,generation:meta.generation};
 const outcome=/usage budget exhausted|token budget exhausted|hard token limit/i.test(message)?"budget-limited":"infra-paused";
 await persist({...(existing||{version:1,...meta,objective,workPlan:[],workerIteration:0,verificationAttempt:0,verifierRunIds:[],priorVerificationGaps:[],sameGapCount:0,strategistCount:0,budgets}),status:outcome,pauseReason:message,updatedAt:new Date().toISOString()});
 return {outcome,goalId:meta.goalId,generation:meta.generation,error:message};
}`;
}
