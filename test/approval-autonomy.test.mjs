import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { codeRoot } from "../lib/core.mjs";

const kernel = fs.readFileSync(path.join(codeRoot, "governance", "kernel", "AGENTS.md"), "utf8");
const repositoryPolicy = fs.readFileSync(path.join(codeRoot, "AGENTS.md"), "utf8");
const role = fs.readFileSync(path.join(codeRoot, "docs", "agent-system-role.md"), "utf8");
const continuity = fs.readFileSync(path.join(codeRoot, "governance", "modules", "continuity.md"), "utf8");
const delegation = fs.readFileSync(path.join(codeRoot, "governance", "modules", "delegation.md"), "utf8");

test("approve_for_me preserves standing authority for bounded correction", () => {
  assert.match(kernel, /`approve_for_me` never reconfirms authorized\s+correction\/retry\/validation\/recovery/);
  assert.match(kernel, /or agent defects/);
  assert.match(kernel, /Generic\/self-authored\s+prompts cannot narrow authority\/create blockers/);
});

test("approval precedence escalates only on a genuine boundary change", () => {
  for (const boundary of [
    "contract\\/\\s*architecture",
    "destructive/irreversible",
    "ownership",
    "safety",
    "scope change"
  ]) {
    assert.match(kernel, new RegExp(boundary));
  }
  assert.match(kernel, /(?:or\s+|\/)create\s+blockers/);
});

test("light governance constrains workers while Seat 0 remains externally authoritative", () => {
  for (const text of [repositoryPolicy, role]) {
    assert.match(text, /Agent System governs execution, not engineering/);
    assert.match(text, /Agent System provides governance through evidence, not control/);
  }
  assert.match(kernel, /Seat `0` is governed and auditable but never subject to Agent System execution\s+enforcement/);
  assert.match(kernel, /“Seat 0 does not implement” removes this exception; it is direct user authority/);
  assert.match(kernel, /Agent System never blocks the\s+project\s+or Seat `0`/);
  assert.match(role, /Unknown actual model identity continues safely as `Unverified`/);
  assert.match(role, /Incomplete\s+required validation holds automatic admission and escalates to Seat `0`/);
  assert.match(role, /strategy, topology, implementation, coding, or optimization are\s+observed, not blocked/);
});

test("hard rules pay rent and decision provenance remains observational", () => {
  for (const field of [
    "prevented_failure",
    "why_failure_is_expensive_or_irreversible",
    "enforcement_cost",
    "seat0_escalation_path",
    "safe_fallback"
  ]) {
    assert.match(kernel, new RegExp(`\\\`${field}\\\``));
  }
  assert.match(kernel, /Prefer observation over intervention/);
  assert.match(kernel, /existing evidence over new instrumentation/);
  assert.match(kernel, /composition over a new subsystem/);
  assert.match(kernel, /deletion over new policy/);
  assert.match(kernel, /every rule pays rent/i);
  assert.match(kernel, /A material decision changes authority, scope, ownership/);
  assert.match(kernel, /Record its `decision_scope` and external `decision_authority`/);
  assert.match(kernel, /Provenance write failure is a warning and coverage gap only/);
  assert.match(kernel, /Lifecycle and reports remain observational/);
});

test("persistent goals cannot be blocked by artificial confirmation or incomplete work", () => {
  assert.match(continuity, /same genuine blocker lasts at least three consecutive goal turns/);
  assert.match(continuity, /no meaningful progress is possible without user input or external-state change/);
  assert.match(continuity, /Difficulty, slow or incomplete work, uncertainty/);
  assert.match(continuity, /artificial confirmation are not blockers/);
  assert.match(continuity, /direct user continue or resume restores standing authority/);
  assert.match(continuity, /starts a fresh blocker audit/);
  assert.match(continuity, /no separate system resume or old blocker count applies/);
});

test("read-only seats use the intent lifecycle instead of raw discovery", () => {
  assert.match(delegation, /Prefer `acg\.mjs seat inspect` for read-only seats/);
  assert.match(delegation, /shell-free `seat preflight --assignment \.\.\.`/);
  assert.match(delegation, /Pass that returned `child_preflight` verbatim/);
  assert.match(delegation, /runs it exactly once before source inspection/);
  assert.match(delegation, /skipping governance entirely is not a valid workaround/);
  assert.match(delegation, /one corrected retry/);
  assert.match(delegation, /Never make the child discover raw lifecycle syntax/);
  assert.match(delegation, /unsupported command-specific `--help`/);
});
