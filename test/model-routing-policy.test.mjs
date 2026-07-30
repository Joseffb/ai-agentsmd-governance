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

test("Spark is mandatory only for composer-derived mechanical AI transformation work", () => {
  assert.match(policy, /mandatory only for composer-derived `mechanical` bounded delegated AI transformation or mechanical-edit work/);
  assert.match(policy, /`gpt-5\.3-codex-spark` with `low` reasoning/);
  assert.match(policy, /## Subagent Assignment\s+### Spark-Eligible Bounded Delegated Work/);
  assert.match(policy, /only the exact `mechanical` complexity\s+class may produce/i);
  assert.match(policy, /content-addressed bundle, worker\s+request, and prompt envelope/);
  assert.match(policy, /integrity-bound Model\s+Routing Gate must verify that composer-derived request before launch/);
  assert.match(policy, /bounded delegated AI transformation or\s+mechanical-edit worker/i);
  assert.match(policy, /inventory collection, calculation, test execution, validation, provenance,\s+state, and rendering remain deterministic code, tools, or data/i);
  assert.doesNotMatch(policy, /model-operated inventories|focused deterministic test execution/);
  assert.match(policy, /must never retrieve or\s+overwrite the authoritative mechanical data/i);
  assert.match(policy, /architecture, contracts,\s+authentication, security, privacy, migrations, ambiguous debugging,\s+integration or conflict resolution, release or acceptance work, or a final\s+verdict/i);
  assert.match(policy, /no-guess launch path is exact:\s+`orchestrate next` -> `orchestrate launch --bundle <path> --seat <N>`/i);
  assert.match(policy, /pass\s+the returned `native_quarantine\.spawn_request` verbatim -> attest -> send the\s+returned\s+`admitted_assignment\.message` verbatim as a new turn/i);
  assert.match(policy, /currently supported conservative Spark fallback is `gpt-5\.6-terra` with\s+`low` reasoning only when the composer state is exactly\s+`unknown_or_unexposed` and `availability_evidence` is `Unverified`/i);
  assert.match(policy, /`authoritatively_unavailable` and `separate_pool_exhausted` are reserved state\s+names and fail closed at launch until a supported host capability receipt\s+provides authoritative availability evidence/i);
  assert.match(policy, /An unverified claim of either\s+reserved state is not permission to launch Terra/i);
  assert.match(policy, /Never move the work to Seat\s+`0`/);
  assert.match(policy, /block only the affected launch and continue the project through another\s+safe supported path/i);
  assert.match(policy, /actual\s+model and reasoning as `Unverified`/i);
  assert.match(policy, /missing, altered, or non-matching composer request is\s+inadmissible for that Spark launch/i);
});
