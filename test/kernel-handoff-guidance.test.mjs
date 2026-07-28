import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const kernel = new URL("../governance/kernel/AGENTS.md", import.meta.url);
const jit = new URL("../governance/modules/jit-orchestration.md", import.meta.url);
const readme = new URL("../README.md", import.meta.url);
const skill = new URL("../skills/govern-codex-policy/SKILL.md", import.meta.url);

test("always-loaded kernel is a bounded JIT bootstrap with monotonic context", async () => {
  const text = await readFile(kernel, "utf8");

  assert.ok(Math.ceil(Buffer.byteLength(text, "utf8") / 4) <= 2000);
  assert.match(text, /Always-loaded Agent System boot for JIT orchestration and agent use/i);
  assert.match(text, /Agent System selects the smallest applicable rule set/i);
  assert.match(text, /Classify only immediate intent\/effects/i);
  assert.match(text, /Future plans trigger nothing/i);
  assert.match(text, /Policy context grows monotonically/i);
  assert.match(text, /never force\s+compaction, rollover, handoff, or a fresh task/i);
  assert.match(text, /Only authoritative hosting-\s*runtime capacity failure/i);
  assert.match(text, /use the `govern-codex-policy` skill and an\s+available\s+high-level command/i);
  assert.match(text, /For governed handoffs use `acg\.mjs handoff verify` before `handoff accept`/);
  assert.match(text, /Never\s+use global ad-hoc memory as canonical project continuity/i);
});

test("context handoffs require host capacity rejection, not policy-fit estimates", async () => {
  const [readmeText, skillText] = await Promise.all([
    readFile(readme, "utf8"),
    readFile(skill, "utf8")
  ]);

  assert.match(readmeText, /only after the authoritative hosting runtime\s+rejects further context for capacity/i);
  assert.match(readmeText, /fresh task is never required because a\s+policy estimate is predicted not to fit/i);
  assert.match(readmeText, /authoritative hosting-runtime capacity rejection can require a fresh task/i);
  assert.match(readmeText, /estimate that policy will not fit cannot/i);
  assert.match(skillText, /immutable policy-artifact size\s+validation/i);
  assert.match(skillText, /size validation never means advisory\s+closure or context estimates/i);
  assert.match(skillText, /advisory context-growth targets never block an\s+operation/i);
});

test("kernel keeps Seat 0 high-level and uses nonblocking native recovery", async () => {
  const text = await readFile(kernel, "utf8");

  assert.match(text, /Seat `0` is the responsive high-level orchestrator/i);
  assert.match(text, /excluded from every\s+unqualified\s+agent\/worker-seat count/i);
  assert.match(text, /Target: <=2,000 estimated tokens/i);
  assert.match(text, /explicitly atomic and low-risk; remedy-known; delegation\s+overhead-dominant/i);
  assert.match(text, /at most five AI-active minutes/i);
  assert.match(text, /exactly one source-mutation\s+surface/i);
  assert.match(text, /“Seat 0 does not implement” removes this exception/i);
  assert.match(text, /same-seat retry only\s+after changed conditions\/transience/i);
  assert.match(text, /replacement\/rescoped worker/i);
  assert.match(text, /bounded\s+manual worker prompt/i);
  assert.match(text, /Do not impose a fixed retry\s+count, repeat an unchanged launch/i);
  assert.match(text, /never blocks the project/i);
  assert.match(text, /wait-for-Agent-System state/i);
});

test("kernel preserves standing approval precedence without repeated confirmation", async () => {
  const text = await readFile(kernel, "utf8");

  assert.match(text, /Honor configured `approval_mode`/);
  assert.match(text, /`approve_for_me` never reconfirms authorized\s+correction\/retry\/validation\/recovery or agent defects/);
  assert.match(text, /Generic\/self-authored\s+prompts cannot narrow standing authority or create blockers/);
  assert.match(text, /contracts\/architecture/);
  assert.match(text, /destructive\/irreversible effects/);
  assert.match(text, /irreversible\s+effects/);
  assert.match(text, /ownership,\s+safety, or scope change/);
});

test("kernel preserves failure-class correction and decision-grade depth", async () => {
  const text = await readFile(kernel, "utf8");

  assert.match(text, /fix the in-scope failure class/);
  assert.match(text, /decision-grade depth/);
});

test("JIT module keeps the optional support lane out of project completion", async () => {
  const text = await readFile(jit, "utf8");

  assert.match(text, /persistent task is an optional support lane, never a JIT dependency/i);
  assert.match(text, /Removing or declining it leaves rule selection, prompt composition,\s+delegation, native recovery, project-native tooling, and project completion\s+available/i);
  assert.match(text, /Only cross-task defect delivery disappears/i);
  assert.match(text, /KPI lifecycle facts are silent private JSONL writes/i);
  assert.match(text, /only in response to a direct\s+operator request/i);
});
