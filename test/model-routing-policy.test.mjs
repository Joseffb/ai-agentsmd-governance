import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const policy = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "governance", "modules", "model-routing.md"),
  "utf8"
);

test("model routing prohibits Fast mode without restricting reasoning selection", () => {
  assert.match(policy, /Use standard mode/);
  assert.match(policy, /Never enable, request, or recommend Fast mode/);
  assert.match(policy, /does not restrict explicit model-family or reasoning selection/);
  assert.match(policy, /Bias against `ultra` reasoning/);
  assert.match(policy, /First re-prompt or clarify/);
  assert.match(policy, /independent `xhigh` evaluation/);
  assert.match(policy, /material blocker/);
  assert.match(policy, /why `xhigh` is insufficient/);
  assert.match(policy, /token, compute, and cost footprint/);
  assert.match(policy, /exact incident/);
  assert.match(policy, /prior agreement does not carry forward/);
});

test("native collaboration compatibility keeps bypass evidence nonblocking", () => {
  assert.match(policy, /Native collaboration interception is capability-dependent/);
  assert.match(policy, /not a universal expectation for every host/);
  assert.match(policy, /normal workers may still proceed with explicit model and reasoning requests/i);
  assert.match(policy, /report `Actual model: Unverified`/);
  assert.match(policy, /Set `model_critical:false` by default/);
  assert.match(policy, /mutating model-critical seat.*hook-covered path or an operator-approved redesign/is);
  assert.match(policy, /continue unrelated work/i);
  assert.match(policy, /telemetry that this path is not hook-gated/);
  assert.match(policy, /never stops the project/i);
});
