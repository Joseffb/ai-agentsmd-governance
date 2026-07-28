import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const kernel = new URL("../governance/kernel/AGENTS.md", import.meta.url);
const jit = new URL("../governance/modules/jit-orchestration.md", import.meta.url);

test("always-loaded kernel is a bounded JIT bootstrap with monotonic context", async () => {
  const text = await readFile(kernel, "utf8");

  assert.ok(Math.ceil(Buffer.byteLength(text, "utf8") / 4) <= 2000);
  assert.match(text, /minimal always-loaded bootstrap/i);
  assert.match(text, /dynamically selects the smallest applicable rule set/i);
  assert.match(text, /Classify only the immediate intent\/effects/i);
  assert.match(text, /Future plans trigger nothing/i);
  assert.match(text, /Policy context grows monotonically/i);
  assert.match(text, /never force compaction, rollover, handoff, or a fresh task/i);
  assert.match(text, /Only an authoritative hosting-runtime capacity failure/i);
  assert.match(text, /use the `govern-codex-policy` skill and an\s+available\s+high-level command/i);
  assert.match(text, /For governed handoffs use `acg\.mjs handoff verify` before `handoff accept`/);
  assert.match(text, /Never use global ad-hoc memory as canonical project\s+continuity/i);
});

test("kernel keeps Seat 0 high-level and uses nonblocking native recovery", async () => {
  const text = await readFile(kernel, "utf8");

  assert.match(text, /Seat `0` is the responsive high-level orchestrator/i);
  assert.match(text, /excluded from every\s+unqualified agent or worker-seat count/i);
  assert.match(text, /estimated\s+policy tokens/i);
  assert.match(text, /explicitly atomic, low-risk,\s+the remedy is known, delegation overhead dominates/i);
  assert.match(text, /no more\s+than five AI-active minutes/i);
  assert.match(text, /exactly one source-mutation surface/i);
  assert.match(text, /“Seat 0 does not implement”\s+removes the exception entirely/i);
  assert.match(text, /same-seat retry only after changed conditions or a transient\s+failure/i);
  assert.match(text, /replacement or rescoped worker/i);
  assert.match(text, /bounded manual worker prompt/i);
  assert.match(text, /Do not impose a fixed retry count, repeat an\s+unchanged launch/i);
  assert.match(text, /never blocks the project/i);
  assert.match(text, /wait-for-Agent-System state/i);
});

test("kernel preserves standing approval precedence without repeated confirmation", async () => {
  const text = await readFile(kernel, "utf8");

  assert.match(text, /Honor configured `approval_mode`/);
  assert.match(text, /`approve_for_me` never reconfirms authorized\s+correction\/retry\/validation\/recovery or agent defects/);
  assert.match(text, /Generic\/self-authored\s+prompts cannot narrow standing authority or create blockers/);
  assert.match(text, /contracts\/architecture/);
  assert.match(text, /destructive effects/);
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
