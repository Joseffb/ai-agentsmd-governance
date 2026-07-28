import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repository = path.resolve(import.meta.dirname, "..");
const cli = path.join(repository, "bin", "acg.mjs");

function run(args, home, input) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: repository,
    env: { ...process.env, HOME: home },
    input,
    encoding: "utf8"
  });
}

test("project read roots authorize inspection but not mutation mode", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "acg-read-root-"));
  const target = path.join(home, "external-dependency");
  fs.mkdirSync(target, { recursive: true });

  const added = JSON.parse(run([
    "profile",
    "add-read-root",
    "--project",
    "example-project",
    "--path",
    target,
    "--authorize-profile-write"
  ], home));
  assert.equal(added.capability, "read_only");
  assert.equal(added.changed, true);

  const request = {
    mode: "read_only",
    phase: "inspection",
    project: "example-project",
    operations: ["read_file"],
    tools: ["filesystem_read"],
    paths: [target],
    risk_tags: [],
    mutation_authority: false,
    runtime_capabilities: { filesystem_read: true }
  };
  const allowed = JSON.parse(run(["route"], home, JSON.stringify(request)));
  assert.match(allowed.completion_sentinel, /^ACG_ROUTE_COMPLETE:/);

  const denied = spawnSync(process.execPath, [cli, "route"], {
    cwd: repository,
    env: { ...process.env, HOME: home },
    input: JSON.stringify({ ...request, mode: "mutation" }),
    encoding: "utf8"
  });
  assert.notEqual(denied.status, 0);
  assert.match(`${denied.stdout}${denied.stderr}`, /outside approved roots/);

  const removed = JSON.parse(run([
    "profile",
    "remove-read-root",
    "--project",
    "example-project",
    "--path",
    target,
    "--authorize-profile-write"
  ], home));
  assert.equal(removed.changed, true);
});
