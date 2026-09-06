import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  assertSupportedPiSubagentsVersion,
  configuredGoalChildExtensions,
  findLatestGoalSnapshot,
  goalChildExtensionPolicy,
  persistGoalControlState as persistGoalControlStateInStore,
  updateGoalMissionLifecycle,
} from "./pi-subagents-adapter.ts";
import { buildGoalWorkflow, DEFAULT_BUDGETS } from "./workflow.ts";
import type { GoalSnapshot } from "./types.ts";

const RPC_REQUEST = "subagents:rpc:v1:request";
const RPC_REPLY = "subagents:rpc:v1:reply:";
const ASYNC_COMPLETE = "subagent:async-complete";
// Public, documented process-local runtime-agent event. Keep it separate from
// the adapter: it is not a private mission-store dependency.
const REGISTER_AGENT = "pi-subagents:runtime-agent-register:v1";

interface ActiveGoal { goalId: string; generation: number; objective: string; missionId?: string; asyncRunId?: string; snapshot?: GoalSnapshot }
interface RpcReply { success: boolean; data?: { text?: string; details?: Record<string, unknown> }; error?: {message?:string} }
interface RuntimeAgentDefinition {
  description: string;
  systemPrompt: string;
  tools: readonly string[];
  completionGuard?: boolean;
  extensions?: readonly string[];
  subagentOnlyExtensions?: readonly string[];
}

function configuredBudgets() {
  const integer=(name:string,fallback:number)=>{const parsed=Number.parseInt(process.env[name]??"",10);return Number.isSafeInteger(parsed)&&parsed>0?parsed:fallback;};
  return {...DEFAULT_BUDGETS,tokenBudget:integer("PI_GOAL_TOKEN_BUDGET",DEFAULT_BUDGETS.tokenBudget),maxWorkerIterations:integer("PI_GOAL_MAX_WORKER_ITERATIONS",DEFAULT_BUDGETS.maxWorkerIterations),maxVerificationRounds:integer("PI_GOAL_MAX_VERIFICATION_ROUNDS",DEFAULT_BUDGETS.maxVerificationRounds),maxStrategistInvocations:integer("PI_GOAL_MAX_STRATEGISTS",DEFAULT_BUDGETS.maxStrategistInvocations),strategistThreshold:integer("PI_GOAL_STRATEGIST_THRESHOLD",DEFAULT_BUDGETS.strategistThreshold),infraRetries:integer("PI_GOAL_INFRA_RETRIES",DEFAULT_BUDGETS.infraRetries),wallClockMs:integer("PI_GOAL_WALL_CLOCK_MS",DEFAULT_BUDGETS.wallClockMs)};
}

function rpc(pi: ExtensionAPI, method: string, params: Record<string, unknown>, timeoutMs = 20_000): Promise<RpcReply> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const off = pi.events.on(`${RPC_REPLY}${requestId}`, (raw) => {
      clearTimeout(timer); off?.(); resolve(raw as RpcReply);
    });
    const timer = setTimeout(() => { off?.(); reject(new Error(`pi-subagents RPC ${method} timed out`)); }, timeoutMs);
    pi.events.emit(RPC_REQUEST, { version: 1, requestId, method, params, source: { extension: "pi-grok-goal" } });
  });
}

const GOAL_AGENT_ROLES = [
  {
    name: "goal-planner",
    description: "Fresh acceptance-contract planner",
    systemPrompt: "Define an immutable, testable goal contract. Never implement.",
    tools: ["read", "grep", "find", "ls", "verify_command"],
  },
  {
    name: "goal-worker",
    description: "Retained coding worker",
    systemPrompt: "Implement the supplied immutable contract. Return a completion candidate, never a verdict.",
    tools: ["read", "grep", "find", "ls", "worker_command", "edit", "write"],
  },
  {
    name: "goal-skeptic",
    description: "Fresh independent read-only verifier",
    systemPrompt: "Verify every criterion independently. Never mutate the workspace.",
    tools: ["read", "grep", "find", "ls", "verify_command"],
  },
  {
    name: "goal-strategist",
    description: "Fresh read-only remediation strategist",
    systemPrompt: "Change HOW, never WHAT. Never implement.",
    tools: ["read", "grep", "find", "ls", "verify_command"],
  },
] as const satisfies readonly (RuntimeAgentDefinition & { name: string })[];

