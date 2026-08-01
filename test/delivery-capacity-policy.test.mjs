import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { codeRoot } from "../lib/core.mjs";

function read(relativePath) {
  return fs.readFileSync(path.join(codeRoot, relativePath), "utf8");
}

test("global planning treats time, tokens, and worker seats as the delivery triad", () => {
  const policy = read("governance/modules/planning-and-capacity.md");
  assert.match(policy, /delivery triad/);
  assert.match(policy, /safely verified critical-path time/);
  assert.match(policy, /tokens, context, coordination, and synthesis as cost/);
  assert.match(policy, /delegated worker seats as resources/);
  assert.match(policy, /largest useful independent set/);
  assert.match(policy, /Safety, isolation, dependency order, validation, repair capacity, and evidence dominate speed/);
});

test("policy accounting grows monotonically without imposing a context rollover", () => {
  const kernel = read("governance/kernel/AGENTS.md");
  const skill = read("skills/govern-codex-policy/SKILL.md");
  const skillAgent = read("skills/govern-codex-policy/agents/openai.yaml");
  assert.match(kernel, /Policy context grows monotonically/);
  assert.match(kernel, /Totals never force compaction, rollover,\s+handoff, or fresh task/i);
  assert.match(kernel, /only\s+authoritative hosting-runtime capacity failure may require transition/u);
  assert.match(skill, /Estimated policy totals never force rollover or handoff/);
  assert.match(skill, /Advisory context-growth targets never block an operation/);
  assert.doesNotMatch(skill, /policy context budget overflow/);
  assert.match(skillAgent, /monotonic context growth without governance-imposed rollover/);
  assert.doesNotMatch(skillAgent, /stop before overflow/);
});

test("AI-native estimates stay separate from conventional human effort", () => {
  const policy = read("governance/modules/planning-and-capacity.md");
  assert.match(policy, /separate Proposed conventional human effort from AI execution/);
  assert.match(policy, /explicit operator-supplied\s+human-to-AI compression calibration/u);
  assert.match(policy, /53x calibration divides the human-active portion by 53/u);
  assert.match(policy, /adds serial build, deployment, validation, browser, model-latency, and\s+operator-wait floors separately/u);
  assert.match(policy, /P50\/P80 wall clock, critical path, seat-hours/);
  assert.match(policy, /manual-equivalent P50\/P80, rework, confidence/);
  assert.match(policy, /Unknowns remain null/);
  assert.match(policy, /never reduce the result to a human sprint label or let observed metrics govern execution/);
  assert.doesNotMatch(policy, /divide by `5`|fivefold/);
});

test("delegation defaults to the largest useful isolated lifecycle without rewarding raw seat count", () => {
  const policy = read("governance/modules/delegation.md");
  assert.match(policy, /Default parallel delivery lifecycle/);
  assert.match(policy, /decompose before launch/);
  assert.match(policy, /largest useful set of non-overlapping independent lanes within available\s+capacity/);
  assert.match(policy, /Run separable implementation, test, and review lanes concurrently/);
  assert.match(policy, /create and verify one isolated branch\/worktree\s+for that worker/);
  assert.match(policy, /Seat `0` accepts and integrates candidate work, then runs\s+authoritative validation against that integrated candidate/);
  assert.match(policy, /keep only ordered dependencies and shared-contract decisions serial/);
  assert.match(policy, /unsafe overlap, unavailable capacity or tooling/);
  assert.match(policy, /coordination cost truly erases the benefit/);
  assert.match(policy, /When useful capacity remains idle, state the material\s+constraint/);
  assert.match(policy, /Topology is JIT launch-order metadata[\s\S]*?does not load broader context[\s\S]*?persistent workflow state machine/i);
  assert.match(policy, /dependency confidence is\s+insufficient[\s\S]*?SERIAL[\s\S]*?EXPLORATORY/i);
});

