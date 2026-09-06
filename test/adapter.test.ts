import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSupportedPiSubagentsVersion,
  configuredGoalChildExtensions,
  goalChildExtensionPolicy,
  SUPPORTED_PI_SUBAGENTS_VERSION,
} from "../src/pi-subagents-adapter.ts";

test("adapter rejects unreviewed pi-subagents versions before private mission APIs are used", () => {
  assert.doesNotThrow(() => assertSupportedPiSubagentsVersion(SUPPORTED_PI_SUBAGENTS_VERSION));
  assert.throws(() => assertSupportedPiSubagentsVersion("0.65.2"), /supports pi-subagents 0\.65\.1 exactly/);
});

test("goal child extension policy disables ambient discovery and preserves only verifier tools", () => {
  const policy = goalChildExtensionPolicy("/package/verifier-tools.ts", ["/provider/model.ts", "/provider/model.ts"]);
  assert.deepEqual(policy, {
    extensions: ["/provider/model.ts"],
    subagentOnlyExtensions: ["/package/verifier-tools.ts"],
  });
  assert.deepEqual(goalChildExtensionPolicy("/package/verifier-tools.ts"), {
    extensions: [],
    subagentOnlyExtensions: ["/package/verifier-tools.ts"],
  });
});

test("configured child extension allowlist is explicit, trimmed, and deduplicated", () => {
  assert.deepEqual(configuredGoalChildExtensions(" /provider/a.ts, ,/provider/b.ts,/provider/a.ts "), ["/provider/a.ts", "/provider/b.ts"]);
  assert.deepEqual(configuredGoalChildExtensions("  "), []);
});