function registerGoalAgents(pi: ExtensionAPI, verifierToolPath: string): (() => void)[] {
  const configuredExtensions = configuredGoalChildExtensions();
  const ownExtensionPath = fileURLToPath(import.meta.url);
  if (configuredExtensions.includes(ownExtensionPath)) {
    throw new Error("PI_GOAL_CHILD_EXTENSIONS must not include pi-grok-goal/src/index.ts; that would re-enable the parent extension inside goal children.");
  }
  const extensionPolicy = goalChildExtensionPolicy(verifierToolPath, configuredExtensions);
  return GOAL_AGENT_ROLES.map(({ name, ...definition }) => registerRuntimeAgent(pi, name, { ...definition, completionGuard: false, ...extensionPolicy }));
}

function registerRuntimeAgent(pi: ExtensionAPI, name: string, definition: RuntimeAgentDefinition): () => void {
  const request: { version: 1; name: string; definition: RuntimeAgentDefinition; result?: { ok: boolean; registration?: { dispose(): void }; error?: Error } } = {
    version: 1, name, definition,
  };
  pi.events.emit(REGISTER_AGENT, request);
  if (!request.result?.ok || !request.result.registration) throw request.result?.error ?? new Error("pi-subagents is not installed or not ready");
  return () => request.result?.registration?.dispose();
}

function roleModelsFromEnvironment(): { planner?: string; worker?: string; skeptic?: string; strategist?: string } {
  const fallback = process.env.PI_GOAL_MODEL?.trim() || undefined;
  const role = (name: string) => process.env[`PI_GOAL_${name}_MODEL`]?.trim() || fallback;
  return { planner: role("PLANNER"), worker: role("WORKER"), skeptic: role("SKEPTIC"), strategist: role("STRATEGIST") };
}

function statusText(goal?: ActiveGoal): string {
  if (!goal) return "Goal · inactive";
  const s = goal.snapshot;
  const lines = [`Goal · ${s?.status ?? "starting"}`, `  ${goal.objective}`];
  if (s?.workerIteration) lines.push(`  worker iteration ${s.workerIteration}`);
  if (s?.verificationAttempt) lines.push(`  verification round ${s.verificationAttempt}`);
  if (s?.priorVerificationGaps?.length) lines.push(`  ${s.priorVerificationGaps.length} open gap(s)`);
  if (s?.workerRunId) lines.push(`  worker ${s.workerRunId}`);
  if (s?.status === "complete") lines.push("  independently verified");
  if (s?.pauseReason) lines.push(`  ${s.pauseReason}`);
  return lines.join("\n");
}

