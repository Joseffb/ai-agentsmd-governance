import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolvePolicyRootForReceipt } from "../lib/core.mjs";

function writeRelease(root, id, manifestSha, kernelSha, skillSha) {
  const policies = path.join(root, id, "policies");
  fs.mkdirSync(policies, { recursive: true });
  fs.writeFileSync(path.join(policies, "manifest.json"), JSON.stringify({ id: "fixture", version: 1 }));
  fs.writeFileSync(path.join(policies, "policy.lock.json"), JSON.stringify({
    manifest: { sha256: manifestSha },
    kernel: { sha256: kernelSha, estimated_tokens: 1 },
    skill: { sha256: skillSha, estimated_tokens: 1 },
    modules: []
  }));
  return policies;
}

function receipt(manifestSha, kernelSha, skillSha) {
  return {
    manifest: { sha256: manifestSha },
    context_ledger: {
      kernel: { digest: kernelSha, estimated_tokens: 1, source: "base_context" },
      "govern-codex-policy": { digest: skillSha, estimated_tokens: 1, source: "base_context" }
    }
  };
}

test("prior receipt resolves its matching immutable release instead of current", () => {
  const releases = fs.mkdtempSync(path.join(os.tmpdir(), "acg-release-pin-"));
  const expected = writeRelease(releases, "v1-old", "sha256:old-manifest", "sha256:old-kernel", "sha256:old-skill");
  writeRelease(releases, "v1-other", "sha256:other-manifest", "sha256:other-kernel", "sha256:other-skill");
  const resolved = resolvePolicyRootForReceipt(receipt("sha256:old-manifest", "sha256:old-kernel", "sha256:old-skill"), null, [releases]);
  assert.equal(fs.realpathSync(resolved), fs.realpathSync(expected));
});

test("prior receipt does not match on manifest alone when skill identity differs", () => {
  const releases = fs.mkdtempSync(path.join(os.tmpdir(), "acg-release-pin-"));
  writeRelease(releases, "v1-wrong-skill", "sha256:old-manifest", "sha256:old-kernel", "sha256:other-skill");
  assert.throws(() => resolvePolicyRootForReceipt(receipt("sha256:old-manifest", "sha256:old-kernel", "sha256:old-skill"), null, [releases]), /No immutable governance release matches/);
});
