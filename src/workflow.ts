import { plannerSchema, strategySchema, verdictSchema, workerSchema } from "./schemas.ts";
import { PLANNER_PROMPT, SKEPTIC_PROMPT, STRATEGIST_PROMPT, WORKER_PROMPT } from "./prompts.ts";
import { GOAL_CORE_RUNTIME_SOURCE } from "./runtime-core.ts";
import type { GoalBudgets } from "./types.ts";

export const DEFAULT_BUDGETS: GoalBudgets = {
  tokenBudget: 400_000, maxWorkerIterations: 8, maxVerificationRounds: 6,
  maxStrategistInvocations: 2, strategistThreshold: 2, infraRetries: 1, wallClockMs: 3_600_000,
};

/** Explicit child-model overrides; omitted roles inherit the outer Pi model. */
export interface GoalRoleModels { planner?: string; worker?: string; skeptic?: string; strategist?: string }

const q = (value: unknown) => JSON.stringify(value);

/**
 * The source below is the production workflow. Its decision helpers come from
 * runtime-core.ts, the same source used by the TypeScript core/unit tests.
 */
export function buildGoalWorkflow(input: { goalId: string; generation: number; objective: string; budgets: GoalBudgets; roleModels?: GoalRoleModels }): string {
  const { goalId, generation, objective, budgets, roleModels = {} } = input;
  return `
const meta=${q({ goalId, generation })};
const budgets=${q(budgets)};
const objective=${q(objective)};
const roleModels=${q(roleModels)};
const schemas=${q({ plannerSchema, workerSchema, verdictSchema, strategySchema })};
const prompts=${q({ planner: PLANNER_PROMPT, worker: WORKER_PROMPT, skeptic: SKEPTIC_PROMPT, strategist: STRATEGIST_PROMPT })};
${GOAL_CORE_RUNTIME_SOURCE}
const modelFor=(role)=>roleModels[role]?{model:roleModels[role]}:{};
const now=()=>new Date().toISOString();
const metaMatches=(value)=>value&&value.goalId===meta.goalId&&value.generation===meta.generation;
const persist=(value)=>state.get("goal").then(current=>{
 if(current&&current.goalId===meta.goalId){
  if(current.generation!==meta.generation||current.status==="cancelled")throw new Error("STALE_GOAL_RESULT");
  const currentTag={goalId:current.goalId,generation:current.generation,verificationAttempt:current.verificationAttempt||0};
  const incomingTag={goalId:value.goalId,generation:value.generation,verificationAttempt:value.verificationAttempt||0};
  const exactCurrent=goalCore.isCurrentResult(currentTag,incomingTag);
  if(!exactCurrent&&(current.verificationAttempt||0)>(value.verificationAttempt||0))throw new Error("STALE_GOAL_RESULT");
  if(current.status!==value.status&&!goalCore.canTransition(current.status,value.status))throw new Error("Illegal goal transition: "+current.status+" -> "+value.status);
 }
 return state.set("goal",value);
});
try{
 const saved=await state.get("goal");
 if(metaMatches(saved)&&(saved.status==="complete"||saved.status==="cancelled"))return {outcome:"stale-ignored",goalId:meta.goalId,generation:meta.generation};
 const restoring=metaMatches(saved)&&Boolean(saved.contract);
 let contract;
 let contractDigest;
 let workPlan;
 let workerRunId=restoring?saved.workerRunId||null:null;
 let workerResumeRunId=restoring?saved.workerResumeRunId||workerRunId:null;
 let workerClaim=restoring?saved.workerClaim||null:null;
 let verificationHistory=restoring?saved.verificationHistory||[]:[];
 let priorGaps=restoring?saved.priorVerificationGaps||[]:[];
 let lastFingerprint=restoring?saved.gapFingerprint||"":"";
 let sameGapCount=restoring?saved.sameGapCount||0:0;
 let strategistCount=restoring?saved.strategistCount||0:0;
 let strategy=restoring?saved.strategy||null:null;
 let verificationAttempt=restoring?saved.verificationAttempt||0:0;
 let workerIteration=restoring?saved.workerIteration||0:0;
 if(restoring){
  contract=goalCore.validateContract(saved.contract);
  contractDigest=saved.contractDigest;
  // Missing digest is corrupt state, never a fresh immutable baseline.
  goalCore.assertContractUnchanged(contract,contractDigest);
  workPlan=Array.isArray(saved.workPlan)?saved.workPlan:[];
 }else{
  await persist({version:1,...meta,objective,status:"planning",workPlan:[],workerIteration,verificationAttempt,verifierRunIds:[],priorVerificationGaps:[],sameGapCount,strategistCount,budgets,updatedAt:now()});
  let planner=null;let plannerError;
  for(let attempt=0;attempt<=budgets.infraRetries;attempt++){
   try{const result=await runs.run("planner-g"+meta.generation+"-"+attempt,{agent:"goal-planner",context:"fresh",...modelFor("planner"),task:prompts.planner+"\\n\\nUSER OBJECTIVE:\\n"+objective,outputSchema:schemas.plannerSchema});if(!result||!result.ok||!result.structuredOutput)throw new Error("structured contract unavailable");planner=result;break;}catch(error){plannerError=error;}
  }
  if(!planner){const detail=plannerError&&plannerError.message?plannerError.message:String(plannerError||"unknown failure");throw new Error("Planner failed after "+(budgets.infraRetries+1)+" attempt(s): "+detail);}
  contract=goalCore.validateContract(planner.structuredOutput.contract);
  contractDigest=goalCore.contractDigest(contract);
  workPlan=planner.structuredOutput.workPlan;
 }
 const immutableContract=goalCore.canonical(contract);
 goalCore.assertContractUnchanged(contract,contractDigest);
 const snapshot=(status,extra={})=>({version:1,...meta,objective,status,contract,contractDigest,workPlan,workerRunId,workerResumeRunId,workerClaim,workerIteration,verificationAttempt,verifierRunIds:[],priorVerificationGaps:priorGaps,gapFingerprint:lastFingerprint,sameGapCount,strategistCount,strategy,verificationHistory,budgets,updatedAt:now(),...extra});
 await persist(snapshot("working"));
 while(workerIteration<budgets.maxWorkerIterations&&verificationAttempt<budgets.maxVerificationRounds){
  workerIteration++;
  goalCore.assertContractUnchanged(contract,contractDigest);
  const workerTask=prompts.worker+"\\n\\nIMMUTABLE CONTRACT:\\n"+immutableContract+"\\n\\nWORK PLAN:\\n"+JSON.stringify(workPlan)+"\\n\\nPRIOR GAPS:\\n"+JSON.stringify(priorGaps)+"\\n\\nSTRATEGY:\\n"+JSON.stringify(strategy);
  let worker=null;let workerError;
  for(let attempt=0;attempt<=budgets.infraRetries;attempt++){
   try{const key=workerResumeRunId?"worker-resume-"+workerIteration+"-"+attempt:"worker-initial-"+attempt;const result=workerResumeRunId?await runs.run(key,{resume:workerResumeRunId,...modelFor("worker"),task:workerTask}):await runs.run(key,{agent:"goal-worker",context:"fresh",...modelFor("worker"),task:workerTask,outputSchema:schemas.workerSchema});if(!result||!result.ok||!result.structuredOutput)throw new Error("structured worker output unavailable");worker=result;break;}catch(error){workerError=error;}
  }
  if(!worker){const detail=workerError&&workerError.message?workerError.message:String(workerError||"unknown failure");throw new Error("Worker failed after "+(budgets.infraRetries+1)+" attempt(s): "+detail);}
  if(!workerRunId)workerRunId=worker.runId;
  workerResumeRunId=worker.runId;
  workerClaim=worker.structuredOutput;
  workPlan=Array.isArray(workerClaim.workPlan)?workerClaim.workPlan:workPlan;
  const disposition=goalCore.workerDisposition(workerClaim);
  goalCore.assertContractUnchanged(contract,contractDigest);
  if(disposition==="blocked"){
   const reason=workerClaim.blockedReason;
   await persist(snapshot("blocked",{pauseReason:reason}));
   return {outcome:"blocked",goalId:meta.goalId,generation:meta.generation,workerRunId,reason};
  }
  // Progress updates never spend skeptic-panel budget or authority.
  if(disposition==="continue"){
   await persist(snapshot("working"));
   continue;
  }
  verificationAttempt++;
  await persist(snapshot("verifying"));
  const verifierTask=prompts.skeptic+"\\n\\nGOAL TAG:\\n"+JSON.stringify({...meta,verificationAttempt})+"\\n\\nIMMUTABLE CONTRACT:\\n"+immutableContract+"\\n\\nCURRENT WORK PLAN:\\n"+JSON.stringify(workPlan)+"\\n\\nWORKER CLAIM (UNTRUSTED):\\n"+JSON.stringify(workerClaim)+"\\n\\nPRIOR GAPS:\\n"+JSON.stringify(priorGaps);
  let panel=null;let panelError;
  for(let attempt=0;attempt<=budgets.infraRetries;attempt++){
   try{const results=await runs.all([0,1,2].map(i=>({key:"skeptic-"+verificationAttempt+"-"+i+"-"+attempt,agent:"goal-skeptic",context:"fresh",...modelFor("skeptic"),task:verifierTask+"\\nYou are skeptic "+(i+1)+".",outputSchema:schemas.verdictSchema})));if(!Array.isArray(results)||results.length!==3)throw new Error("expected three verifier results");for(const result of results){if(!result||!result.ok||!result.structuredOutput)throw new Error("Verifier child failed or omitted structured output");goalCore.validateVerificationResult(result.structuredOutput);}panel=results;break;}catch(error){panelError=error;}
  }
  if(!panel){const detail=panelError&&panelError.message?panelError.message:String(panelError||"unknown failure");throw new Error("Verifier panel failed after "+(budgets.infraRetries+1)+" attempt(s): "+detail);}
  const panelResults=panel.map(result=>{
   try{
    const verification=goalCore.validateVerificationResult(result.structuredOutput);
    return verification.kind==="infrastructure"?{kind:"infrastructure",runId:result.runId,error:verification.reason}:{kind:"verdict",runId:result.runId,verdict:verification};
   }catch(error){return {kind:"infrastructure",runId:result.runId,error:error&&error.message?error.message:String(error)};}
  });
  const aggregate=goalCore.aggregatePanel(panelResults);
  const verifierRunIds=panel.map(result=>result&&result.runId).filter(Boolean);
  if(aggregate.outcome==="infra"){
   const reason=panelResults.filter(item=>item.kind==="infrastructure").map(item=>item.error).join("; ")||"Verifier infrastructure failure";
   await persist(snapshot("infra-paused",{verifierRunIds,pauseReason:reason}));
   return {outcome:"infra-paused",goalId:meta.goalId,generation:meta.generation,workerRunId};
  }
  const gaps=aggregate.gaps;
  const fp=goalCore.gapFingerprint(gaps);
  verificationHistory.push({attempt:verificationAttempt,verifierRunIds,verdicts:aggregate.verdicts,gaps,fingerprint:fp});
  if(aggregate.outcome==="pass"){
   const completionResult={independentlyVerified:true,at:now(),verdicts:aggregate.verdicts};
   await persist(snapshot("complete",{verifierRunIds,priorVerificationGaps:[],completionResult}));
   return {outcome:"complete",goalId:meta.goalId,generation:meta.generation,workerRunId,verifierRunIds,completionResult};
  }
  const recurring=Boolean(fp)&&fp===lastFingerprint;
  sameGapCount=recurring?sameGapCount+1:1;
  lastFingerprint=fp;
  priorGaps=gaps;
  if(sameGapCount>=budgets.strategistThreshold){
   if(strategistCount>=budgets.maxStrategistInvocations){
    await persist(snapshot("no-progress",{verifierRunIds,pauseReason:"Recurring semantic gaps after strategist budget"}));
    return {outcome:"no-progress",goalId:meta.goalId,generation:meta.generation,workerRunId,gaps};
   }
   strategistCount++;
   await persist(snapshot("strategizing",{verifierRunIds}));
   let strategist=null;let strategistError;
   for(let attempt=0;attempt<=budgets.infraRetries;attempt++){
    try{const result=await runs.run("strategist-"+strategistCount+"-"+attempt,{agent:"goal-strategist",context:"fresh",...modelFor("strategist"),task:prompts.strategist+"\\n\\nIMMUTABLE CONTRACT:\\n"+immutableContract+"\\n\\nWORK PLAN:\\n"+JSON.stringify(workPlan)+"\\n\\nRECURRING GAPS:\\n"+JSON.stringify(priorGaps)+"\\n\\nWORKER SUMMARY:\\n"+workerClaim.summary,outputSchema:schemas.strategySchema});if(!result||!result.ok||!result.structuredOutput)throw new Error("structured strategy unavailable");strategist=result;break;}catch(error){strategistError=error;}
   }
   if(!strategist){const detail=strategistError&&strategistError.message?strategistError.message:String(strategistError||"unknown failure");throw new Error("Strategist failed after "+(budgets.infraRetries+1)+" attempt(s): "+detail);}
   strategy=strategist.structuredOutput;
  }
  await persist(snapshot("working",{verifierRunIds}));
 }
 await persist(snapshot("budget-limited",{pauseReason:"Worker or verification round budget exhausted"}));
 return {outcome:"budget-limited",goalId:meta.goalId,generation:meta.generation,workerRunId,gaps:priorGaps};
}catch(error){
 const message=error&&error.message?error.message:String(error);
 const existing=await state.get("goal");
 if(message==="STALE_GOAL_RESULT")return {outcome:"stale-ignored",goalId:meta.goalId,generation:meta.generation};
 const outcome=/usage budget exhausted|token budget exhausted|hard token limit/i.test(message)?"budget-limited":"infra-paused";
 const baseline=metaMatches(existing)?existing:{version:1,...meta,objective,workPlan:[],workerIteration:0,verificationAttempt:0,verifierRunIds:[],priorVerificationGaps:[],sameGapCount:0,strategistCount:0,budgets};
 try{await persist({...baseline,status:outcome,pauseReason:message,updatedAt:now()});}catch(persistError){if(String(persistError&&persistError.message||persistError)!=="STALE_GOAL_RESULT")throw persistError;}
 return {outcome,goalId:meta.goalId,generation:meta.generation,error:message};
}`;
}