export default function goalExtension(pi: ExtensionAPI) {
  // The adapter intentionally guards the exact version before any goal state
  // is read or runtime agents are registered. Mission APIs are private until
  // pi-subagents exposes an external mission-management seam.
  assertSupportedPiSubagentsVersion();
  let active: ActiveGoal | undefined;
  let disposers: (() => void)[] = [];
  let lastContext: ExtensionContext | undefined;

  const loadPersisted = async () => {
    if (!lastContext) return;
    const found = await findLatestGoalSnapshot(lastContext.cwd);
    if (!found || ["cancelled"].includes(found.snapshot.status)) return;
    active = { goalId: found.snapshot.goalId, generation: found.snapshot.generation, objective: found.snapshot.objective, missionId: found.missionId, snapshot: found.snapshot };
  };

  const launch = async (ctx: ExtensionContext, goal: ActiveGoal, resume: boolean) => {
    const budgets=goal.snapshot?.budgets??configuredBudgets();
    const params: Record<string, unknown> = {
      workflowScript: buildGoalWorkflow({
        goalId: goal.goalId,
        generation: goal.generation,
        objective: goal.objective,
        budgets,
        roleModels: roleModelsFromEnvironment(),
      }),
      cwd: ctx.cwd, async: true, context: "fresh",
      usageBudget: { tokens: { hard: budgets.tokenBudget } }, timeoutMs:budgets.wallClockMs,
      ...(resume && goal.missionId ? { missionId: goal.missionId } : { mission: { title: `Goal: ${goal.objective.slice(0, 120)}`, objective: goal.objective, goal:true, budget:{tokens:budgets.tokenBudget}, labels: ["pi-grok-goal", goal.goalId] } }),
    };
    if(process.env.PI_GOAL_MODEL) params.model=process.env.PI_GOAL_MODEL;
    if(resume&&goal.missionId&&goal.snapshot) await updateGoalMissionLifecycle(ctx.cwd,goal.missionId,{...goal.snapshot,status:"working"});
    const reply = await rpc(pi, "spawn", params);
    if (!reply.success) throw new Error(reply.error?.message ?? "Goal workflow launch failed");
    const details = reply.data?.details ?? {};
    goal.asyncRunId = String(details.id ?? details.runId ?? "") || undefined;
    goal.missionId = String(details.missionId ?? goal.missionId ?? "") || undefined;
    ctx.ui.notify(resume ? "Goal yeniden başlatıldı; retained worker korunuyor." : "Goal başlatıldı: planner sözleşmeyi oluşturuyor.", "info");
  };

  const persistControlState = async (ctx: ExtensionContext, goal: ActiveGoal, status: "paused"|"cancelled") => {
    if (!goal.missionId || !goal.snapshot) return;
    const snapshot = {...goal.snapshot,status,generation:goal.generation+1,pauseReason:status === "paused"?"Paused by user":"Cleared by user",updatedAt:new Date().toISOString()};
    goal.generation=snapshot.generation;
    goal.snapshot = snapshot;
    await persistGoalControlStateInStore(ctx.cwd, goal.missionId, snapshot);
  };

  pi.on("session_start", async (_event, ctx) => {
    lastContext = ctx;
    disposers.forEach((d) => d());
    const verifierToolPath=fileURLToPath(new URL("./verifier-tools.ts",import.meta.url));
    disposers = registerGoalAgents(pi, verifierToolPath);
    await loadPersisted();
  });

  pi.events.on(ASYNC_COMPLETE, async (raw) => {
    const data = raw as Record<string, unknown>;
    if (!active || (active.asyncRunId && data.runId !== active.asyncRunId)) return;
    await loadPersisted();
    const ctx = lastContext;
    if (ctx && active) {
      if(active.missionId&&active.snapshot) await updateGoalMissionLifecycle(ctx.cwd,active.missionId,active.snapshot);
      ctx.ui.notify(statusText(active), "info");
    }
  });

  pi.registerCommand("goal", {
    description: "Start or control a durable independently verified coding goal",
    handler: async (raw, ctx) => {
      lastContext = ctx;
      const args = raw.trim();
      try {
        if (!args || args === "status") { await loadPersisted(); ctx.ui.notify(statusText(active), "info"); return; }
        if (args === "pause") {
          if (!active) { ctx.ui.notify("Aktif goal yok.","warning"); return; }
          await loadPersisted(); await persistControlState(ctx,active,"paused");
          if(active.missionId&&active.snapshot) await updateGoalMissionLifecycle(ctx.cwd,active.missionId,active.snapshot);
          if (active.asyncRunId) await rpc(pi,"stop",{id:active.asyncRunId});
          ctx.ui.notify("Goal duraklatıldı; worker kimliği ve mission state korundu.","info"); return;
        }
        if (args === "resume") {
          await loadPersisted();
          if (!active || active.snapshot?.status === "complete") { ctx.ui.notify("Devam ettirilebilir goal yok.","warning"); return; }
          await launch(ctx,active,true); return;
        }
        if (args === "clear") {
          if (!active) { ctx.ui.notify("Aktif goal yok.","warning"); return; }
          await loadPersisted(); await persistControlState(ctx,active,"cancelled");
          if(active.missionId&&active.snapshot) await updateGoalMissionLifecycle(ctx.cwd,active.missionId,active.snapshot);
          if (active.asyncRunId) await rpc(pi,"stop",{id:active.asyncRunId});
          active=undefined;
          ctx.ui.notify("Goal iptal edildi; geç sonuçlar generation guard ile geçersiz.","info"); return;
        }
        if (active && !["complete","cancelled"].includes(active.snapshot?.status ?? "")) { ctx.ui.notify("Önce aktif goal'ü clear edin veya tamamlanmasını bekleyin.","warning"); return; }
        active={goalId:randomUUID(),generation:1,objective:args};
        await launch(ctx,active,false);
      } catch (error) { ctx.ui.notify(`Goal hatası: ${error instanceof Error ? error.message : String(error)}`,"error"); }
    },
  });

  pi.on("session_shutdown", () => { disposers.forEach((d) => d()); disposers=[]; });
}
