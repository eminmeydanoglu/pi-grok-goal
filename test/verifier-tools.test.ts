import assert from "node:assert/strict";
import test from "node:test";
import { sandboxPreflightError, verifierBubblewrapArgs, verifierNetworkEnabled } from "../src/verifier-tools.ts";

test("verifier network is isolated unless explicitly opted in",()=>{
  assert.equal(verifierNetworkEnabled({}),false);
  assert.equal(verifierNetworkEnabled({PI_GOAL_VERIFIER_NETWORK:"true"}),false);
  assert.equal(verifierNetworkEnabled({PI_GOAL_VERIFIER_NETWORK:"1"}),true);

  const isolated=verifierBubblewrapArgs("/workspace","node",["--version"],false);
  assert.match(isolated.join(" "),/--unshare-all/);
  assert.doesNotMatch(isolated.join(" "),/--share-net/);
  assert.deepEqual(isolated.slice(-3),["--","node","--version"]);

  const networked=verifierBubblewrapArgs("/workspace","node",["--version"],true);
  assert.ok(networked.includes("--share-net"));
});

test("sandbox preflight fails clearly off Linux",()=>{
  assert.equal(sandboxPreflightError("linux"),undefined);
  assert.match(sandboxPreflightError("darwin")??"",/require Linux/);
});
