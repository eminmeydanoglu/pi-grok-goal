/**
 * The one executable definition of the goal decision core.
 *
 * `GOAL_CORE_RUNTIME_SOURCE` deliberately has no imports: a pi-subagents
 * workflowScript is evaluated as a string and cannot import this package. The
 * normal TypeScript modules call the exact same source through `goalCore`;
 * workflow.ts must embed this string rather than reproduce any of its logic.
 */
import type {
  GoalContract,
  Gap,
  PanelAggregate,
  PanelResult,
  TaggedResult,
  VerificationResult,
  WorkerClaim,
  WorkerDisposition,
} from "./types.ts";

export const GOAL_CORE_RUNTIME_SOURCE = String.raw`
const goalCore=(()=>{
  const stopWords=new Set(["a","an","the","is","are","to","of","and","or","bir","bu","ve","ile","icin","için"]);
  const isRecord=(value)=>value!==null&&typeof value==="object"&&!Array.isArray(value);
  const clone=(value)=>JSON.parse(JSON.stringify(value));
  const canonical=(value)=>{
    if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
    if(isRecord(value))return "{"+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+":"+canonical(item)).join(",")+"}";
    return JSON.stringify(value);
  };
  // Synchronous SHA-256 so the digest is usable in workflowScript without an
  // import, Node crypto, an async WebCrypto round trip, or host-provided
  // TextEncoder (the pi workflow VM intentionally does not expose one).
  const utf8=(value)=>{
    const bytes=[];
    for(let i=0;i<value.length;i++){
      let code=value.charCodeAt(i);
      if(code>=0xd800&&code<=0xdbff&&i+1<value.length){const next=value.charCodeAt(i+1);if(next>=0xdc00&&next<=0xdfff){code=0x10000+((code-0xd800)<<10)+(next-0xdc00);i++;}}
      if(code<=0x7f)bytes.push(code);
      else if(code<=0x7ff)bytes.push(0xc0|(code>>6),0x80|(code&63));
      else if(code<=0xffff)bytes.push(0xe0|(code>>12),0x80|((code>>6)&63),0x80|(code&63));
      else bytes.push(0xf0|(code>>18),0x80|((code>>12)&63),0x80|((code>>6)&63),0x80|(code&63));
    }
    return bytes;
  };
  const sha256=(value)=>{
    const bytes=utf8(value); const bitLength=bytes.length*8;
    const padded=new Uint8Array(((bytes.length+9+63)>>6)<<6); padded.set(bytes); padded[bytes.length]=0x80;
    const view=new DataView(padded.buffer); view.setUint32(padded.length-8,Math.floor(bitLength/4294967296),false); view.setUint32(padded.length-4,bitLength>>>0,false);
    const k=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];
    let h0=1779033703,h1=3144134277,h2=1013904242,h3=2773480762,h4=1359893119,h5=2600822924,h6=528734635,h7=1541459225;
    const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
    for(let offset=0;offset<padded.length;offset+=64){
      const w=[]; for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4,false); for(let i=16;i<64;i++){const s0=rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3);const s1=rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10);w[i]=(((w[i-16]+s0)|0)+(w[i-7]+s1))|0;}
      let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
      for(let i=0;i<64;i++){const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);const choice=(e&f)^((~e)&g);const temp1=(((h+S1)|0)+((choice+k[i])|0)+w[i])|0;const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);const majority=(a&b)^(a&c)^(b&c);const temp2=(S0+majority)|0;h=g;g=f;f=e;e=(d+temp1)|0;d=c;c=b;b=a;a=(temp1+temp2)|0;}
      h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;h4=(h4+e)|0;h5=(h5+f)|0;h6=(h6+g)|0;h7=(h7+h)|0;
    }
    return [h0,h1,h2,h3,h4,h5,h6,h7].map(word=>(word>>>0).toString(16).padStart(8,"0")).join("");
  };
  const validateContract=(value)=>{
    if(!isRecord(value))throw new Error("Planner did not return a GoalContract");
    const required=["objective","acceptanceCriteria","constraints","nonGoals","verificationPlan"];
    if(Object.keys(value).length!==required.length||required.some(key=>!(key in value)))throw new Error("Malformed GoalContract shape");
    if(typeof value.objective!=="string"||!value.objective.trim())throw new Error("GoalContract objective is empty");
    if(!Array.isArray(value.acceptanceCriteria)||value.acceptanceCriteria.length===0)throw new Error("GoalContract requires acceptance criteria");
    const ids=new Set();
    for(const criterion of value.acceptanceCriteria){
      if(!isRecord(criterion)||Object.keys(criterion).some(key=>key!=="id"&&key!=="requirement"&&key!=="verification")||typeof criterion.id!=="string"||!criterion.id.trim()||typeof criterion.requirement!=="string"||!criterion.requirement.trim()||("verification" in criterion&&typeof criterion.verification!=="string"))throw new Error("Malformed acceptance criterion");
      if(ids.has(criterion.id))throw new Error("Duplicate criterion id: "+criterion.id); ids.add(criterion.id);
    }
    for(const field of ["constraints","nonGoals","verificationPlan"]){if(!Array.isArray(value[field])||value[field].some(item=>typeof item!=="string"))throw new Error("GoalContract "+field+" must be an array of strings");}
    return clone(value);
  };
  const contractDigest=(contract)=>sha256(canonical(validateContract(contract)));
  const assertContractUnchanged=(contract,digest)=>{if(typeof digest!=="string"||!/^[a-f0-9]{64}$/.test(digest)||contractDigest(contract)!==digest)throw new Error("Immutable GoalContract was mutated or its digest is invalid");};
  const workerDisposition=(claim)=>{
    if(!isRecord(claim)||typeof claim.completed!=="boolean")throw new Error("Malformed worker claim");
    const outcome=claim.outcome;
    if(outcome===undefined)return claim.completed?"candidate":"continue";
    if(outcome!=="candidate"&&outcome!=="continue"&&outcome!=="blocked")throw new Error("Unknown worker outcome");
    if((outcome==="candidate")!==claim.completed)throw new Error("Worker outcome and completed flag disagree");
    if(outcome==="blocked"&&(typeof claim.blockedReason!=="string"||!claim.blockedReason.trim()))throw new Error("Blocked worker claim requires blockedReason");
    return outcome;
  };
  const validateVerificationResult=(value)=>{
    if(!isRecord(value)||typeof value.kind!=="string")throw new Error("Malformed verification result");
    if(value.kind==="infrastructure"){if(Object.keys(value).length!==2||typeof value.reason!=="string"||!value.reason.trim())throw new Error("Malformed infrastructure verification result");return clone(value);}
    if(value.kind!=="verdict"||Object.keys(value).some(key=>key!=="kind"&&key!=="achieved"&&key!=="gaps"&&key!=="notes")||typeof value.achieved!=="boolean"||!Array.isArray(value.gaps)||("notes" in value&&(!Array.isArray(value.notes)||value.notes.some(note=>typeof note!=="string"))))throw new Error("Malformed verification verdict");
    for(const gap of value.gaps){if(!isRecord(gap)||Object.keys(gap).some(key=>key!=="criterionId"&&key!=="problem"&&key!=="evidence")||typeof gap.problem!=="string"||!gap.problem.trim()||("criterionId" in gap&&typeof gap.criterionId!=="string")||("evidence" in gap&&typeof gap.evidence!=="string"))throw new Error("Malformed verification gap");}
    if(value.achieved&&value.gaps.length)throw new Error("Successful verification verdict cannot contain gaps");
    return clone(value);
  };
  const aggregatePanel=(results)=>{
    if(!Array.isArray(results)||results.length!==3||results.some(result=>!isRecord(result)||result.kind==="infrastructure"))return {outcome:"infra",gaps:[],verdicts:[]};
    const verdicts=[]; for(const result of results){try{const verdict=validateVerificationResult(result.verdict);if(verdict.kind!=="verdict")return {outcome:"infra",gaps:[],verdicts:[]};verdicts.push(verdict);}catch{return {outcome:"infra",gaps:[],verdicts:[]};}}
    const gaps=verdicts.flatMap(verdict=>verdict.gaps); return verdicts.every(verdict=>verdict.achieved&&verdict.gaps.length===0)?{outcome:"pass",gaps:[],verdicts}:{outcome:"fail",gaps,verdicts};
  };
  const normalizeProblem=(problem)=>String(problem).toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{Diacritic}/gu,"").replace(/[^a-z0-9]+/g," ").trim().split(/\s+/).filter(word=>word&&!stopWords.has(word)).sort().slice(0,12).join("-");
  const gapFingerprint=(gaps)=>{if(!Array.isArray(gaps))throw new Error("Gaps must be an array");return [...new Set(gaps.map(gap=>{if(!isRecord(gap)||typeof gap.problem!=="string")throw new Error("Malformed verification gap");return (typeof gap.criterionId==="string"&&gap.criterionId.trim()?gap.criterionId.trim().toUpperCase():"OBJECTIVE")+":"+normalizeProblem(gap.problem);} ))].sort().join("|");};
  const isCurrentResult=(current,incoming)=>isRecord(current)&&isRecord(incoming)&&typeof current.goalId==="string"&&typeof incoming.goalId==="string"&&Number.isInteger(current.generation)&&Number.isInteger(incoming.generation)&&Number.isInteger(current.verificationAttempt)&&Number.isInteger(incoming.verificationAttempt)&&current.goalId===incoming.goalId&&current.generation===incoming.generation&&current.verificationAttempt===incoming.verificationAttempt;
  const transitions={planning:["working","infra-paused","budget-limited","paused","cancelled"],working:["verifying","strategizing","no-progress","blocked","infra-paused","budget-limited","paused","cancelled"],verifying:["complete","working","strategizing","blocked","infra-paused","budget-limited","paused","cancelled"],strategizing:["working","no-progress","blocked","infra-paused","budget-limited","paused","cancelled"],paused:["planning","working","verifying","strategizing","no-progress","cancelled"],"no-progress":["working","strategizing","paused","cancelled"],blocked:["working","paused","cancelled"],"budget-limited":["working","paused","cancelled"],"infra-paused":["planning","working","verifying","strategizing","paused","cancelled"],complete:[],cancelled:[]};
  const canTransition=(from,to)=>typeof from==="string"&&typeof to==="string"&&Array.isArray(transitions[from])&&transitions[from].includes(to);
  return Object.freeze({canonical,validateContract,contractDigest,assertContractUnchanged,workerDisposition,validateVerificationResult,aggregatePanel,normalizeProblem,gapFingerprint,isCurrentResult,canTransition});
})();`;

export interface GoalCore {
  canonical(value: unknown): string;
  validateContract(value: unknown): GoalContract;
  contractDigest(contract: GoalContract): string;
  assertContractUnchanged(contract: GoalContract, digest: string): void;
  workerDisposition(claim: unknown): WorkerDisposition;
  validateVerificationResult(value: unknown): VerificationResult;
  aggregatePanel(results: readonly PanelResult[]): PanelAggregate;
  normalizeProblem(problem: string): string;
  gapFingerprint(gaps: readonly Gap[]): string;
  isCurrentResult(current: TaggedResult, incoming: TaggedResult): boolean;
  canTransition(from: string, to: string): boolean;
}

export function createGoalCore(): GoalCore {
  // This is intentional: it tests and exports the exact source embedded into
  // workflowScript, instead of maintaining a second TypeScript implementation.
  return Function(`"use strict";${GOAL_CORE_RUNTIME_SOURCE};return goalCore;`)() as GoalCore;
}

export const goalCore = createGoalCore();
