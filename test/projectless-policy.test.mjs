import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { codeRoot } from "../lib/core.mjs";

const overlays = fs.readFileSync(path.join(codeRoot, "governance", "modules", "project-overlays.md"), "utf8");
const skill = fs.readFileSync(path.join(codeRoot, "skills", "govern-codex-policy", "SKILL.md"), "utf8");
const role = fs.readFileSync(path.join(codeRoot, "docs", "agent-system-role.md"), "utf8");
const readme = fs.readFileSync(path.join(codeRoot, "README.md"), "utf8");
const policy = [overlays, skill, role, readme].join("\n");

test("null is an inspect-only unbound fallback with narrow generated-directory eligibility", () => {
  for (const text of [overlays, skill, role, readme]) {
    assert.match(text, /--project null/);
    assert.match(text, /projectless_unbound/);
  }
  assert.doesNotMatch(policy, /alias for (?:the )?canonical/i);
  assert.match(policy, /missing\s+(?:`--project`|project)[\s\S]{0,80}invalid/i);
  assert.match(policy, /non-inspect command[\s\S]{0,40}invalid/i);
  assert.match(policy, /narrow generated directory/i);
  assert.match(policy, /overlap or\s+ancestor\/descendant relation/i);
});

test("only expected unregistered-root absence is suppressed and the direct native contract is explicit", () => {
  assert.match(policy, /Suppress only (?:the )?expected\s+unregistered-root absence/i);
  assert.match(policy, /do not[\s\S]{0,100}(?:machine.profile|machine profile)[\s\S]{0,100}wait|does not[\s\S]{0,100}machine profile[\s\S]{0,100}wait/i);
  assert.match(policy, /direct native read-only prompt/i);
  assert.match(policy, /exact directory and inspection scope/i);
  assert.match(policy, /observations-only results|result is limited to observations/i);
  assert.match(policy, /model\/?reasoning[\s\S]{0,40}`Unverified`|model and reasoning `Unverified`/i);
  for (const condition of ["registered", "ambiguous", "privacy denial", "mutation", "independent runtime defects"]) {
    assert.match(policy, new RegExp(condition, "i"));
  }
  assert.match(policy, /governed and reportable/i);
});
