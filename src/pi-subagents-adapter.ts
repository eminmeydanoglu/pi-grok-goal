/**
 * Compatibility boundary for pi-subagents mission persistence.
 *
 * pi-subagents currently has no public mission state RPC for an independent
 * extension. Keep the necessary private imports and their 0.65.1 assumptions
 * here, so the rest of this package has one replaceable seam when upstream
 * exposes one.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GoalSnapshot } from "./types.ts";

export const SUPPORTED_PI_SUBAGENTS_VERSION = "0.65.1";

type MissionStoreConfig = {
  enabled?: boolean;
  directory?: string;
  globalIndex?: boolean;
  globalIndexDir?: string;
  retainTerminal?: number;
};

type MissionStoreLocation = unknown;

type MissionStoreApi = {
  resolveMissionStoreLocation(input: { projectRoot: string; config?: MissionStoreConfig }): MissionStoreLocation;
  validateMissionStoreConfig(value: unknown, label?: string): MissionStoreConfig | undefined;
  updateMission(location: MissionStoreLocation, id: string, update: Record<string, unknown>): unknown;
};

type MissionWorkflowStateApi = {
  createMissionWorkflowState(location: MissionStoreLocation, id: string): {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  missionStatePath(location: MissionStoreLocation, id: string): string;
};

interface PiSubagentsInternals {
  store: MissionStoreApi;
  workflowState: MissionWorkflowStateApi;
}

function packageRoot(): string {
  return dirname(fileURLToPath(import.meta.resolve("pi-subagents")));
}

/** Throws before private APIs are used if the pinned compatibility contract changed. */
export function assertSupportedPiSubagentsVersion(version?: string): void {
  const installed = version ?? JSON.parse(
    // package.json is intentionally read relative to the resolved package
    // entrypoint because the package does not export its manifest.
    requireManifest(),
  ).version;
  if (installed !== SUPPORTED_PI_SUBAGENTS_VERSION) {
    throw new Error(
      `pi-grok-goal supports pi-subagents ${SUPPORTED_PI_SUBAGENTS_VERSION} exactly; found ${String(installed)}. ` +
      "Refusing to use private mission persistence internals with an unverified version.",
    );
  }
}

function requireManifest(): string {
  // Keeping the package manifest path in this small function makes the
  // otherwise synchronous guard easy to test and keeps this assumption local.
  return readFileSync(`${packageRoot()}/package.json`, "utf8");
}

let internalsPromise: Promise<PiSubagentsInternals> | undefined;

async function internals(): Promise<PiSubagentsInternals> {
  assertSupportedPiSubagentsVersion();
  internalsPromise ??= Promise.all([
    import(new URL("./src/missions/store.ts", import.meta.resolve("pi-subagents")).href),
    import(new URL("./src/missions/workflow-state.ts", import.meta.resolve("pi-subagents")).href),
  ]).then(([store, workflowState]) => {
    if (
      typeof store.resolveMissionStoreLocation !== "function" ||
      typeof store.validateMissionStoreConfig !== "function" ||
      typeof store.updateMission !== "function" ||
      typeof workflowState.createMissionWorkflowState !== "function" ||
      typeof workflowState.missionStatePath !== "function"
    ) {
      throw new Error("pi-subagents 0.65.1 mission internals do not match the expected compatibility contract.");
    }
    return { store: store as MissionStoreApi, workflowState: workflowState as MissionWorkflowStateApi };
  });
  return internalsPromise;
}

async function locationFor(cwd: string): Promise<{ api: PiSubagentsInternals; location: MissionStoreLocation }> {
  const api = await internals();
  // 0.65.1's loadConfig() reads exactly this agent-dir config path. We read
  // only its missions object and still give it to pi-subagents' own validator
  // and resolver, so missions.directory and project-relative paths are not
  // reimplemented. Importing extension/config.ts here is unsafe: it imports a
  // TUI peer that package consumers do not necessarily install.
  const config = configuredMissionStore(api.store);
  return { api, location: api.store.resolveMissionStoreLocation({ projectRoot: cwd, ...(config ? { config } : {}) }) };
}

