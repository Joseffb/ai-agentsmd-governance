import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { codeRoot } from "../lib/core.mjs";

const kernel = fs.readFileSync(path.join(codeRoot, "governance", "kernel", "AGENTS.md"), "utf8");
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
