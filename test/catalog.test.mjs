import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { codeRoot, dependencyClosure, listPolicyCatalog } from "../lib/core.mjs";

const policyRoot = path.join(codeRoot, "governance");

test("catalog lists valid risk tags without mutation", () => {
  const result = listPolicyCatalog("risk-tags", policyRoot);
  assert.equal(result.catalog, "risk-tags");
  assert.ok(Object.hasOwn(result.values, "compound_command"));
  assert.equal(Object.hasOwn(result.values, "delegated_seat_launch"), false);
});

test("catalog exposes route operation, tool, and authority enums", () => {
  assert.ok(Object.hasOwn(listPolicyCatalog("operations", policyRoot).values, "launch_subagent"));
  assert.ok(Object.hasOwn(listPolicyCatalog("tools", policyRoot).values, "subagent"));
  assert.ok(listPolicyCatalog("authorities", policyRoot).values.includes("delegation"));
});

test("JIT orchestration declares broad immediate triggers without trivial reads", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(policyRoot, "manifest.json"), "utf8"));
  const jit = manifest.modules.find((module) => module.id === "jit-orchestration");
  assert.ok(jit);
  for (const operation of ["plan", "repository_inspection", "implementation", "test", "launch_subagent", "git_commit", "release"]) {
    assert.ok(jit.triggers.operations.includes(operation), `missing JIT trigger: ${operation}`);
  }
  for (const operation of jit.triggers.operations) {
    assert.ok(
      dependencyClosure(manifest, manifest.operation_catalog[operation].required_modules).includes("jit-orchestration"),
      `JIT trigger is not routed for immediate operation: ${operation}`
    );
  }
  assert.deepEqual(jit.dependencies, ["context-routing"]);
  assert.equal(jit.triggers.operations.includes("none"), false);
  assert.equal(jit.triggers.operations.includes("read_file"), false);
});

test("unknown catalog fails closed with valid choices", () => {
  assert.throws(
    () => listPolicyCatalog("tags", policyRoot),
    /Valid catalogs: all, risk-tags, operations, tools, authorities/
  );
});
