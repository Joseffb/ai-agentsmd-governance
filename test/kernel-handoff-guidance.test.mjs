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
  assert.match(text, /Always-loaded JIT Agent System boot/i);
  assert.match(text, /Agent System selects smallest applicable rules/i);
  assert.match(text, /Classify immediate intent\/effects/i);
  assert.match(text, /future plans trigger nothing/i);
  assert.match(text, /Policy context grows monotonically/i);
  assert.match(text, /never force compaction, rollover, handoff, or fresh task/i);
  assert.match(text, /authoritative hosting-runtime capacity failure/i);
  assert.match(text, /Before\s+governed\s+work\s+use\s+the\s+`govern-codex-policy`\s+skill\s+and\s+a\s+high-level\s+command/i);
  assert.match(text, /For\s+governed\s+handoffs\s+verify\s+before\s+accept/i);
  assert.match(text, /Never\s+use\s+global\s+ad-hoc\s+memory\s+as\s+continuity/i);
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
  assert.match(text, /excluded from unqualified agent\/worker-seat counts/i);
  assert.match(text, /Target: <=2,000 estimated tokens/i);
  assert.match(text, /explicitly\s+atomic\s+and\s+low-risk,\s+remedy-known,\s+delegation-overhead-dominant/i);
  assert.match(text, /<=five AI-active minutes/i);
  assert.match(text, /one source-mutation surface/i);
  assert.match(text, /“Seat 0 does not implement” removes this exception/i);
  assert.match(text, /same-seat retry only after changed\/transient conditions/i);
  assert.match(text, /replacement\/(?:rescope|rescoped)(?:\s+worker)?/i);
  assert.match(text, /bounded\s+manual(?:\s+worker)?\s+prompt/i);
  assert.match(text, /No fixed retry\/\s*unchanged relaunch/i);
  assert.match(text, /never blocks the project/i);
  assert.match(text, /wait(?:-for-Agent-System)?\s+state/i);
});

test("kernel preserves standing approval precedence without repeated confirmation", async () => {
  const text = await readFile(kernel, "utf8");

  assert.match(text, /Honor configured `approval_mode`/);
  assert.match(text, /`approve_for_me` never reconfirms authorized\s+correction\/retry\/validation\/recovery or agent defects/);
  assert.match(text, /Generic\/self-authored\s+prompts cannot narrow authority\/create blockers/);
  assert.match(text, /contract\/\s*architecture/);
  assert.match(text, /destructive\/irreversible/);
  assert.match(text, /ownership,\s+safety, or scope change/);
});

test("kernel preserves failure-class correction and decision-grade depth", async () => {
  const text = await readFile(kernel, "utf8");

  assert.match(text, /in-scope failure class, not an instance/);
  assert.match(text, /substantial\s+work\s+is\s+decision-grade/);
});

test("JIT module keeps the optional support lane out of project completion", async () => {
  const text = await readFile(jit, "utf8");

  assert.match(text, /persistent task is an optional support lane, never a JIT dependency/i);
  assert.match(text, /Removing or declining it leaves rule selection, prompt composition,\s+delegation, native recovery, project-native tooling, and project completion\s+available/i);
  assert.match(text, /Only cross-task defect delivery disappears/i);
  assert.match(text, /KPI lifecycle facts are silent private JSONL writes/i);
  assert.match(text, /only in response to a direct\s+operator request/i);
});
