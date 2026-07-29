import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const kernel = new URL("../governance/kernel/AGENTS.md", import.meta.url);
const continuity = new URL("../governance/modules/continuity.md", import.meta.url);
const role = new URL("../docs/agent-system-role.md", import.meta.url);
const skill = new URL("../skills/govern-codex-policy/SKILL.md", import.meta.url);

test("kernel distinguishes human and agent communication without exceeding its budget", async () => {
  const text = await readFile(kernel, "utf8");

  assert.ok(Math.ceil(Buffer.byteLength(text, "utf8") / 4) <= 2000);
  assert.match(text, /Human-facing: BLUF\/Pyramid Principle\/progressive disclosure\/\s+plain-language design/i);
  assert.match(text, /Answer→Why→Cost→Risk→Next step when relevant/i);
  assert.match(text, /no empty headings\/bloat/i);
  assert.match(text, /Agent-to-agent exception: token-compressed\/meaning-dense\/loss-minimizing\/exact\/\s+structured\/operationally-complete/i);
  assert.match(text, /obj\/auth\/scope\/state\/\s+paths\/refs\/digests\/assump\/evidence\/validation\/blockers\/next\/\s+acceptance\/exit-criteria/i);
  assert.match(text, /omit padding\/history; retain critical detail; no secrets\/reasoning/i);
  assert.match(text, /bounded project material/i);
  assert.match(text, /authorizes only its natural scope/i);
  assert.match(text, /resolve [\s\S]{0,120}immediate effect/i);
  assert.match(text, /before mutation: explicitly atomic and low-risk/i);
  assert.match(text, /validation run or omitted/i);
  assert.match(text, /Completion requires requested scope/i);
  assert.match(text, /Stop before an unresolved material conflict;\s+ask for the smallest decision/i);
  assert.match(text, /data boundaries/i);
  assert.match(text, /Git\/release state/i);
  assert.match(text, /coordination, synthesis, conflict resolution,\s+acceptance, evidence review/i);
  assert.match(text, /actual routing is\s+`Unverified` without runtime metadata/i);
  assert.match(text, /Limit\s+parallelism\s+only\s+for\s+coupling,\s+unsafe\s+overlap,\s+unavailable\s+capacity,\s+dependencies,\s+or\s+coordination\s+benefit\s+erased/i);
  assert.match(text, /references, safe next action/i);
  assert.match(text, /changed files/i);
  assert.match(text, /valid\s+in-scope\s+user\s+instructions/i);
  assert.match(text, /resolve exact project\/repo\/roots\/branch\/worktree[\s\S]{0,100}immediate effect/i);
  assert.match(text, /retain\s+every\s+entered\s+ledger\s+entry\s*\/\s*cost/i);
  assert.match(text, /Bind\s+each\s+worker:\s+project\/repository[\s\S]{0,180}acceptance\/stop\/expected\s+artifact[\s\S]{0,120}assumptions,\s+validation\/integration\/evidence/i);
  assert.match(text, /non-file mutable state/i);
  assert.match(text, /lowest reliable model\/raw reasoning/i);
  assert.match(text, /logical dependencies\/integration contracts/i);
  assert.match(text, /then\s+a\s+safe\s+path/i);
  assert.match(text, /honest residual risk[\s\S]{0,180}when relevant/i);
  assert.match(text, /genuine\s+authority,\s+destructive\s+ambiguity,\s+or\s+absent\s+resource(?:s)?/i);
  assert.match(text, /active overlay/i);
  assert.match(text, /choose\s+only\s+`PARALLEL`,\s+`PIPELINED`,\s+`SERIAL`,\s+or\s+`EXPLORATORY`/i);
  assert.match(text, /Exclude shared resources only for non-file mutable state/i);
  assert.match(text, /stop\s*\/\s*delegate/i);
  assert.match(text, /acceptance\/exit-criteria/i);
  assert.match(text, /unverified areas when relevant/i);
});

test("supporting communication contracts preserve the audience distinction", async () => {
  const [continuityText, roleText, skillText] = await Promise.all([
    readFile(continuity, "utf8"), readFile(role, "utf8"), readFile(skill, "utf8")
  ]);

  for (const text of [continuityText, roleText, skillText]) {
    assert.match(text, /BLUF, Pyramid Principle,\s+progressive\s+disclosure, and plain-language design/i);
    assert.match(text, /token-compressed, meaning-dense, loss-minimizing,[\s\S]{0,40}operationally complete/i);
  }
});