test("default mutating delivery loop is decompose, reserve, isolate, work, integrate, then validate", () => {
  const policy = read("governance/modules/delegation.md");
  const role = read("docs/agent-system-role.md");
  const requiredLoop = /decompose[\s\S]{0,900}?reserve[\s\S]{0,900}?(?:independent|non-overlapping)\s+lanes[\s\S]{0,900}?(?:isolated\s+(?:branch\s*\/\s*)?worktree|branch\s*\/\s*worktree)[\s\S]{0,900}?(?:worker|mutating\s+worker)[\s\S]{0,900}?(?:implement|work)[\s\S]{0,900}?(?:local\s+tests?|test)[\s\S]{0,900}?Seat\s*`?0`?[\s\S]{0,900}?(?:integrat|accept)[\s\S]{0,900}?(?:authoritative|project-authoritative)\s+validation[\s\S]{0,900}?(?:integrated\s+candidate|integration)/i;
  assert.match(policy, requiredLoop);
  assert.match(role, requiredLoop);
});

test("mutating worker isolation remains mandatory despite read-only or equivalent non-Git exceptions", () => {
  const policy = read("governance/modules/delegation.md");
  const jit = read("governance/modules/jit-orchestration.md");
  const role = read("docs/agent-system-role.md");
  for (const text of [policy, jit, role]) {
    assert.match(text, /mutating\s+worker[\s\S]{0,500}?(?:isolated\s+(?:branch\s*\/\s*)?worktree|branch\s*\/\s*worktree)/i);
    assert.match(text, /(?:never|cannot)\s+merge[\s\S]{0,180}?(?:integrat|shared\s+primary\s+worktree)/i);
    assert.match(text, /Seat\s*`?0`?[\s\S]{0,260}?(?:alone|owns)[\s\S]{0,260}?integrat/i);
  }
  for (const text of [policy, jit]) {
    assert.match(text, /read-only[\s\S]{0,700}?(?:exception|non-Git|equivalent)[\s\S]{0,700}?(?:does not|never)\s+weaken[\s\S]{0,700}?mutating[\s\S]{0,400}?(?:Git\s+)?isolation/i);
  }
});

test("branch disjointness is not a parallelism proof", () => {
  const policy = read("governance/modules/delegation.md");
  const jit = read("governance/modules/jit-orchestration.md");
  const role = read("docs/agent-system-role.md");
  for (const text of [policy, jit, role]) {
    assert.match(text, /(?:disjoint\s+(?:files?|branches?)|branch\s+disjointness)[\s\S]{0,500}?(?:does\s+not|never)\s+(?:prove|imply)[\s\S]{0,500}?PARALLEL/i);
    assert.match(text, /(?:logical\s+dependenc(?:y|ies)|integration\s+contract)[\s\S]{0,400}?(?:PIPELINED|SERIAL|EXPLORATORY)/i);
  }
});

test("one shared-invariant defect cluster has one mutating worker before pipelined adversarial verification", () => {
  const policy = read("governance/modules/delegation.md");
  const role = read("docs/agent-system-role.md");
  const readme = read("README.md");
  assert.match(policy, /shared root cause, invariant, or ownership boundary/i);
  assert.match(policy, /same-file\/overlapping-ownership signals/i);
  assert.match(policy, /`SERIAL`[\s\S]{0,180}?exactly one mutating worker/i);
  assert.match(policy, /sole worker commits its locally validated candidate[\s\S]{0,220}?`PIPELINED` read-only adversarial verifier/i);
  assert.match(policy, /verifier[\s\S]{0,300}?cannot change[\s\S]{0,300}?(?:source|Git)/i);
  assert.match(policy, /`PARALLEL` only applies to distinct clusters[\s\S]{0,300}?independently\s+implementable,\s+testable,\s+committable,\s+and\s+integrable/i);
  for (const text of [role, readme]) {
    assert.match(text, /shar(?:ed|ing)[\s\S]{0,120}?(?:invariant|ownership boundary)[\s\S]{0,240}?exactly one\s+mutating\s+worker[\s\S]{0,240}?`PIPELINED` read-only\s+adversarial\s+verifier/i);
  }
  assert.match(policy, /not a\s+scheduler state machine or new subsystem/i);
});

test("Seat 0 permits only a pre-estimated atomic five-minute correction", () => {
  const policy = read("governance/modules/delegation.md");
  assert.match(policy, /cannot receive a worker assignment/);
  assert.match(policy, /one genuinely atomic, bounded correction/);
  assert.match(policy, /estimated before start at no more than five AI-active minutes/);
  assert.match(policy, /delegation overhead dominates/);
});