function configuredMissionStore(store: MissionStoreApi): MissionStoreConfig | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(agentDir(), "extensions", "subagent", "config.json"), "utf8")) as { missions?: unknown };
    return store.validateMissionStoreConfig(parsed.missions, "config.missions");
  } catch {
    // Matches pi-subagents loadConfig() fallback for ordinary malformed/missing
    // configuration rather than making /goal status fail.
    return undefined;
  }
}

function agentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR;
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  if (configured === "~") return home;
  if (configured?.startsWith("~/") || configured?.startsWith("~\\")) return join(home, configured.slice(2));
  return configured || join(home, ".pi", "agent");
}

export async function findLatestGoalSnapshot(cwd: string): Promise<{ snapshot: GoalSnapshot; missionId: string } | undefined> {
  const { api, location } = await locationFor(cwd);
  const missionDir = (location as { missionDir?: unknown }).missionDir;
  if (typeof missionDir !== "string" || !existsSync(missionDir)) return undefined;

  let latest: { snapshot: GoalSnapshot; missionId: string; mtime: number } | undefined;
  for (const missionId of readdirSync(missionDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
    try {
      const statePath = api.workflowState.missionStatePath(location, missionId);
      if (!existsSync(statePath)) continue;
      const state = api.workflowState.createMissionWorkflowState(location, missionId);
      const goal = state.get("goal");
      if (!isGoalSnapshot(goal)) continue;
      const mtime = statSync(statePath).mtimeMs;
      if (!latest || mtime > latest.mtime) latest = { snapshot: goal, missionId, mtime };
    } catch {
      // A different extension's stale/corrupt mission record must not prevent
      // this extension from restoring a valid goal.
    }
  }
  return latest && { snapshot: latest.snapshot, missionId: latest.missionId };
}

function isGoalSnapshot(value: unknown): value is GoalSnapshot {
  return Boolean(value && typeof value === "object" && (value as { version?: unknown }).version === 1);
}

export async function persistGoalControlState(cwd: string, missionId: string, snapshot: GoalSnapshot): Promise<void> {
  const { api, location } = await locationFor(cwd);
  api.workflowState.createMissionWorkflowState(location, missionId).set("goal", snapshot);
}

export async function updateGoalMissionLifecycle(cwd: string, missionId: string, snapshot: GoalSnapshot): Promise<void> {
  const { api, location } = await locationFor(cwd);
  if (snapshot.status === "complete") api.store.updateMission(location, missionId, { status: "completed", goal: false, summary: "Goal independently verified" });
  else if (snapshot.status === "cancelled") api.store.updateMission(location, missionId, { status: "cancelled", goal: false, summary: "Goal cleared by user" });
  else if (["paused", "no-progress", "infra-paused", "budget-limited", "blocked"].includes(snapshot.status)) api.store.updateMission(location, missionId, { status: "waiting", goal: { status: "paused" }, summary: snapshot.pauseReason ?? snapshot.status });
  else api.store.updateMission(location, missionId, { status: "active", goal: { status: "active" } });
}

/**
 * Explicit `extensions: []` prevents background children from rediscovering
 * this parent extension. `subagentOnlyExtensions` then adds only the verifier
 * tool extension required by these roles.
 *
 * A provider implemented as a Pi extension is deliberately not ambient here.
 * Its path must be supplied explicitly through PI_GOAL_CHILD_EXTENSIONS.
 */
export function goalChildExtensionPolicy(verifierToolPath: string, configuredExtensions: readonly string[] = []): {
  extensions: string[];
  subagentOnlyExtensions: string[];
} {
  return {
    extensions: [...new Set(configuredExtensions)],
    subagentOnlyExtensions: [verifierToolPath],
  };
}

export function configuredGoalChildExtensions(raw = process.env.PI_GOAL_CHILD_EXTENSIONS): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
}
