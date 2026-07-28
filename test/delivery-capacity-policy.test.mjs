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
  assert.match(kernel, /never.*force compaction, rollover, handoff, or a fresh task/s);
  assert.match(kernel, /Only an authoritative hosting-runtime capacity failure can require a bounded\s+context transition/u);
  assert.match(kernel, /they never force compaction, rollover, handoff, or a fresh task/);
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

test("delegation maximizes useful concurrency without rewarding raw seat count", () => {
  const policy = read("governance/modules/delegation.md");
  assert.match(policy, /use maximum useful concurrency/);
  assert.match(policy, /Fill available worker capacity/);
  assert.match(policy, /keep ordered dependencies and shared-contract decisions serial/);
  assert.match(policy, /duplicate discovery, overlapping writes/);
  assert.match(policy, /coordination, synthesis, and validation cost erases the benefit/);
  assert.match(policy, /safe beneficial parallel work is left idle, state the concrete constraint/);
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

test("operator progress is significant, gate-derived, and estimated in AI time", () => {
  const skill = read("skills/govern-codex-policy/SKILL.md");
  const metrics = read("docs/agent-metrics.md");
  const readme = read("README.md");
  assert.match(skill, /update only at phase boundaries/);
  assert.match(skill, /State phase, gate-derived percent \(else `Unknown`\)/);
  assert.match(skill, /ranged `Estimated` AI-active time with basis and confidence/);
  assert.match(skill, /Never give unadjusted human time, clock promises, or filler/);
  assert.match(skill, /Keep the initial completion window beside current P50\/P80 ETA/);
  assert.match(metrics, /A target that advances by hours during only\s+minutes of execution is a forecast revision/);
  assert.match(metrics, /midpoint nevertheless moved\s+from 11 hours to 5\.5 hours/);
  assert.match(readme, /gate-derived percentage \(or\s+`Unknown`\)/);
  assert.match(readme, /conventional human P50\/P80 effort separate from AI wall-clock/);
});

test("confirmed pre-hook tasks adopt current policy without making Agent System a project dependency", () => {
  const skill = read("skills/govern-codex-policy/SKILL.md");
  const jit = read("governance/modules/jit-orchestration.md");
  assert.match(skill, /This adopts current policy,\s+skill, role, and helpers in the same task/u);
  assert.match(skill, /Require a fresh handoff only for that dependency/u);
  assert.match(jit, /failure blocks only the\s+affected path/u);
  assert.match(jit, /continue immediately\s+through any safe available option/u);
  assert.match(jit, /No fallback grants Seat `0` substantial\s+implementation, missing project authority, destructive authority/u);
  assert.match(jit, /Agent System failure never blocks the project/u);
  assert.match(skill, /context adopt-current --operator-confirmed-pre-hook/);
  assert.match(skill, /Continue same-task work and legacy agents by default/);
  assert.match(skill, /Launch-time hook and host-interception enforcement remain Unverified/);
});