test("Seat 0 delegates mandatory categories and stops rather than fragmenting work", () => {
  const policy = read("governance/modules/delegation.md");
  assert.match(policy, /Delegate when work exceeds five minutes, scope is uncertain, surfaces or risk are multiple/);
  assert.match(policy, /browser, build, test, deploy, or validation execution/);
  assert.match(policy, /explicit or already established/);
  assert.match(policy, /Do not split or chain micro-edits to evade this rule/);
  assert.match(policy, /elapsed time or scope crosses five minutes, stop at a safe boundary and delegate/);
});

test("stricter Seat 0 instructions override the direct-implementation exception", () => {
  const policy = read("governance/modules/delegation.md");
  assert.match(policy, /stricter direct user or project instruction/);
  assert.match(policy, /Seat 0 does not implement/);
  assert.match(policy, /overrides this exception/);
});

test("model routing uses the lowest reliable model and reasoning tier", () => {
  const routing = read("governance/modules/model-routing.md");
  const delegation = read("governance/modules/delegation.md");
  assert.match(routing, /lowest-capability family and lowest reasoning level/);
  assert.match(routing, /Escalate only for a documented risk or failure mode/);
  assert.match(delegation, /Never silently downgrade an exact or reasoning-critical assignment/);
  assert.doesNotMatch(delegation, /recommend `medium`, `high`, or `xhigh`/);
});

test("architectural hardening status is defect-cluster and gate first, with percentage secondary", () => {
  const skill = read("skills/govern-codex-policy/SKILL.md");
  const planning = read("governance/modules/planning-and-capacity.md");
  const role = read("docs/agent-system-role.md");
  const readme = read("README.md");
  for (const text of [skill, planning, role, readme]) {
    assert.match(text, /(?:blocking\s+)?(?:independent\s+)?defect\s+clusters/i);
    assert.match(text, /current cluster/i);
    assert.match(text, /`PASS`[\s\S]{0,80}?`FAIL`[\s\S]{0,80}?`RUNNING`[\s\S]{0,80}?`BLOCKED`[\s\S]{0,80}?`UNVERIFIED`/);
    assert.match(text, /regression trend/i);
    assert.match(text, /remaining\s+release\s+work/i);
    assert.match(text, /(?:ranged|range|assumption-bounded)[\s\S]{0,160}?AI-active/i);
    assert.match(text, /(?:deployment\/browser\s+latency[\s\S]{0,120}?(?:separately|separate|when applicable)|(?:separately|separate)[\s\S]{0,120}?deployment\/browser\s+latency)/i);
    assert.match(text, /percentage[\s\S]{0,180}?(?:optional secondary|secondary context)/i);
  }
  assert.match(skill, /Never give unadjusted human time, clock promises, or filler/);
  assert.match(planning, /gate-derived[\s\S]{0,160}?percentage[\s\S]{0,160}?never substitutes/i);
});

test("confirmed pre-hook tasks adopt current policy without making Agent System a project dependency", () => {
  const skill = read("skills/govern-codex-policy/SKILL.md");
  const jit = read("governance/modules/jit-orchestration.md");
  assert.match(skill, /This adopts current policy,\s+skill, role, and helpers in the same task/u);
  assert.match(skill, /Require a fresh handoff only for that dependency/u);
  assert.match(jit, /failure blocks only the\s+affected path/u);
  assert.match(jit, /continue immediately\s+through any safe available option/u);
  assert.match(jit, /No fallback grants Seat `0` substantial\s+implementation, missing project\s+authority, destructive authority/u);
  assert.match(jit, /Agent System failure never\s+blocks the project/u);
  assert.match(skill, /context adopt-current --operator-confirmed-pre-hook/);
  assert.match(skill, /Continue same-task work and legacy agents by default/);
  assert.match(skill, /Launch-time hook and host-interception enforcement remain Unverified/);
  assert.match(jit, /failed topology helper or classifier[\s\S]*?bounded manual or native worker fallback/i);
  assert.match(jit, /does not block the project/i);
});
