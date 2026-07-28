import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const codeRoot = path.resolve(__dirname, "..");
const GIT_TEXT_MAX_BUFFER = 16 * 1024 * 1024;

export function resolvePolicyRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.ACG_POLICY_ROOT) return path.resolve(process.env.ACG_POLICY_ROOT);
  const source = path.join(codeRoot, "governance", "manifest.json");
  if (fs.existsSync(source)) return path.join(codeRoot, "governance");
  const runtime = path.join(codeRoot, "manifest.json");
  if (fs.existsSync(runtime)) return codeRoot;
  throw new Error("Unable to resolve policy root");
}

function receiptContext(receipt) {
  return receipt?.context_acknowledgment ?? receipt ?? null;
}

function policyRootMatchesReceipt(policyRoot, suppliedReceipt) {
  const receipt = receiptContext(suppliedReceipt);
  if (!receipt?.manifest?.sha256 || !receipt?.context_ledger) return false;
  try {
    const lock = readJson(path.join(policyRoot, "policy.lock.json"));
    if (lock.manifest?.sha256 !== receipt.manifest.sha256) return false;
    const expected = contextLedgerFromLock(lock);
    for (const id of ["kernel", "govern-codex-policy"]) {
      if (!receipt.context_ledger[id] || canonicalJson(receipt.context_ledger[id]) !== canonicalJson(expected[id])) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function defaultRuntimeReleaseRoots() {
  const roots = new Set();
  let cursor = codeRoot;
  for (let depth = 0; depth < 8; depth += 1) {
    const direct = path.join(cursor, ".runtime", "releases");
    if (fs.existsSync(direct)) roots.add(direct);
    if (path.basename(cursor) === ".runtime") {
      const nested = path.join(cursor, "releases");
      if (fs.existsSync(nested)) roots.add(nested);
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return [...roots].sort();
}

export function resolvePolicyRootForReceipt(suppliedReceipt, explicit, releaseRoots = defaultRuntimeReleaseRoots()) {
  if (explicit || process.env.ACG_POLICY_ROOT) return resolvePolicyRoot(explicit);
  const receipt = receiptContext(suppliedReceipt);
  const current = resolvePolicyRoot();
  if (!receipt?.manifest?.sha256) return current;
  if (policyRootMatchesReceipt(current, receipt)) return current;

  const matches = [];
  for (const releasesRoot of releaseRoots) {
    if (!fs.existsSync(releasesRoot)) continue;
    for (const entry of fs.readdirSync(releasesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const candidate = path.join(releasesRoot, entry.name, "policies");
      if (fs.existsSync(path.join(candidate, "manifest.json")) && policyRootMatchesReceipt(candidate, receipt)) matches.push(fs.realpathSync(candidate));
    }
  }
  const unique = [...new Set(matches)].sort();
  assert(unique.length > 0, "No immutable governance release matches the prior context receipt. Preserve its accounting and continue in a fresh context without that receipt; do not reset or guess a router path.");
  return unique[0];
}

export function listPolicyCatalog(kind = "all", policyRoot = resolvePolicyRoot()) {
  const manifest = readJson(path.join(policyRoot, "manifest.json"));
  validateManifestShape(manifest);
  validateGraph(manifest);
  const sorted = (value) => Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  const catalogs = {
    "risk-tags": sorted(manifest.risk_tag_catalog),
    operations: sorted(Object.fromEntries(Object.entries(manifest.operation_catalog).map(([id, definition]) => [
      id,
      {
        effect_class: definition.effect_class,
        required_modules: definition.required_modules
      }
    ]))),
    tools: sorted(manifest.tool_catalog),
    authorities: [...new Set([
      ...manifest.authority_model.mutation_authority_effects,
      ...manifest.authority_model.explicit_authority_effects
    ])].sort()
  };
  if (kind !== "all" && !Object.hasOwn(catalogs, kind)) {
    throw new Error(`Unknown catalog '${kind}'. Valid catalogs: all, risk-tags, operations, tools, authorities`);
  }
  return {
    schema_version: 1,
    manifest: {
      id: manifest.id,
      version: manifest.version
    },
    ...(kind === "all" ? { catalogs } : { catalog: kind, values: catalogs[kind] })
  };
}

export function resolveSourceRoot(policyRoot = resolvePolicyRoot()) {
  return path.basename(policyRoot) === "governance" ? path.dirname(policyRoot) : path.dirname(policyRoot);
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function parseSystemVersion(value) {
  const identifier = "(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
  const match = new RegExp(
    `^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`
  ).exec(value ?? "");
  assert(match, `Invalid governance system version: ${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
    build: match[5] ? match[5].split(".") : []
  };
}

export function parseDisplayChannel(value) {
  assert(
    typeof value === "string" && /^[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)*(?:\.[0-9]+)*$/u.test(value),
    `Invalid governance display channel: ${value}`
  );
  return value;
}

function comparePrereleaseIdentifiers(previous, next) {
  const length = Math.max(previous.length, next.length);
  for (let index = 0; index < length; index += 1) {
    if (previous[index] === undefined) return -1;
    if (next[index] === undefined) return 1;
    if (previous[index] === next[index]) continue;
    const previousNumeric = /^\d+$/u.test(previous[index]);
    const nextNumeric = /^\d+$/u.test(next[index]);
    if (previousNumeric && nextNumeric) return BigInt(previous[index]) < BigInt(next[index]) ? -1 : 1;
    if (previousNumeric !== nextNumeric) return previousNumeric ? -1 : 1;
    return previous[index] < next[index] ? -1 : 1;
  }
  return 0;
}

export function compareSystemVersions(previousVersion, nextVersion) {
  const previous = parseSystemVersion(previousVersion);
  const next = parseSystemVersion(nextVersion);
  for (const key of ["major", "minor", "patch"]) {
    if (previous[key] !== next[key]) return previous[key] < next[key] ? -1 : 1;
  }
  if (previous.prerelease.length === 0 && next.prerelease.length === 0) return 0;
  if (previous.prerelease.length === 0) return 1;
  if (next.prerelease.length === 0) return -1;
  return comparePrereleaseIdentifiers(previous.prerelease, next.prerelease);
}

export function classifyVersionBump(previousVersion, nextVersion) {
  const previous = parseSystemVersion(previousVersion);
  const next = parseSystemVersion(nextVersion);
  const precedence = compareSystemVersions(previousVersion, nextVersion);
  if (precedence > 0) {
    throw new Error(`Governance system version cannot decrease: ${previousVersion} -> ${nextVersion}`);
  }
  if (next.major > previous.major) return "major";
  if (next.major === previous.major && next.minor > previous.minor) return "minor";
  if (next.major === previous.major && next.minor === previous.minor && next.patch > previous.patch) return "patch";
  if (precedence === 0) return "none";
  if (previous.prerelease.length > 0 && next.prerelease.length === 0) return "stable";
  return "prerelease";
}

export function validateReleaseVersionTransition({ previousVersion, nextVersion, previousBundleSha256, nextBundleSha256 }) {
  parseSystemVersion(nextVersion);
  if (!previousVersion) return { previous_system_version: null, system_version: nextVersion, version_bump: "initial" };
  const versionBump = classifyVersionBump(previousVersion, nextVersion);
  const bundleChanged = previousBundleSha256 !== nextBundleSha256;
  assert(bundleChanged || versionBump !== "none", "No bundled governance or system-version change exists");
  assert(bundleChanged, "System version advanced without a bundled governance change");
  assert(versionBump !== "none", "Bundled governance changed without a system-version advance");
  return { previous_system_version: previousVersion, system_version: nextVersion, version_bump: versionBump };
}

export function readJson(file) {
  const text = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${error.message}`);
  }
}

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(temporary, file);
}

export function fileRecord(file, relativePath = path.basename(file)) {
  const content = fs.readFileSync(file);
  const text = content.toString("utf8");
  return {
    path: relativePath,
    sha256: sha256(content),
    bytes: content.length,
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    estimated_tokens: Math.ceil(content.length / 4)
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function valueHasType(value, expected) {
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "null") return value === null;
  return typeof value === expected;
}

export function validateJsonSchema(value, schema, location = "$") {
  if (schema.const !== undefined) assert(Object.is(value, schema.const), `${location} must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum) {
    assert(
      schema.enum.some((entry) => Object.is(entry, value)),
      `${location} is not an allowed value: ${JSON.stringify(value)}. Valid values: ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}`
    );
  }
  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    assert(expected.some((type) => valueHasType(value, type)), `${location} has type ${actual}; expected ${expected.join(" or ")}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined) assert(value.length >= schema.minLength, `${location} is too short`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined) assert(value >= schema.minimum, `${location} is below its minimum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) assert(value.length >= schema.minItems, `${location} has too few items`);
    if (schema.items) value.forEach((entry, index) => validateJsonSchema(entry, schema.items, `${location}[${index}]`));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required ?? []) assert(Object.hasOwn(value, required), `${location}.${required} is required`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) validateJsonSchema(value[key], child, `${location}.${key}`);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) assert(allowed.has(key), `${location}.${key} is not allowed`);
    }
  }
  return true;
}

function validateAgainstSchema(policyRoot, name, value) {
  return validateJsonSchema(value, readJson(path.join(policyRoot, "schemas", `${name}.schema.json`)));
}

function safePolicyPath(policyRoot, relative) {
  assert(typeof relative === "string" && relative.length > 0, "Policy path must be a non-empty string");
  const absolute = path.resolve(policyRoot, relative);
  const prefix = policyRoot.endsWith(path.sep) ? policyRoot : policyRoot + path.sep;
  assert(absolute.startsWith(prefix), `Policy path escapes root: ${relative}`);
  return absolute;
}

function assertAbsoluteWithoutTraversal(value, label) {
  assert(typeof value === "string" && value.length > 0 && path.isAbsolute(value), `${label} must be an absolute path`);
  assert(!value.split(path.sep).includes(".."), `${label} must not contain traversal`);
  return path.resolve(value);
}

function assertPathContained(root, target, label) {
  const resolvedRoot = fs.realpathSync(root);
  const resolvedTarget = fs.realpathSync(target);
  assert(resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep), `${label} escapes its approved root`);
  return { root: resolvedRoot, target: resolvedTarget };
}

function localDescriptorId(kind, organizationId, projectId = null) {
  return projectId ? `local-${kind}:${organizationId}:${projectId}` : `local-${kind}:${organizationId}`;
}

function localIndexPath(request) {
  return request.local_organization_index ?? request.runtime_capabilities.local_organization_index ?? null;
}

function localProjectRoot(request) {
  return request.local_project_root ?? request.runtime_capabilities.local_project_root ?? null;
}

function validateLocalPolicyDescriptor(descriptor, label, { allowUnlocked = false } = {}) {
  assert(descriptor && typeof descriptor === "object" && !Array.isArray(descriptor), `${label} policy is invalid`);
  assert(Number.isInteger(descriptor.version) && descriptor.version > 0, `${label} policy version is invalid`);
  assert(typeof descriptor.path === "string" && descriptor.path.length > 0, `${label} policy path is invalid`);
  if (!allowUnlocked) assert(/^sha256:[a-f0-9]{64}$/.test(descriptor.sha256 ?? ""), `${label} policy digest is invalid`);
  if (descriptor.sha256 !== undefined) assert(/^sha256:[a-f0-9]{64}$/.test(descriptor.sha256), `${label} policy digest is invalid`);
  if (descriptor.estimated_tokens !== undefined) assert(Number.isInteger(descriptor.estimated_tokens) && descriptor.estimated_tokens >= 0, `${label} policy token estimate is invalid`);
}

export function validateLocalOrganizationIndex(index, policyRoot = resolvePolicyRoot(), options = {}) {
  validateAgainstSchema(policyRoot, "local-organization-index", index);
  assert(index.schema_version === 1, "Unsupported local organization index schema_version");
  assert(typeof index.policy_root === "string", "Local policy root is required");
  assert(Array.isArray(index.organizations) && index.organizations.length > 0, "Local organizations are required");
  const organizations = new Set();
  for (const organization of index.organizations) {
    assert(typeof organization.id === "string" && organization.id.length > 0, "Local organization id is required");
    assert(!organizations.has(organization.id), `Duplicate local organization id: ${organization.id}`);
    organizations.add(organization.id);
    validateLocalPolicyDescriptor(organization.policy, `Organization ${organization.id}`, options);
    assert(Array.isArray(organization.projects), `Organization ${organization.id} projects are required`);
    const projects = new Set();
    for (const project of organization.projects) {
      assert(typeof project.project_id === "string" && project.project_id.length > 0, `Project id is required for ${organization.id}`);
      assert(!projects.has(project.project_id), `Duplicate project id in ${organization.id}: ${project.project_id}`);
      projects.add(project.project_id);
      assert(typeof project.root === "string" && project.root.length > 0, `Project root is required for ${project.project_id}`);
      if (project.git_origin !== undefined) assert(typeof project.git_origin === "string" && project.git_origin.length > 0, `Project origin is invalid for ${project.project_id}`);
      validateLocalPolicyDescriptor(project.policy, `Project ${project.project_id}`, options);
    }
  }
  return true;
}

function descriptorRecord(index, policyRoot, descriptor, metadata) {
  const policyRootPath = assertAbsoluteWithoutTraversal(index.policy_root, "Local policy root");
  const descriptorPath = assertAbsoluteWithoutTraversal(descriptor.path, `${metadata.kind} policy path`);
  assert(fs.existsSync(policyRootPath), "Local policy root is unreadable");
  assert(fs.existsSync(descriptorPath), `${metadata.kind} policy is unreadable`);
  assert(!fs.lstatSync(descriptorPath).isSymbolicLink(), `${metadata.kind} policy must not be a symlink`);
  assertPathContained(policyRootPath, descriptorPath, `${metadata.kind} policy`);
  const record = fileRecord(descriptorPath, descriptorPath);
  if (descriptor.sha256 !== undefined) assert(descriptor.sha256 === `sha256:${record.sha256}`, `${metadata.kind} policy digest mismatch`);
  if (descriptor.estimated_tokens !== undefined) assert(descriptor.estimated_tokens === record.estimated_tokens, `${metadata.kind} policy token estimate mismatch`);
  return {
    id: localDescriptorId(metadata.kind, metadata.organization_id, metadata.project_id),
    source: "local_policy",
    kind: metadata.kind,
    organization_id: metadata.organization_id,
    project_id: metadata.project_id ?? null,
    version: descriptor.version,
    digest: `sha256:${record.sha256}`,
    path: descriptorPath,
    policy_root: fs.realpathSync(policyRootPath),
    estimated_tokens: record.estimated_tokens,
    reason: ["explicit_local_organization_index"]
  };
}

function verifyLocalOrigin(project, actualRoot) {
  if (!project.git_origin) return;
  let origin;
  try {
    origin = execFileSync("git", ["-C", actualRoot, "config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(`Project origin is unreadable for ${project.project_id}`);
  }
  assert(origin === project.git_origin, `Project origin mismatch for ${project.project_id}`);
}

function resolveLocalPolicies(request, policyRoot) {
  const suppliedIndex = localIndexPath(request);
  if (suppliedIndex === null) return [];
  const indexFile = assertAbsoluteWithoutTraversal(suppliedIndex, "Local organization index");
  assert(fs.existsSync(indexFile), "Local organization index is unreadable");
  assert(!fs.lstatSync(indexFile).isSymbolicLink(), "Local organization index must not be a symlink");
  const index = readJson(indexFile);
  validateLocalOrganizationIndex(index, policyRoot);
  assert(index.disabled !== true, "Local organization index is disabled");
  const requestedRoot = assertAbsoluteWithoutTraversal(localProjectRoot(request), "Local project root");
  assert(fs.existsSync(requestedRoot), "Local project root is unreadable");
  const actualRoot = fs.realpathSync(requestedRoot);
  const approvedProjectRoot = path.resolve(requestedRoot);
  const candidates = [];
  for (const organization of index.organizations) {
    for (const project of organization.projects) {
      if (project.project_id !== request.project) continue;
      const descriptorRoot = assertAbsoluteWithoutTraversal(project.root, `Project root for ${project.project_id}`);
      if (!fs.existsSync(descriptorRoot) || fs.realpathSync(descriptorRoot) !== actualRoot) continue;
      candidates.push({ organization, project });
    }
  }
  assert(candidates.length === 1, candidates.length ? `Ambiguous local policy binding for ${request.project}` : `No exact local policy binding for ${request.project}`);
  const { organization, project } = candidates[0];
  assert(organization.disabled !== true, `Local organization is disabled: ${organization.id}`);
  assert(project.disabled !== true, `Local project is disabled: ${project.project_id}`);
  for (const target of request.paths) {
    const resolvedTarget = assertAbsoluteWithoutTraversal(target, "Local operation path");
    assert(resolvedTarget === approvedProjectRoot || resolvedTarget.startsWith(approvedProjectRoot + path.sep), `Local operation path escapes project root: ${target}`);
  }
  verifyLocalOrigin(project, actualRoot);
  const indexDigest = `sha256:${fileRecord(indexFile, indexFile).sha256}`;
  const organizationDescriptor = descriptorRecord(index, policyRoot, organization.policy, { kind: "organization", organization_id: organization.id });
  const projectDescriptor = descriptorRecord(index, policyRoot, project.policy, { kind: "project", organization_id: organization.id, project_id: project.project_id });
  for (const descriptor of [organizationDescriptor, projectDescriptor]) {
    descriptor.local_index_sha256 = indexDigest;
    descriptor.repository_agents_precedence = "reported_not_copied";
    descriptor.project_root = actualRoot;
    descriptor.approved_project_root = approvedProjectRoot;
  }
  return [organizationDescriptor, projectDescriptor];
}

export function lockLocalPolicies(indexFile, policyRoot = resolvePolicyRoot()) {
  const actualIndex = assertAbsoluteWithoutTraversal(indexFile, "Local organization index");
  const index = readJson(actualIndex);
  validateLocalOrganizationIndex(index, policyRoot, { allowUnlocked: true });
  for (const organization of index.organizations) {
    for (const entry of [organization.policy, ...organization.projects.map((project) => project.policy)]) {
      const unlocked = { ...entry };
      delete unlocked.sha256;
      delete unlocked.estimated_tokens;
      const record = descriptorRecord(index, policyRoot, unlocked, { kind: "local", organization_id: organization.id });
      entry.sha256 = record.digest;
      entry.estimated_tokens = record.estimated_tokens;
    }
  }
  writeJsonAtomic(actualIndex, index);
  return { index: actualIndex, sha256: `sha256:${fileRecord(actualIndex, actualIndex).sha256}`, locked: true };
}

export function verifyLocalPolicies(indexFile, selection = null, policyRoot = resolvePolicyRoot()) {
  const actualIndex = assertAbsoluteWithoutTraversal(indexFile, "Local organization index");
  const index = readJson(actualIndex);
  validateLocalOrganizationIndex(index, policyRoot);
  if (selection) {
    const descriptors = resolveLocalPolicies({ ...selection, local_organization_index: actualIndex, runtime_capabilities: selection.runtime_capabilities ?? {}, paths: selection.paths ?? [] }, policyRoot);
    return { verified: true, selected: descriptors.map((entry) => entry.id) };
  }
  assert(index.disabled !== true, "Local organization index is disabled");
  const verified = [];
  for (const organization of index.organizations) {
    assert(organization.disabled !== true, `Local organization is disabled: ${organization.id}`);
    verified.push(descriptorRecord(index, policyRoot, organization.policy, { kind: "organization", organization_id: organization.id }).id);
    for (const project of organization.projects) {
      assert(project.disabled !== true, `Local project is disabled: ${project.project_id}`);
      const root = assertAbsoluteWithoutTraversal(project.root, `Project root for ${project.project_id}`);
      assert(fs.existsSync(root), `Project root is unreadable for ${project.project_id}`);
      verifyLocalOrigin(project, fs.realpathSync(root));
      verified.push(descriptorRecord(index, policyRoot, project.policy, { kind: "project", organization_id: organization.id, project_id: project.project_id }).id);
    }
  }
  return { verified: true, selected: verified };
}

export function validateManifestShape(manifest) {
  assert(manifest && typeof manifest === "object" && !Array.isArray(manifest), "Manifest must be an object");
  assert(manifest.schema_version === 1, "Unsupported manifest schema_version");
  assert(typeof manifest.id === "string" && manifest.id.length > 0, "Manifest id is required");
  assert(Number.isInteger(manifest.version) && manifest.version > 0, "Manifest version must be positive");
  assert(manifest.estimator?.id === "utf8-bytes-div-4-ceil", "Unsupported token estimator");
  assert(manifest.estimator?.version === 1, "Unsupported token estimator version");
  assert(manifest.budgets?.kernel_hard_max > 0, "Kernel budget is required");
  assert(manifest.budgets?.closure_enforcement === "advisory_only", "Policy context targets must be advisory");
  for (const mode of ["read_only", "delegation", "mutation", "deep_audit"]) {
    assert(manifest.budgets?.closures?.[mode] > 0, `Policy context target is required for ${mode}`);
  }
  assert(manifest.authority_model && typeof manifest.authority_model === "object", "Authority model is required");
  assert(manifest.tool_catalog && typeof manifest.tool_catalog === "object", "Tool catalog is required");
  assert(manifest.risk_tag_catalog && typeof manifest.risk_tag_catalog === "object", "Risk-tag catalog is required");
  assert(manifest.operation_catalog && typeof manifest.operation_catalog === "object", "Operation catalog is required");
  assert(Array.isArray(manifest.modules) && manifest.modules.length > 0, "Manifest modules are required");

  const ids = new Set();
  for (const module of manifest.modules) {
    assert(typeof module.id === "string" && module.id.length > 0, "Module id is required");
    assert(!ids.has(module.id), `Duplicate module id: ${module.id}`);
    ids.add(module.id);
    assert(Number.isInteger(module.version) && module.version > 0, `Invalid version for ${module.id}`);
    assert(typeof module.path === "string", `Missing path for ${module.id}`);
    assert(Array.isArray(module.dependencies), `Missing dependencies for ${module.id}`);
    assert(Array.isArray(module.conflicts), `Missing conflicts for ${module.id}`);
    assert(Array.isArray(module.load_before), `Missing load_before for ${module.id}`);
    assert(Number.isInteger(module.precedence), `Missing precedence for ${module.id}`);
    assert(typeof module.authority === "string", `Missing authority for ${module.id}`);
    assert(module.on_failure && Array.isArray(module.on_failure.block) && Array.isArray(module.on_failure.allow), `Missing scoped failure behavior for ${module.id}`);
    assert(Array.isArray(module.applicable_project_profiles), `Missing project profiles for ${module.id}`);
    assert(module.triggers && Array.isArray(module.triggers.operations), `Missing triggers for ${module.id}`);
  }

  for (const [operation, definition] of Object.entries(manifest.operation_catalog)) {
    assert(typeof definition.effect_class === "string", `Missing effect class for operation ${operation}`);
    assert(Array.isArray(definition.required_modules), `Missing module closure for operation ${operation}`);
    for (const id of definition.required_modules) assert(ids.has(id), `Unknown module ${id} in operation ${operation}`);
  }

  const effects = new Set(Object.values(manifest.operation_catalog).map((definition) => definition.effect_class));
  for (const list of Object.values(manifest.authority_model)) {
    assert(Array.isArray(list), "Authority model entries must be arrays");
    for (const effect of list) assert(effects.has(effect), `Unknown effect class in authority model: ${effect}`);
  }
  for (const [tool, allowedEffects] of Object.entries(manifest.tool_catalog)) {
    assert(Array.isArray(allowedEffects), `Tool effects must be an array: ${tool}`);
    for (const effect of allowedEffects) assert(effects.has(effect), `Unknown effect class ${effect} for tool ${tool}`);
  }
  for (const [risk, modules] of Object.entries(manifest.risk_tag_catalog)) {
    assert(Array.isArray(modules), `Risk modules must be an array: ${risk}`);
    for (const id of modules) assert(ids.has(id), `Unknown module ${id} for risk tag ${risk}`);
  }

  for (const module of manifest.modules) {
    for (const id of [...module.dependencies, ...module.conflicts]) assert(ids.has(id), `Unknown related module ${id} in ${module.id}`);
    for (const operation of module.triggers.operations) assert(manifest.operation_catalog[operation], `Unknown trigger operation ${operation} in ${module.id}`);
  }
  validateGraph(manifest);
  return true;
}

export function validateGraph(manifest) {
  const byId = new Map(manifest.modules.map((module) => [module.id, module]));
  const visiting = new Set();
  const visited = new Set();

  function visit(id, trail = []) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Circular module dependency: ${[...trail, id].join(" -> ")}`);
    visiting.add(id);
    const module = byId.get(id);
    assert(module, `Unknown dependency: ${id}`);
    for (const dependency of module.dependencies) visit(dependency, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of byId.keys()) visit(id);
  return true;
}

export function dependencyClosure(manifest, initialIds, project = "*") {
  const byId = new Map(manifest.modules.map((module) => [module.id, module]));
  const selected = new Set();
  const ordered = [];
  const visiting = new Set();

  function include(id) {
    if (selected.has(id)) return;
    if (visiting.has(id)) throw new Error(`Circular dependency while resolving ${id}`);
    const module = byId.get(id);
    assert(module, `Unknown module: ${id}`);
    const profiles = module.applicable_project_profiles;
    assert(profiles.includes("*") || profiles.includes(project), `Module ${id} is not applicable to project ${project}`);
    visiting.add(id);
    for (const dependency of module.dependencies) include(dependency);
    visiting.delete(id);
    selected.add(id);
    ordered.push(id);
  }

  for (const id of initialIds) include(id);

  for (const id of ordered) {
    const module = byId.get(id);
    for (const conflict of module.conflicts) {
      if (!selected.has(conflict)) continue;
      const other = byId.get(conflict);
      if (module.precedence === other.precedence) {
        throw new Error(`Unresolved policy conflict: ${id} and ${conflict}`);
      }
    }
  }
  return ordered;
}

export function lockPolicies(policyRoot = resolvePolicyRoot()) {
  const sourceRoot = resolveSourceRoot(policyRoot);
  const manifestFile = path.join(policyRoot, "manifest.json");
  const manifest = readJson(manifestFile);
  validateAgainstSchema(policyRoot, "manifest", manifest);
  validateManifestShape(manifest);

  for (const module of manifest.modules) {
    const record = fileRecord(safePolicyPath(policyRoot, module.path), module.path);
    module.digest = `sha256:${record.sha256}`;
    module.bytes = record.bytes;
    module.words = record.words;
    module.estimated_tokens = record.estimated_tokens;
  }

  writeJsonAtomic(manifestFile, manifest);
  const manifestRecord = fileRecord(manifestFile, "manifest.json");
  const kernelFile = path.join(sourceRoot, "governance", "kernel", "AGENTS.md");
  const skillFile = path.join(sourceRoot, "skills", "govern-codex-policy", "SKILL.md");
  assert(fs.existsSync(kernelFile), `Kernel not found: ${kernelFile}`);
  assert(fs.existsSync(skillFile), `Skill not found: ${skillFile}`);

  const lock = {
    schema_version: 1,
    manifest: {
      id: manifest.id,
      version: manifest.version,
      sha256: `sha256:${manifestRecord.sha256}`
    },
    estimator: manifest.estimator,
    kernel: fileRecord(kernelFile, "kernel/AGENTS.md"),
    skill: fileRecord(skillFile, "skills/govern-codex-policy/SKILL.md"),
    modules: manifest.modules.map((module) => ({
      id: module.id,
      version: module.version,
      path: module.path,
      sha256: module.digest,
      bytes: module.bytes,
      words: module.words,
      estimated_tokens: module.estimated_tokens
    }))
  };
  lock.kernel.sha256 = `sha256:${lock.kernel.sha256}`;
  lock.skill.sha256 = `sha256:${lock.skill.sha256}`;
  writeJsonAtomic(path.join(policyRoot, "policy.lock.json"), lock);
  return lock;
}

export function verifyTraceability(sourceRoot) {
  const inventoryFile = path.join(sourceRoot, "governance", "traceability", "legacy-rule-inventory.json");
  const mapFile = path.join(sourceRoot, "governance", "traceability", "rule-destination-map.json");
  assert(fs.existsSync(inventoryFile), "Traceability inventory is missing");
  assert(fs.existsSync(mapFile), "Traceability destination map is missing");
  const inventory = readJson(inventoryFile);
  const mapping = readJson(mapFile);
  assert(inventory.schema_version === 1 && mapping.schema_version === 1, "Unsupported traceability schema");
  assert(inventory.rules.length === inventory.source_nonempty_line_count, "Traceability inventory does not cover every non-empty legacy line");
  assert(mapping.rules.length === inventory.rules.length, "Traceability map length differs from inventory");
  const ids = new Set();
  const allowed = new Set(["retained", "consolidated", "corrected", "moved", "retired", "new"]);
  for (const rule of mapping.rules) {
    assert(!ids.has(rule.rule_id), `Duplicate traceability rule id: ${rule.rule_id}`);
    ids.add(rule.rule_id);
    assert(typeof rule.destination === "string" && rule.destination.length > 0, `Unmapped rule: ${rule.rule_id}`);
    assert(allowed.has(rule.disposition), `Invalid disposition for ${rule.rule_id}`);
    if (rule.disposition === "retired") assert(rule.rationale, `Retired rule lacks rationale: ${rule.rule_id}`);
  }
  return { rules: mapping.rules.length };
}

function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const seen = new Set();
  for (const [index, raw] of text.split("\n").entries()) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    assert(!raw.includes("\t"), `YAML tabs are not allowed at line ${index + 1}`);
    const indent = raw.length - raw.trimStart().length;
    assert(indent % 2 === 0, `YAML indentation must use two spaces at line ${index + 1}`);
    const match = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*):(?:\s+(.*))?$/);
    assert(match, `Unsupported YAML syntax at line ${index + 1}`);
    while (stack.at(-1).indent >= indent) stack.pop();
    assert(stack.length > 0, `Invalid YAML nesting at line ${index + 1}`);
    const parent = stack.at(-1).value;
    const keyPath = `${stack.map((entry) => entry.key).filter(Boolean).join(".")}.${match[1]}`;
    assert(!seen.has(keyPath), `Duplicate YAML key at line ${index + 1}: ${match[1]}`);
    seen.add(keyPath);
    const source = match[2];
    let value;
    if (source === undefined) value = {};
    else if (source === "true") value = true;
    else if (source === "false") value = false;
    else {
      assert(/^"(?:[^"\\]|\\.)*"$/.test(source), `YAML scalar must be quoted at line ${index + 1}`);
      value = JSON.parse(source);
    }
    parent[match[1]] = value;
    if (value && typeof value === "object") stack.push({ indent, value, key: match[1] });
  }
  return root;
}

export function validateSkill(sourceRoot = codeRoot) {
  const skillFile = path.join(sourceRoot, "skills", "govern-codex-policy", "SKILL.md");
  const metadataFile = path.join(sourceRoot, "skills", "govern-codex-policy", "agents", "openai.yaml");
  const content = fs.readFileSync(skillFile, "utf8");
  const lines = content.split("\n");
  assert(lines[0] === "---", "Skill frontmatter must begin on the first line");
  const end = lines.indexOf("---", 1);
  assert(end > 1, "Skill frontmatter is not closed");
  const fields = new Map();
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([a-z_]+):\s*(.+)$/);
    assert(match, `Invalid skill frontmatter line: ${line}`);
    assert(!fields.has(match[1]), `Duplicate skill frontmatter field: ${match[1]}`);
    fields.set(match[1], match[2]);
  }
  assert(canonicalJson([...fields.keys()].sort()) === canonicalJson(["description", "name"]), "Skill frontmatter may contain only name and description");
  assert(fields.get("name") === "govern-codex-policy", "Skill name must match its directory");
  assert((fields.get("description") ?? "").length > 0, "Skill description is required");
  assert(lines.length <= 500, "Skill must remain under 500 lines");

  const metadata = parseSimpleYaml(fs.readFileSync(metadataFile, "utf8"));
  assert(canonicalJson(Object.keys(metadata).sort()) === canonicalJson(["interface", "policy"]), "Skill metadata root must contain interface and policy");
  assert(canonicalJson(Object.keys(metadata.interface ?? {}).sort()) === canonicalJson(["default_prompt", "display_name", "short_description"]), "Skill interface metadata shape is invalid");
  assert(canonicalJson(Object.keys(metadata.policy ?? {}).sort()) === canonicalJson(["allow_implicit_invocation"]), "Skill policy metadata shape is invalid");
  assert(metadata.interface.display_name === "Govern Codex Policy", "Skill display_name is invalid");
  assert(typeof metadata.interface.short_description === "string" && metadata.interface.short_description.length > 0, "Skill short_description is missing");
  assert(metadata.interface.default_prompt.includes("$govern-codex-policy"), "Skill default_prompt must reference the skill");
  assert(metadata.policy.allow_implicit_invocation === true, "Skill must allow implicit invocation");

  const forbiddenCopies = [
    "# Storage Policy",
    "# Trust and Data Policy",
    "# Finding Classification Standard",
    "# Release and Integration Policy"
  ];
  for (const marker of forbiddenCopies) assert(!content.includes(marker), `Skill duplicates a policy module: ${marker}`);
  return { valid: true, name: fields.get("name"), lines: lines.length };
}

export function verifyPolicyRoot(policyRoot = resolvePolicyRoot(), options = {}) {
  const sourceRoot = options.sourceRoot ?? resolveSourceRoot(policyRoot);
  const manifestFile = path.join(policyRoot, "manifest.json");
  const lockFile = path.join(policyRoot, "policy.lock.json");
  assert(fs.existsSync(manifestFile), "Manifest is missing");
  assert(fs.existsSync(lockFile), "Policy lock is missing");
  const manifest = readJson(manifestFile);
  const lock = readJson(lockFile);
  validateAgainstSchema(policyRoot, "manifest", manifest);
  validateManifestShape(manifest);

  const manifestRecord = fileRecord(manifestFile);
  assert(lock.manifest?.sha256 === `sha256:${manifestRecord.sha256}`, "Manifest digest does not match policy lock");
  assert(lock.manifest?.id === manifest.id && lock.manifest?.version === manifest.version, "Manifest identity does not match lock");

  const locked = new Map(lock.modules.map((module) => [module.id, module]));
  for (const module of manifest.modules) {
    const file = safePolicyPath(policyRoot, module.path);
    assert(fs.existsSync(file), `Required module is unreadable: ${module.id}`);
    const record = fileRecord(file, module.path);
    const digest = `sha256:${record.sha256}`;
    assert(module.digest === digest, `Manifest digest mismatch for ${module.id}`);
    assert(locked.get(module.id)?.sha256 === digest, `Lock digest mismatch for ${module.id}`);
    assert(module.estimated_tokens === record.estimated_tokens, `Token estimate mismatch for ${module.id}`);
    const maximum = manifest.budgets.module_exceptions[module.id] ?? manifest.budgets.module_default_max;
    assert(record.estimated_tokens <= maximum, `Module ${module.id} exceeds token budget: ${record.estimated_tokens} > ${maximum}`);
  }

  let kernelFile = options.kernelFile;
  let skillFile = options.skillFile;
  if (!kernelFile) kernelFile = path.join(sourceRoot, "governance", "kernel", "AGENTS.md");
  if (!skillFile) skillFile = path.join(sourceRoot, "skills", "govern-codex-policy", "SKILL.md");
  assert(fs.existsSync(kernelFile), "Kernel is missing");
  assert(fs.existsSync(skillFile), "Governance skill is missing");
  const kernel = fileRecord(kernelFile);
  const skill = fileRecord(skillFile);
  assert(lock.kernel.sha256 === `sha256:${kernel.sha256}`, "Kernel digest mismatch");
  assert(lock.skill.sha256 === `sha256:${skill.sha256}`, "Skill digest mismatch");
  assert(kernel.estimated_tokens <= manifest.budgets.kernel_hard_max, `Kernel exceeds hard ceiling: ${kernel.estimated_tokens}`);
  assert(kernel.estimated_tokens >= manifest.budgets.kernel_target_min, `Kernel is below target range: ${kernel.estimated_tokens}`);
  assert(kernel.estimated_tokens <= manifest.budgets.kernel_target_max, `Kernel is above target range: ${kernel.estimated_tokens}`);

  return {
    verified: true,
    manifest: lock.manifest,
    estimator: lock.estimator,
    kernel_tokens: kernel.estimated_tokens,
    module_count: manifest.modules.length
  };
}

function sectionDestination(section, text) {
  const normalized = `${section} ${text}`.toLowerCase();
  if (/local organization|organization policy|local project|project policy|repository-specific/.test(normalized)) return "governance/modules/project-overlays.md";
  if (/local storage|artifact root|review export|internal storage/.test(normalized)) return "governance/modules/storage.md";
  if (/disk usage|model storage|heavy-work|preferred tool routing|rust|xcode|python|node|docker|browser automation|mobile review export lane/.test(section.toLowerCase())) return "governance/modules/storage.md";
  if (/planning capacity|token efficiency/.test(section.toLowerCase())) return "governance/modules/planning-and-capacity.md";
  if (/execution model|planning responsibility|subagent model assignment/.test(section.toLowerCase())) return "governance/modules/model-routing.md";
  if (/context pack/.test(section.toLowerCase())) return "governance/modules/context-routing.md";
  if (/validated work commit|project continuity|work resume|handoff/.test(section.toLowerCase())) return "governance/modules/continuity.md";
  if (/subagent continuity|delegation and roundtables/.test(section.toLowerCase())) return "governance/modules/delegation.md";
  if (/subagent git|10b\./.test(section.toLowerCase())) return "governance/modules/subagent-git.md";
  if (/validation contract|reporting contract/.test(section.toLowerCase())) return "governance/modules/validation-and-evidence.md";
  if (/adversarial review|deep audit/.test(section.toLowerCase())) return "governance/modules/deep-audit.md";
  if (/finding classification/.test(section.toLowerCase())) return "governance/modules/findings.md";
  if (/overlay pattern/.test(section.toLowerCase())) return "governance/modules/project-overlays.md";
  if (/mobile review delivery/.test(section.toLowerCase())) return "governance/modules/mobile-review.md";
  if (/release|sprint or workstream completion/.test(section.toLowerCase())) return "governance/modules/release.md";
  return "governance/kernel/AGENTS.md";
}

function headingCandidate(line) {
  const value = line.trim().replace(/^#+\s*/, "");
  const known = [
    "Disk Usage Policy", "Model Storage Exception", "Repository and Generated-Work Separation",
    "Mobile Review Export Lane", "Generated Work Root", "Canonical Generated-Work Layout",
    "Heavy-Work Preflight", "Preferred Tool Routing", "Rust", "Xcode and Swift", "Python", "Node",
    "Docker", "Browser Automation", "Codex and Session Output", "Codex Execution Constitution",
    "Truth Contract", "Response Depth Preference", "Planning Capacity Contract", "Estimate", "Available",
    "Recommendation", "Execution Model Selection", "Luna", "Terra", "GPT-5.3-Codex-Spark", "Sol",
    "Planning Responsibility", "Subagent Model Assignment Contract", "Token Efficiency Without Capability Loss",
    "1. Precedence", "2. Project Resolution", "3. Scope and Roots", "4. Context Pack Contract",
    "5. Global Execution Defaults", "5A. Validated Work Commit Contract", "5B. Project Continuity Memory Contract",
    "5C. Work Resume and Handoff Contract", "5D. Subagent Continuity Contract", "5E. Subagent Git Isolation Contract",
    "6. Validation Contract", "7. Reporting Contract", "8. Delegation and Roundtables",
    "9. Adversarial Review Contract", "10. Deep Audit Mode", "10A. Finding Classification Standard",
    "10B. (Update) Mutating subagents", "11. Overlay Pattern", "12. Mobile Review Delivery Contract",
    "Completion Contract — Authoritative", "Completion Contract - Authoritative", "Autonomy Rule"
  ];
  return known.find((heading) => value === heading || value.startsWith(heading)) ?? null;
}

export function generateTraceability(sourceRoot = codeRoot) {
  const legacyFile = path.join(sourceRoot, "governance", "legacy", "AGENTS.global-legacy.md");
  const content = fs.readFileSync(legacyFile, "utf8");
  const lines = content.split("\n");
  const rules = [];
  let section = "Global";
  let sequence = 0;

  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const heading = headingCandidate(trimmed);
    if (heading) section = heading;
    sequence += 1;
    const ruleId = `LEGACY-${String(sequence).padStart(5, "0")}`;
    let disposition = "moved";
    let rationale = "Canonicalized into the routed kernel, module, profile, or project overlay.";
    if (/10B\.|\(Update\) Mutating subagents/i.test(section)) {
      disposition = "consolidated";
      rationale = "Duplicate subagent return requirements are owned by subagent-git.";
    } else if (section === "Global" || /Truth Contract|Precedence|Project Resolution|Scope and Roots|Global Execution Defaults|Completion Contract|Autonomy Rule/.test(section)) {
      disposition = "retained";
      rationale = "Always-loaded invariant retained in the compact kernel.";
    }
    rules.push({
      rule_id: ruleId,
      source_line: index + 1,
      source_sha256: `sha256:${sha256(raw)}`,
      section,
      excerpt: trimmed.slice(0, 240)
    });
    rules[rules.length - 1].destination = sectionDestination(section, trimmed);
    rules[rules.length - 1].disposition = disposition;
    rules[rules.length - 1].rationale = rationale;
  });

  const inventory = {
    schema_version: 1,
    source: "governance/legacy/AGENTS.global-legacy.md",
    source_sha256: `sha256:${sha256(Buffer.from(content))}`,
    source_nonempty_line_count: rules.length,
    rules: rules.map(({ destination, disposition, rationale, ...rule }) => rule)
  };
  const mapping = {
    schema_version: 1,
    source_sha256: inventory.source_sha256,
    rules
  };
  const traceabilityRoot = path.join(sourceRoot, "governance", "traceability");
  writeJsonAtomic(path.join(traceabilityRoot, "legacy-rule-inventory.json"), inventory);
  writeJsonAtomic(path.join(traceabilityRoot, "rule-destination-map.json"), mapping);

  const byDestination = Object.entries(Object.groupBy(rules, (rule) => rule.destination))
    .sort(([a], [b]) => a.localeCompare(b));
  const byDisposition = Object.entries(Object.groupBy(rules, (rule) => rule.disposition))
    .sort(([a], [b]) => a.localeCompare(b));
  const report = [
    "# Governance Migration Traceability",
    "",
    `Source digest: ${inventory.source_sha256}`,
    `Mapped non-empty legacy lines: ${rules.length}`,
    "",
    "## Canonical Destinations",
    "",
    ...byDestination.map(([destination, entries]) => `- ${destination}: ${entries.length}`),
    "",
    "## Dispositions",
    "",
    ...byDisposition.map(([disposition, entries]) => `- ${disposition}: ${entries.length}`),
    "",
    "Every source record has one stable rule ID, one disposition, and one canonical destination.",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(traceabilityRoot, "TRACEABILITY.md"), report, "utf8");
  return { rules: rules.length, source_sha256: inventory.source_sha256 };
}

function contextTargetFor(manifest, mode) {
  if (mode === "deep_audit") return manifest.budgets.closures.deep_audit;
  if (mode === "delegation") return manifest.budgets.closures.delegation;
  if (mode === "mutation") return manifest.budgets.closures.mutation;
  return manifest.budgets.closures.read_only;
}

function normalizeRequest(input, policyRoot) {
  validateAgainstSchema(policyRoot, "route-request", input);
  assert(input && typeof input === "object" && !Array.isArray(input), "Route request must be an object");
  assert(["read_only", "delegation", "mutation", "deep_audit"].includes(input.mode), "mode must be read_only, delegation, mutation, or deep_audit");
  assert(typeof input.phase === "string" && input.phase.length > 0, "phase is required");
  assert(typeof input.project === "string" && input.project.length > 0, "project is required");
  assert(Array.isArray(input.operations) && input.operations.length > 0, "operations must contain the immediate operation");
  return {
    mode: input.mode,
    phase: input.phase,
    project: input.project,
    operations: [...new Set(input.operations)],
    future_operations: Array.isArray(input.future_operations) ? input.future_operations : [],
    tools: Array.isArray(input.tools) ? input.tools : [],
    paths: Array.isArray(input.paths) ? input.paths : [],
    risk_tags: Array.isArray(input.risk_tags) ? input.risk_tags : [],
    mutation_authority: input.mutation_authority === true,
    authorities: Array.isArray(input.authorities) ? [...new Set(input.authorities)] : [],
    runtime_capabilities: input.runtime_capabilities && typeof input.runtime_capabilities === "object" ? input.runtime_capabilities : {},
    local_organization_index: input.local_organization_index ?? null,
    local_project_root: input.local_project_root ?? null,
    subagent_worktree_receipt: input.subagent_worktree_receipt ?? null,
    prior_receipt: input.prior_receipt ?? null,
    objective: typeof input.objective === "string" ? input.objective : null,
    verified_state: input.verified_state ?? null,
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    open_work: Array.isArray(input.open_work) ? input.open_work : []
  };
}

export function receiptDigest(receipt) {
  const copy = structuredClone(receipt);
  delete copy.receipt_sha256;
  return `sha256:${sha256(canonicalJson(copy))}`;
}

function contextLedgerFromLock(lock) {
  return {
    kernel: {
      digest: lock.kernel.sha256,
      estimated_tokens: lock.kernel.estimated_tokens,
      source: "base_context"
    },
    "govern-codex-policy": {
      digest: lock.skill.sha256,
      estimated_tokens: lock.skill.estimated_tokens,
      source: "base_context"
    }
  };
}

function ledgerTotal(ledger) {
  return Object.values(ledger).reduce((sum, entry) => sum + entry.estimated_tokens, 0);
}

function validateContextLedger(ledger, receipt, manifest, lock) {
  assert(ledger && typeof ledger === "object" && !Array.isArray(ledger), "Context ledger is invalid");
  const known = new Map(lock.modules.map((module) => [module.id, module]));
  const local = new Map((receipt.local_policy_descriptors ?? []).map((descriptor) => [descriptor.id, descriptor]));
  for (const [id, descriptor] of local) {
    assert(!known.has(id), `Local policy descriptor collides with global module: ${id}`);
    assert(/^sha256:[a-f0-9]{64}$/.test(descriptor.digest ?? ""), `Local policy descriptor digest is invalid: ${id}`);
    assert(Number.isInteger(descriptor.estimated_tokens) && descriptor.estimated_tokens >= 0, `Local policy descriptor token estimate is invalid: ${id}`);
  }
  const expectedBase = contextLedgerFromLock(lock);
  for (const [id, expected] of Object.entries(expectedBase)) {
    assert(ledger[id], `Context ledger omits ${id}`);
    assert(canonicalJson(ledger[id]) === canonicalJson(expected), `Context ledger differs for ${id}`);
  }
  for (const [id, entry] of Object.entries(ledger)) {
    if (expectedBase[id]) continue;
    const module = known.get(id) ?? local.get(id);
    assert(module, `Context ledger includes unknown module: ${id}`);
    const digest = module.sha256 ?? module.digest;
    assert(entry.digest === digest, `Context ledger digest differs for ${id}`);
    assert(entry.estimated_tokens === module.estimated_tokens, `Context ledger token estimate differs for ${id}`);
    assert(entry.source === (local.has(id) ? "delivered_local_policy" : "delivered_module"), `Context ledger source is invalid for ${id}`);
  }
  const ids = Object.keys(ledger).sort();
  assert(canonicalJson(ids) === canonicalJson([...receipt.already_in_context].sort()), "Context ledger and module list differ");
  assert(ledgerTotal(ledger) === receipt.accumulated_policy_tokens, "Accumulated policy tokens do not equal the ledger");
  assert(Array.isArray(receipt.receipt_chain), "Receipt chain is missing");
  assert(new Set(receipt.receipt_chain).size === receipt.receipt_chain.length, "Receipt chain contains duplicate events");
  assert(Array.isArray(receipt.delivery_history), "Delivery history is missing");
  const reconstructed = contextLedgerFromLock(lock);
  for (const event of receipt.delivery_history) {
    assert(typeof event.delivery_receipt_sha256 === "string", "Delivery history receipt reference is invalid");
    assert(receipt.receipt_chain.includes(event.delivery_receipt_sha256), "Delivery history is not represented in the receipt chain");
    assert(Array.isArray(event.modules), "Delivery history modules are invalid");
    for (const delivered of event.modules) {
      const module = known.get(delivered.id) ?? local.get(delivered.id);
      assert(module, `Delivery history includes unknown module: ${delivered.id}`);
      assert(!reconstructed[delivered.id], `Delivery history repeats module: ${delivered.id}`);
      assert(delivered.digest === (module.sha256 ?? module.digest) && delivered.estimated_tokens === module.estimated_tokens, `Delivery history differs for ${delivered.id}`);
      reconstructed[delivered.id] = {
        digest: delivered.digest,
        estimated_tokens: delivered.estimated_tokens,
        source: local.has(delivered.id) ? "delivered_local_policy" : "delivered_module"
      };
    }
  }
  assert(canonicalJson(reconstructed) === canonicalJson(ledger), "Context ledger is not derivable from delivery history");
  return true;
}

function validateReceiptIdentity(receipt, type, manifest, lock, policyRoot) {
  validateAgainstSchema(policyRoot, "receipt", receipt);
  assert(receipt.receipt_type === type, `Expected ${type}`);
  assert(receipt.manifest?.sha256 === lock.manifest.sha256, "Receipt manifest differs from active manifest");
  assert(receipt.manifest?.id === manifest.id && receipt.manifest?.version === manifest.version, "Receipt manifest identity is invalid");
  assert(receiptDigest(receipt) === receipt.receipt_sha256, "Receipt digest is invalid");
}

function readMachineProfile() {
  const explicitProfile = process.env.ACG_MACHINE_PROFILE;
  const profileFile = explicitProfile || path.join(os.homedir(), ".codex", "governance-machine-profile.json");
  const absoluteProfile = assertAbsoluteWithoutTraversal(profileFile, explicitProfile ? "ACG_MACHINE_PROFILE" : "Default machine profile");
  if (!fs.existsSync(absoluteProfile) && !explicitProfile) return {};
  assert(fs.existsSync(absoluteProfile), `${explicitProfile ? "ACG_MACHINE_PROFILE" : "Default machine profile"} is unreadable`);
  const profile = readJson(absoluteProfile);
  assert(profile && typeof profile === "object" && !Array.isArray(profile), "Machine profile must contain a JSON object");
  return profile;
}

function editableMachineProfile(profileFile = null) {
  const configured = profileFile || process.env.ACG_MACHINE_PROFILE || path.join(os.homedir(), ".codex", "governance-machine-profile.json");
  const file = assertAbsoluteWithoutTraversal(configured, "Machine profile");
  const profile = fs.existsSync(file) ? readJson(file) : { schema_version: 1 };
  assert(profile && typeof profile === "object" && !Array.isArray(profile), "Machine profile must contain a JSON object");
  assert(profile.schema_version === undefined || profile.schema_version === 1, "Unsupported machine profile schema version");
  profile.schema_version = 1;
  return { file, profile };
}

function requireProfileWriteAuthority(value) {
  assert(value === true, "Machine profile write requires --authorize-profile-write from direct operator authority");
}

export function addMachineProjectRoot(options, profileFile = null) {
  requireProfileWriteAuthority(options?.authorizeProfileWrite);
  assert(typeof options?.project === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(options.project), "Project slug is invalid");
  assert(typeof options?.path === "string", "Project root is required");
  const requestedRoot = assertAbsoluteWithoutTraversal(options.path, "Project root");
  assert(fs.existsSync(requestedRoot) && fs.statSync(requestedRoot).isDirectory(), `Project root is not a directory: ${requestedRoot}`);
  const root = fs.realpathSync(requestedRoot);
  const { file, profile } = editableMachineProfile(profileFile);
  if (profile.project_roots === undefined) profile.project_roots = {};
  assert(profile.project_roots && typeof profile.project_roots === "object" && !Array.isArray(profile.project_roots), "Machine project_roots must be an object");
  const existing = Array.isArray(profile.project_roots[options.project]) ? profile.project_roots[options.project] : [];
  const roots = [...new Set([...existing, root])].sort();
  const changed = canonicalJson(existing) !== canonicalJson(roots);
  profile.project_roots[options.project] = roots;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (changed || !fs.existsSync(file)) writeJsonAtomic(file, profile);
  return { schema_version: 1, command: "profile add-root", profile: file, project: options.project, root, changed };
}

export function removeMachineProjectRoot(options, profileFile = null) {
  requireProfileWriteAuthority(options?.authorizeProfileWrite);
  assert(typeof options?.project === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(options.project), "Project slug is invalid");
  assert(typeof options?.path === "string", "Project root is required");
  const root = canonicalPathForComparison(assertAbsoluteWithoutTraversal(options.path, "Project root"));
  const { file, profile } = editableMachineProfile(profileFile);
  assert(profile.project_roots && typeof profile.project_roots === "object" && !Array.isArray(profile.project_roots), "Machine project_roots must be an object");
  const existing = Array.isArray(profile.project_roots[options.project]) ? profile.project_roots[options.project] : [];
  const roots = existing.filter((entry) => canonicalPathForComparison(entry) !== root).sort();
  const changed = canonicalJson(existing) !== canonicalJson(roots);
  if (roots.length > 0) profile.project_roots[options.project] = roots;
  else delete profile.project_roots[options.project];
  if (changed) writeJsonAtomic(file, profile);
  return { schema_version: 1, command: "profile remove-root", profile: file, project: options.project, root, changed, roots };
}

export function configureApprovalMode(options, profileFile = null) {
  requireProfileWriteAuthority(options?.authorizeProfileWrite);
  const modes = ["ask", "approve_for_me", "full"];
  assert(modes.includes(options?.mode), `Approval mode is invalid. Valid values: ${modes.join(", ")}`);
  const { file, profile } = editableMachineProfile(profileFile);
  const changed = profile.approval_mode !== options.mode;
  profile.approval_mode = options.mode;
  if (changed || !fs.existsSync(file)) writeJsonAtomic(file, profile);
  return { schema_version: 1, command: "profile approval", profile: file, approval_mode: options.mode, changed };
}

export function readAgentSystemProfile(profileFile = null) {
  const { file, profile } = editableMachineProfile(profileFile);
  const agentSystem = normalizeAgentSystemProfile(profile.agent_system);
  return {
    schema_version: 1,
    command: "profile agent-system",
    profile: file,
    configured: Boolean(agentSystem),
    agent_system: agentSystem,
    consent: agentSystem?.consent ?? agentSystemConsentContract(null),
    legacy_thread_id_ignored: Boolean(profile.agent_system?.thread_id),
    reporting_contract: agentSystemReportingContract(agentSystem)
  };
}

function normalizeAgentSystemProfile(agentSystem) {
  if (!agentSystem) return null;
  const label = normalizeAgentSystemLabel(agentSystem.label ?? agentSystem.title ?? "Agent System");
  const consent = agentSystemConsentContract(agentSystem.consent, agentSystem.consent === undefined ? agentSystem : null);
  return {
    label,
    match_field: "title",
    match_mode: "exact_non_archived",
    memory_path: agentSystem.memory_path,
    auto_create: agentSystem.auto_create === true,
    auto_report: agentSystem.auto_report === true,
    consent
  };
}

function agentSystemConsentContract(consent, legacy = null) {
  if (legacy) {
    return {
      decision_required: false,
      source: "legacy_explicit_settings",
      persistent_task: "granted",
      automatic_defect_reports: legacy.auto_report ? "granted" : "declined",
      reported_defect_action: legacy.auto_report ? "log_only" : null,
      token_cost_acknowledged: "Unverified",
      migration: legacy.auto_report ? "legacy_automatic_report_migrated_to_log_only" : "legacy_reporting_disabled"
    };
  }
  if (!consent) {
    return {
      decision_required: true,
      source: "absent",
      persistent_task: "undecided",
      automatic_defect_reports: "undecided",
      reported_defect_action: "undecided",
      token_cost_acknowledged: false,
      next_actions: [
        "profile agent-system --persistent-task yes|no --automatic-defect-report yes|no [--reported-defect-action log_only|auto_correct when reporting is enabled] --acknowledge-agent-system-token-cost --authorize-profile-write",
        "Both persistent tasks and automatic reports can consume tokens; make each choice explicitly."
      ]
    };
  }
  const valid = ["granted", "declined"];
  const automaticDefectReports = consent.automatic_defect_reports ?? consent.automatic_reports;
  const migratedLegacyConsent = consent.automatic_defect_reports === undefined && consent.automatic_reports !== undefined;
  assert(valid.includes(consent.persistent_task) && valid.includes(automaticDefectReports), "Agent System consent choices must be granted or declined");
  assert(consent.token_cost_acknowledged === true, "Agent System consent requires token-cost acknowledgment");
  assert(!(consent.persistent_task === "declined" && automaticDefectReports === "granted"), "Automatic defect reports require persistent Agent System task consent");
  const reportedDefectAction = automaticDefectReports === "granted"
    ? (migratedLegacyConsent ? "log_only" : (consent.reported_defect_action ?? "log_only"))
    : null;
  assert(reportedDefectAction === null || ["log_only", "auto_correct"].includes(reportedDefectAction), "Reported defect action must be log_only or auto_correct when reporting is enabled");
  return {
    decision_required: false,
    source: migratedLegacyConsent ? "legacy_consent_migrated" : "explicit",
    persistent_task: consent.persistent_task,
    automatic_defect_reports: automaticDefectReports,
    reported_defect_action: reportedDefectAction,
    token_cost_acknowledged: true,
    ...(migratedLegacyConsent ? { migration: "legacy_automatic_report_consent_migrated_to_log_only" } : {})
  };
}

function normalizeAgentSystemLabel(value) {
  assert(
    typeof value === "string" &&
      value === value.trim() &&
      value.length >= 1 &&
      value.length <= 80 &&
      !/[\u0000-\u001f\u007f]/u.test(value),
    "Agent System label must be 1-80 trimmed characters without control characters"
  );
  return value;
}

function agentSystemReportingContract(agentSystem) {
  const active = agentSystem?.consent?.persistent_task === "granted";
  const enabled = automaticDefectReportingEnabled(agentSystem);
  const reportedDefectAction = enabled ? agentSystem.consent.reported_defect_action : null;
  const label = agentSystem?.label ?? "Agent System";
  const deliveryUnavailable = {
    flag: "agent_system_delivery_unavailable",
    disposition: "record_bounded_private_jsonl_and_continue_safe_in_scope_project_work",
    local_fallback_command: "agent-system record-issue --delivery-unavailable",
    continuation: "continue_safe_in_scope_project_work_without_waiting_for_agent_system"
  };
  return {
    mode: active ? (enabled ? "active" : "active_without_automatic_reports") : "inactive_local_only",
    automatic_reporting_enabled: enabled,
    reported_defect_action: reportedDefectAction,
    automatic_kpi_reporting_enabled: false,
    trigger: "confirmed_or_suspected_agent_system_governance_or_runtime_defect",
    caller_action: enabled
      ? "list_current_tasks_then_send_one_secret_free_report_to_the_exact_non_archived_label_match_without_waiting_for_operator_prompt"
      : "append one bounded secret-free private JSONL record; do not list, create, wake, or message any task",
    target_lookup: enabled ? {
      label,
      runtime_field: "title",
      match: "exact",
      candidate_filter: "non_archived",
      singleton_rule: "exactly_one_non_archived_canonical_label",
      current_task_rule: "resolve_at_delivery_time",
      no_match: "record_private_delivery_unavailable_and_continue_safe_in_scope_project_work",
      multiple_matches: "record_private_duplicate_resolution_required_and_continue_safe_in_scope_project_work",
      thread_id_semantics: "ephemeral_delivery_handle_returned_by_runtime_lookup_only",
      replacement_workflow: {
        stage_new_title: `${label} - Incoming`,
        keep_previous_canonical_until_replacement_is_ready: true,
        rename_previous_title_prefix: `${label} - Old`,
        unpin_previous_task: true,
        pin_replacement_task: true,
        assign_canonical_label_after_previous_rename: true,
        verify_exact_non_archived_match_count: 1,
        pinned_ordering: "best_effort_runtime_behavior_unverified"
      }
    } : null,
    persistent_task_creation: active && agentSystem?.auto_create === true ? {
      exact_label: label,
      attempt_limit: 1,
      no_task_disposition: "attempt_exact_agent_system_task_creation_once_then_record_bounded_private_jsonl_on_failure",
      failure: deliveryUnavailable
    } : null,
    duplicate_policy: "deduplicate_unchanged_evidence_before_delivery",
    disposition: enabled && reportedDefectAction === "auto_correct"
      ? {
          repair_authorization: "bounded_private_agent_system_repair_only",
          prohibited: ["reporting_project_mutation", "public_publication", "destructive_operation", "architecture_change", "schedules", "automatic_kpi_reporting"],
          continuation: "continue_safe_in_scope_project_work_without_waiting_for_agent_system"
        }
      : {
          repair_authorization: "none",
          behavior: enabled ? "record_and_deduplicate_without_repair" : "private_local_issue_jsonl",
          continuation: "continue_safe_in_scope_project_work_without_waiting_for_agent_system"
        },
    project_effect: "continue_safe_in_scope_project_work",
    report_transport: enabled ? "runtime_task_message_tool_required" : "none",
    runtime_task_message_action: enabled ? "caller_must_resolve_exact_current_task_before_delivery" : null,
    local_cli_transport: enabled ? "agent-system record-issue --delivery-unavailable" : "agent-system record-issue",
    delivery_unavailable: enabled ? deliveryUnavailable : null,
    host_interception: "Unverified",
    enforcement: "caller_required_unless_authoritative_host_hook_attests_delivery"
  };
}

function automaticDefectReportingEnabled(agentSystem) {
  return agentSystem?.consent?.persistent_task === "granted" &&
    agentSystem?.consent?.automatic_defect_reports === "granted" &&
    agentSystem?.auto_report === true;
}

function currentContextBootstrapFiles(policyRoot) {
  const sourceRoot = resolveSourceRoot(policyRoot);
  const kernelPath = path.basename(policyRoot) === "governance"
    ? path.join(policyRoot, "kernel", "AGENTS.md")
    : path.join(sourceRoot, "AGENTS.md");
  const records = [
    ["kernel", kernelPath],
    ["govern-codex-policy", path.join(sourceRoot, "skills", "govern-codex-policy", "SKILL.md")],
    ["agent-system-role", path.join(sourceRoot, "docs", "agent-system-role.md")]
  ];
  return records.map(([id, file]) => {
    assert(fs.existsSync(file) && fs.statSync(file).isFile(), `Current Agent System bootstrap file is missing: ${id}`);
    const bytes = fs.readFileSync(file);
    return {
      id,
      path: fs.realpathSync(file),
      sha256: sha256(bytes),
      bytes: bytes.length,
      load: "read_completely_in_declared_order"
    };
  });
}

export function adoptCurrentContext(options = {}, policyRoot = resolvePolicyRoot()) {
  assert(
    options.operatorConfirmedPreHook === true,
    "Current-context adoption requires authoritative operator confirmation that the task predates current launch hooks"
  );
  const sourceRoot = resolveSourceRoot(policyRoot);
  const releaseFile = path.join(sourceRoot, "release.json");
  const release = fs.existsSync(releaseFile)
    ? verifyRelease(sourceRoot)
    : {
        release_id: "Unreleased source candidate",
        system_version: readJson(path.join(sourceRoot, "package.json")).version,
        display_channel: readJson(path.join(sourceRoot, "package.json")).display_channel,
        source_commit: "Unverified"
      };
  const bootstrapFiles = currentContextBootstrapFiles(policyRoot);
  const adoptionIdentity = /^v1-[a-f0-9]{16,}$/u.test(release.release_id)
    ? release.release_id.slice(3, 19)
    : sha256(canonicalJson({
        release_id: release.release_id,
        system_version: release.system_version,
        bootstrap: bootstrapFiles.map((record) => record.sha256)
      })).slice(0, 16);
  return {
    schema_version: 1,
    command: options.command ?? "context adopt-current",
    context_class: "operator_confirmed_pre_hook_current_policy_adoption",
    adoption_status: "ready",
    adoption_level: "current_policy_complete_runtime_hook_degraded",
    current_release: {
      release_id: release.release_id,
      system_version: release.system_version ?? "Unversioned legacy release",
      display_channel: release.display_channel ?? "Unversioned legacy release",
      source_commit: release.source_commit,
      immutable_release_verified: fs.existsSync(releaseFile)
    },
    required_bootstrap_files: bootstrapFiles,
    load_contract: {
      order: bootstrapFiles.map((record) => record.id),
      read_every_file_completely: true,
      route_immediate_operations_with_current_high_level_cli: true,
      legacy_prior_receipt_rule: "Do not pass an old-release receipt into the adopted current-release ledger.",
      module_rule: "Load only the current module delta required for the immediate operation.",
      acknowledgment: "The caller must state that all bootstrap files were read before claiming current-policy adoption."
    },
    runtime_capability: {
      launch_hooks: "absent_by_operator_confirmation",
      resume_hook_execution: "Unverified",
      host_interception: "Unverified",
      policy_behavior: "available_after_load_contract",
      high_level_cli_and_receipts: "available",
      mechanical_hook_enforcement: "degraded"
    },
    existing_authority_may_continue: true,
    authority_effect: "none",
    operator_confirmation_runtime_attested: false,
    operator_confirmation_requirement: "direct_operator_statement_or_authoritative_runtime_metadata_outside_this_cli",
    same_task_continuation_default: true,
    fresh_handoff_recommended: false,
    fresh_handoff_required_when: [
      "a_major_feature_requires_launch_time_hook_or_host_interception_evidence",
      "a_mutating_model_critical_seat_requires_pre_launch_enforcement_that_the_runtime_cannot_prove",
      "the_hosting_runtime_authoritatively_rejects_further_context_for_capacity",
      "old_and_current_contracts_conflict_materially_and_direct_authority_cannot_resolve_them"
    ],
    warning: "LEGACY CONTEXT ADOPTED: current policy and high-level helpers may govern this task after the load contract; launch-time hook enforcement remains Unverified.",
    warning_boundaries: [
      "initial_adoption",
      "before_a_major_feature_that_depends_on_missing_runtime_enforcement"
    ],
    warning_enforcement: "caller_required_unverified",
    evidence_limits: [
      "launch-time hook enforcement remains unavailable or Unverified",
      "delegated isolation and actual model routing remain Unverified unless independently attested"
    ],
    completion_sentinel: `ACG_CURRENT_CONTEXT_ADOPTION_READY:${adoptionIdentity}`
  };
}

export function legacyContextGuidance(options = {}, policyRoot = resolvePolicyRoot()) {
  return {
    ...adoptCurrentContext({ ...options, command: "context legacy" }, policyRoot),
    deprecated_alias_for: "context adopt-current"
  };
}

export function configureAgentSystemProfile(options, profileFile = null) {
  requireProfileWriteAuthority(options?.authorizeProfileWrite);
  assert(typeof options?.persistentTask === "boolean", "Persistent Agent System task choice is required; use yes or no");
  assert(typeof options?.automaticDefectReport === "boolean", "Automatic defect report choice is required; use yes or no");
  assert(options?.acknowledgeTokenCost === true, "Agent System configuration requires --acknowledge-agent-system-token-cost; both choices can consume tokens");
  const label = normalizeAgentSystemLabel(options?.label ?? "Agent System");
  assert(!(options.automaticDefectReport && !options.persistentTask), "Automatic defect reports require persistent Agent System task consent");
  assert(options.automaticDefectReport || options.reportedDefectAction === undefined, "--reported-defect-action is only allowed when automatic defect reporting is enabled");
  const reportedDefectAction = options.automaticDefectReport ? options.reportedDefectAction : null;
  assert(!options.automaticDefectReport || ["log_only", "auto_correct"].includes(reportedDefectAction), "Automatic defect reporting requires --reported-defect-action log_only or auto_correct");
  const memoryPath = options.memoryPath === undefined ? null : assertAbsoluteWithoutTraversal(options.memoryPath, "Agent System memory path");
  if (memoryPath) assert(fs.existsSync(memoryPath) && fs.statSync(memoryPath).isFile(), `Agent System memory is unreadable: ${memoryPath}`);
  const { file, profile } = editableMachineProfile(profileFile);
  profile.agent_system = {
    label,
    match_field: "title",
    match_mode: "exact_non_archived",
    memory_path: memoryPath ? fs.realpathSync(memoryPath) : null,
    auto_create: options.persistentTask,
    auto_report: options.automaticDefectReport,
    consent: {
      persistent_task: options.persistentTask ? "granted" : "declined",
      automatic_defect_reports: options.automaticDefectReport ? "granted" : "declined",
      reported_defect_action: reportedDefectAction,
      token_cost_acknowledged: true
    }
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, profile);
  fs.chmodSync(file, 0o600);
  return {
    schema_version: 1,
    command: "profile agent-system",
    profile: file,
    configured: true,
    agent_system: profile.agent_system,
    provided_thread_id_ignored: options?.threadId !== undefined,
    reporting_contract: agentSystemReportingContract(profile.agent_system)
  };
}

function assertSafeLocalIssueText(value, field, maximum, required = true) {
  if (!required && value === undefined) return null;
  assert(typeof value === "string" && value.length >= (required ? 1 : 0) && value.length <= maximum, `${field} must be a bounded string`);
  assert(value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value), `${field} must be trimmed and contain no control characters`);
  assert(!/(?:-----BEGIN|\b(?:prompt|source|model\s+output)\s*[:=]\s*\S+|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*\S+|\bsk-[A-Za-z0-9_-]{8,}|\bAKIA[0-9A-Z]{16})/iu.test(value), `${field} contains prohibited raw-content or secret-bearing material`);
  return value;
}

export function recordLocalAgentSystemIssue(options, profileFile = null) {
  const { file, profile } = editableMachineProfile(profileFile);
  const normalized = normalizeAgentSystemProfile(profile.agent_system);
  const automaticReportingEnabled = automaticDefectReportingEnabled(normalized);
  const deliveryUnavailable = options?.deliveryUnavailable === true;
  assert(!automaticReportingEnabled || deliveryUnavailable, "Local issue recording is unavailable while automatic reporting is enabled unless --delivery-unavailable is supplied");
  const project = assertSafeLocalIssueText(options?.project, "Project", 64);
  assert(/^[a-z0-9][a-z0-9._-]{0,63}$/iu.test(project), "Project must be a stable slug");
  const issueId = assertSafeLocalIssueText(options?.issueId, "Issue ID", 80);
  assert(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(issueId), "Issue ID is invalid");
  const severity = assertSafeLocalIssueText(options?.severity, "Severity", 2);
  assert(["P0", "P1", "P2", "P3", "P4"].includes(severity), "Severity must be P0, P1, P2, P3, or P4");
  const summary = assertSafeLocalIssueText(options?.summary, "Issue summary", 800);
  const evidenceClass = assertSafeLocalIssueText(options?.evidenceClass, "Evidence class", 16, false);
  if (evidenceClass) assert(["Observed", "Inferred", "Proposed", "Unknown", "Unverified"].includes(evidenceClass), "Evidence class is invalid");
  const evidence = assertSafeLocalIssueText(options?.evidence, "Issue evidence", 1600, false);
  assert(!evidence || evidenceClass, "Evidence class is required when evidence is supplied");
  const ledger = path.join(path.dirname(file), "agent-system-local-issues.jsonl");
  fs.mkdirSync(path.dirname(ledger), { recursive: true, mode: 0o700 });
  const fingerprint = sha256(canonicalJson({ project, issue_id: issueId, severity, summary, ...(evidenceClass ? { evidence_class: evidenceClass } : {}), ...(evidence ? { evidence } : {}) }));
  const existing = fs.existsSync(ledger)
    ? fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  if (existing.some((entry) => entry.fingerprint === fingerprint)) {
    return {
      schema_version: 1,
      command: "agent-system record-issue",
      mode: deliveryUnavailable ? "delivery_unavailable_local_fallback" : "local_only",
      delivery_unavailable: deliveryUnavailable,
      disposition: deliveryUnavailable ? "record_bounded_private_jsonl_and_continue_safe_in_scope_project_work" : null,
      recorded: false,
      deduplicated: true,
      local_ledger: ledger
    };
  }
  const descriptor = fs.openSync(ledger, "a", 0o600);
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeSync(descriptor, `${JSON.stringify({ schema_version: 1, event_id: crypto.randomUUID(), recorded_at: new Date().toISOString(), fingerprint, project, issue_id: issueId, severity, summary, ...(evidenceClass ? { evidence_class: evidenceClass } : {}), ...(evidence ? { evidence } : {}), ...(deliveryUnavailable ? { delivery_unavailable: true, disposition: "record_bounded_private_jsonl_and_continue_safe_in_scope_project_work" } : {}) })}\n`, null, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return {
    schema_version: 1,
    command: "agent-system record-issue",
    mode: deliveryUnavailable ? "delivery_unavailable_local_fallback" : "local_only",
    delivery_unavailable: deliveryUnavailable,
    disposition: deliveryUnavailable ? "record_bounded_private_jsonl_and_continue_safe_in_scope_project_work" : null,
    recorded: true,
    deduplicated: false,
    local_ledger: ledger
  };
}

function canonicalPathForComparison(value) {
  const absolute = path.resolve(value);
  const remainder = [];
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return absolute;
    remainder.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...remainder);
}

function stableProjectSlug(value) {
  assert(typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value), "Project slug is invalid");
  return value;
}

function pathWithin(candidate, root) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

// A current helper receipt names its project and is therefore self-binding.
// Legacy receipts predate that field.  They can continue only when the private
// project profile proves that both repository and worktree belong to exactly
// one registered mutation project, which must be the requested project.
export function bindContinuationProject({ project, receiptProject, repository, worktree }) {
  const requested = stableProjectSlug(project);
  if (receiptProject !== undefined) {
    assert(stableProjectSlug(receiptProject) === requested, "Continuation receipt project does not match --project");
    return { project: requested, provenance_class: "receipt_project_bound" };
  }

  const resolvedRepository = canonicalPathForComparison(assertAbsoluteWithoutTraversal(repository, "Continuation repository"));
  const resolvedWorktree = canonicalPathForComparison(assertAbsoluteWithoutTraversal(worktree, "Continuation worktree"));
  const profile = readMachineProfile();
  const candidates = Object.entries(profile.project_roots ?? {})
    .filter(([, roots]) => Array.isArray(roots))
    .filter(([, roots]) => {
      const resolvedRoots = roots.map((root) => canonicalPathForComparison(assertAbsoluteWithoutTraversal(root, "Machine project root")));
      // A project may deliberately register its repository and worktree lane
      // as separate narrow roots.  Both identities must still be admitted by
      // this one project; a root for only one identity is insufficient.
      return resolvedRoots.some((root) => pathWithin(resolvedRepository, root))
        && resolvedRoots.some((root) => pathWithin(resolvedWorktree, root));
    })
    .map(([candidate]) => stableProjectSlug(candidate))
    .sort();
  assert(candidates.length === 1 && candidates[0] === requested,
    "Legacy continuation receipt lacks project binding; repository/worktree must resolve uniquely to the requested project profile");
  return { project: requested, provenance_class: "legacy_unique_project_profile" };
}

function subagentCommonGitDirectory(cwd) {
  const value = gitReadOnly(cwd, ["rev-parse", "--git-common-dir"]);
  const absolute = path.isAbsolute(value) ? value : path.resolve(cwd, value);
  return fs.realpathSync(absolute);
}

function subagentContinuationPaths(value) {
  return value.split("\0").filter(Boolean).sort();
}

function subagentLiteralExcludePathspec(scope) {
  return `:(top,exclude,literal)${scope}`;
}

function hashFileIncrementally(file) {
  const hash = crypto.createHash("sha256");
  const input = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const count = fs.readSync(input, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(input);
  }
  return `sha256:${hash.digest("hex")}`;
}

function gitEvidenceDigest(worktree, args) {
  const evidence = path.join(os.tmpdir(), `acg-git-evidence-${process.pid}-${crypto.randomUUID()}`);
  const output = fs.openSync(evidence, "wx", 0o600);
  try {
    const result = spawnSync("git", ["-C", worktree, ...args], {
      stdio: ["ignore", output, "pipe"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
    });
    assert(result.status === 0, result.stderr?.toString().trim() || "Unable to collect Git evidence");
    return hashFileIncrementally(evidence);
  } finally {
    fs.closeSync(output);
    fs.rmSync(evidence, { force: true });
  }
}

function gitHasOutput(worktree, args) {
  const evidence = path.join(os.tmpdir(), `acg-git-presence-${process.pid}-${crypto.randomUUID()}`);
  const output = fs.openSync(evidence, "wx", 0o600);
  try {
    const result = spawnSync("git", ["-C", worktree, ...args], {
      stdio: ["ignore", output, "pipe"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
    });
    assert(result.status === 0, result.stderr?.toString().trim() || "Unable to inspect Git state");
    return fs.fstatSync(output).size > 0;
  } finally {
    fs.closeSync(output);
    fs.rmSync(evidence, { force: true });
  }
}

function subagentGeneratedOutputRoots(worktree, generatedOutputScope) {
  return generatedOutputScope.filter((scope) => {
    const root = path.join(worktree, ...scope.split("/"));
    if (!fs.existsSync(root)) return false;
    const stat = fs.lstatSync(root);
    assert(!stat.isSymbolicLink(), `Generated output scope root must not be a symlink: ${scope}`);
    assert(stat.isFile() || stat.isDirectory(), `Generated output scope root must be a regular file or directory: ${scope}`);
    const real = fs.realpathSync(root);
    assert(real === worktree || real.startsWith(`${worktree}${path.sep}`), `Generated output scope root escapes assigned worktree: ${scope}`);
    return true;
  });
}

function subagentContinuationState(worktree, generatedOutputScope = []) {
  const trackedDiff = gitEvidenceDigest(worktree, ["diff", "--binary", "HEAD", "--"]);
  const trackedPaths = subagentContinuationPaths(gitReadOnly(worktree, ["diff", "--name-only", "-z", "HEAD", "--"]));
  for (const tracked of trackedPaths) {
    assert(!generatedOutputScope.some((scope) => tracked === scope || tracked.startsWith(`${scope}/`)), `Generated output scope contains tracked changes and is non-integrable: ${tracked}`);
  }
  const exclusions = generatedOutputScope.map(subagentLiteralExcludePathspec);
  const untrackedPaths = subagentContinuationPaths(gitReadOnly(worktree, ["ls-files", "--others", "--exclude-standard", "-z", "--", ":(top,literal)", ...exclusions]));
  const dirtyPaths = [...new Set([...trackedPaths, ...untrackedPaths])].sort();
  const untracked = untrackedPaths.map((relative) => {
    const absolute = path.join(worktree, ...relative.split("/"));
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return { path: relative, type: "symlink", value: fs.readlinkSync(absolute) };
    assert(stat.isFile(), `Unsupported untracked continuation path: ${relative}`);
    return { path: relative, type: "file", size: stat.size, sha256: hashFileIncrementally(absolute) };
  });
  return {
    dirty_paths: dirtyPaths,
    generated_output_scope_roots: subagentGeneratedOutputRoots(worktree, generatedOutputScope),
    worktree_state_digest: `sha256:${sha256(JSON.stringify({ tracked_diff_sha256: trackedDiff, untracked }))}`
  };
}

function verifySubagentWorktreeCapability(receiptFile) {
  // macOS exposes /var through /private/var.  The receipt's content digest is
  // its security identity, while a canonical path keeps equivalent spellings
  // from producing a false continuation mismatch.
  const absoluteReceipt = fs.realpathSync(assertAbsoluteWithoutTraversal(receiptFile, "Subagent worktree receipt"));
  assert(fs.existsSync(absoluteReceipt), `Subagent worktree receipt is unreadable: ${absoluteReceipt}`);
  const receipt = readJson(absoluteReceipt);
  assert(receipt.schema_version === 1 && receipt.receipt_type === "subagent_worktree_assignment", "Subagent worktree receipt type or version is invalid");
  const claimed = receipt.receipt_sha256;
  const unsigned = { ...receipt };
  delete unsigned.receipt_sha256;
  assert(`sha256:${sha256(JSON.stringify(unsigned))}` === claimed, "Subagent worktree receipt digest is invalid");

  const repository = fs.realpathSync(assertAbsoluteWithoutTraversal(receipt.repository, "Subagent repository"));
  const worktree = fs.realpathSync(assertAbsoluteWithoutTraversal(receipt.worktree, "Subagent worktree"));
  assert(subagentCommonGitDirectory(repository) === subagentCommonGitDirectory(worktree), "Subagent worktree belongs to a different repository");
  assert(fs.realpathSync(gitReadOnly(worktree, ["rev-parse", "--show-toplevel"])) === worktree, "Subagent assignment path is not the worktree root");
  const branch = gitReadOnly(worktree, ["branch", "--show-current"]);
  assert(branch === receipt.branch, `Subagent worktree branch mismatch: expected ${receipt.branch}, received ${branch || "<detached>"}`);
  const head = gitReadOnly(worktree, ["rev-parse", "HEAD"]).toLowerCase();
  assert(receipt.seat !== "0", "Seat 0 is reserved for the coordinator and cannot receive a worker assignment");
  assert(head === receipt.base_commit, "Subagent worktree moved from the prepared base; prepare a new isolated seat");
  const dirty = gitHasOutput(worktree, ["status", "--porcelain=v1", "--untracked-files=all"]);
  let dirtyPaths = [];

  if (receipt.receipt_purpose === "continuation") {
    const writeScope = Array.isArray(receipt.write_scope) ? receipt.write_scope : [];
    assert(writeScope.length > 0 || (Array.isArray(receipt.generated_output_scope) && receipt.generated_output_scope.length > 0), "Subagent continuation receipt has no declared owned or generated scope");
    const generatedOutputScope = Array.isArray(receipt.generated_output_scope) ? receipt.generated_output_scope : [];
    for (const generated of generatedOutputScope) {
      assert(!writeScope.some((scope) => generated === scope || generated.startsWith(`${scope}/`) || scope.startsWith(`${generated}/`)), `Generated output scope overlaps write scope: ${generated}`);
    }
    const state = subagentContinuationState(worktree, generatedOutputScope);
    assert(state.dirty_paths.length > 0 || state.generated_output_scope_roots.length > 0, "Subagent continuation requires expected owned dirty state or declared generated output");
    for (const dirtyPath of state.dirty_paths) {
      assert(writeScope.some((scope) => dirtyPath === scope || dirtyPath.startsWith(scope + "/")), `Subagent continuation dirty path is outside declared write scope: ${dirtyPath}`);
    }
    assert(canonicalJson(state.dirty_paths) === canonicalJson(receipt.dirty_paths), "Subagent continuation dirty path set changed after receipt creation");
    assert(canonicalJson(state.generated_output_scope_roots) === canonicalJson(receipt.generated_output_scope_roots ?? []), "Subagent continuation generated output roots changed after receipt creation");
    assert(state.worktree_state_digest === receipt.worktree_state_digest, "Subagent continuation dirty state changed after receipt creation");
    dirtyPaths = state.dirty_paths;
  } else {
    assert(!dirty, "Dirty subagent worktree requires a scoped continuation receipt");
  }

  return {
    receipt_path: absoluteReceipt,
    receipt_sha256: claimed,
    repository,
    worktree,
    branch,
    assigned_base_commit: receipt.base_commit,
    current_head: head,
    dirty,
    dirty_paths: dirtyPaths,
    continuation: receipt.receipt_purpose === "continuation",
    write_scope: receipt.write_scope ?? [],
    work_id: receipt.work_id,
    seat: receipt.seat,
    authority: "receipt_bound_worktree"
  };
}

function approvedRoots(policyRoot, project, mode) {
  const roots = [canonicalPathForComparison(resolveSourceRoot(policyRoot))];
  const profile = readMachineProfile();
  const configured = [
    ...(Array.isArray(profile.approved_roots) ? profile.approved_roots : []),
    ...(Array.isArray(profile.project_roots?.[project]) ? profile.project_roots[project] : []),
    ...(mode === "read_only" && Array.isArray(profile.project_read_roots?.[project])
      ? profile.project_read_roots[project]
      : [])
  ];
  for (const entry of configured) {
    roots.push(canonicalPathForComparison(assertAbsoluteWithoutTraversal(entry, "Machine profile root")));
  }
  return roots;
}

function approvedBootstrapRead(target, sourceRoot, mode, effects) {
  if (mode !== "read_only" || effects.some((effect) => !["none", "read_only", "claim", "continuity"].includes(effect))) return false;
  const home = os.homedir();
  const aliases = [
    path.join(home, ".codex", "AGENTS.md"),
    path.join(home, ".codex", "policies"),
    path.join(home, ".codex", "skills", "govern-codex-policy")
  ];
  const candidate = path.resolve(target);
  if (!aliases.includes(candidate)) return false;
  try {
    if (!fs.lstatSync(candidate).isSymbolicLink()) return false;
    const source = fs.realpathSync(sourceRoot);
    const current = path.join(source, ".runtime", "current");
    const release = fs.existsSync(current)
      ? fs.realpathSync(current)
      : fs.existsSync(path.join(source, "release.json"))
        ? source
        : null;
    if (!release) return false;
    const resolved = fs.realpathSync(candidate);
    return resolved === release || resolved.startsWith(release + path.sep);
  } catch {
    return false;
  }
}

function classifyAndAuthorize(request, manifest, policyRoot, additionalApprovedRoots = []) {
  const requestedModules = [];
  const effectClasses = [];
  for (const operation of request.operations) {
    const definition = manifest.operation_catalog[operation];
    assert(definition, `Unknown immediate operation: ${operation}. Run 'node ~/.codex/policies/bin/acg.mjs list all' once for valid routing values.`);
    effectClasses.push(definition.effect_class);
    requestedModules.push(...definition.required_modules);
  }
  for (const risk of request.risk_tags) {
    const modules = manifest.risk_tag_catalog[risk];
    assert(modules, `Unknown risk tag: ${risk}. Run 'node ~/.codex/policies/bin/acg.mjs list all' once for valid routing values.`);
    requestedModules.push(...modules);
  }
  if (request.operations.length > 1) assert(request.risk_tags.includes("compound_command"), "Compound immediate operations require the compound_command risk tag");

  const effects = [...new Set(effectClasses)];
  const forbidden = new Set(manifest.authority_model.read_only_forbidden_effects);
  if (request.mode === "read_only") {
    const violation = effects.find((effect) => forbidden.has(effect));
    assert(!violation, `Read-only mode forbids effect class: ${violation}`);
  }

  const grants = new Set(request.authorities);
  if (request.mutation_authority) {
    for (const effect of manifest.authority_model.mutation_authority_effects) grants.add(effect);
  }
  const authorityRequired = new Set([
    ...manifest.authority_model.mutation_authority_effects,
    ...manifest.authority_model.explicit_authority_effects
  ]);
  for (const authority of grants) {
    assert(
      Object.values(manifest.operation_catalog).some((definition) => definition.effect_class === authority),
      `Unknown authority grant: ${authority}. Run 'node ~/.codex/policies/bin/acg.mjs list all' once for valid routing values.`
    );
  }
  for (const effect of effects) {
    if (authorityRequired.has(effect)) {
      assert(grants.has(effect), `Missing explicit authority for effect class: ${effect}. Add "authorities":["${effect}"].`);
    }
  }

  for (const tool of request.tools) {
    assert(manifest.tool_catalog[tool], `Unknown tool classification: ${tool}. Run 'node ~/.codex/policies/bin/acg.mjs list all' once for valid routing values.`);
  }
  const requiresTool = effects.some((effect) => !["none", "read_only", "claim", "continuity"].includes(effect));
  if (requiresTool) assert(request.tools.length > 0, "Effectful operations require at least one classified tool");
  for (const effect of effects) {
    if (!requiresTool && request.tools.length === 0) continue;
    assert(request.tools.some((tool) => manifest.tool_catalog[tool].includes(effect)), `Declared tools cannot perform effect class: ${effect}`);
  }

  const pathRequired = new Set(manifest.authority_model.path_required_effects);
  if (effects.some((effect) => pathRequired.has(effect))) assert(request.paths.length > 0, "The immediate operation requires an explicit target path");
  const roots = [
    ...approvedRoots(policyRoot, request.project, request.mode),
    ...additionalApprovedRoots.map((root) => canonicalPathForComparison(root))
  ];
  for (const target of request.paths) {
    assert(path.isAbsolute(target), `Target path must be absolute: ${target}`);
    const absolute = path.resolve(target);
    const home = os.homedir();
    const isBootstrapAlias = [
      path.join(home, ".codex", "AGENTS.md"),
      path.join(home, ".codex", "policies"),
      path.join(home, ".codex", "skills", "govern-codex-policy")
    ].includes(absolute);
    const resolved = canonicalPathForComparison(target);
    const withinApprovedRoot = !isBootstrapAlias && roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
    assert(
      withinApprovedRoot || approvedBootstrapRead(target, roots[0], request.mode, effects),
      `Target path is outside approved roots: ${target}. Add the exact repository or worktree root to project_roots[${JSON.stringify(request.project)}] in ~/.codex/governance-machine-profile.json, or pass ACG_MACHINE_PROFILE.`
    );
  }

  return {
    decision: "allow",
    effect_classes: effects,
    grants: [...grants].sort(),
    tool_classifications: request.tools,
    target_paths: request.paths,
    risk_tags: request.risk_tags,
    requested_modules: [...new Set(requestedModules)],
    control_level: "required_by_kernel",
    runtime_enforcement_evidence: "Unverified"
  };
}

export function resolveRoute(input, policyRoot = resolvePolicyRoot()) {
  const request = normalizeRequest(input, policyRoot);
  const manifest = readJson(path.join(policyRoot, "manifest.json"));
  const lock = readJson(path.join(policyRoot, "policy.lock.json"));
  validateAgainstSchema(policyRoot, "manifest", manifest);
  validateManifestShape(manifest);
  assert(lock.manifest.sha256 === `sha256:${fileRecord(path.join(policyRoot, "manifest.json")).sha256}`, "Manifest identity cannot be verified");

  const localDescriptors = resolveLocalPolicies(request, policyRoot);
  const localProjectRoots = [...new Set(localDescriptors.map((descriptor) => descriptor.approved_project_root).filter(Boolean))];
  const subagentWorktree = request.subagent_worktree_receipt
    ? verifySubagentWorktreeCapability(request.subagent_worktree_receipt)
    : null;
  const authorization = classifyAndAuthorize(request, manifest, policyRoot, [
    ...localProjectRoots,
    ...(subagentWorktree ? [subagentWorktree.worktree] : [])
  ]);
  if (subagentWorktree) authorization.subagent_worktree_capability = subagentWorktree;
  const activeIds = dependencyClosure(manifest, authorization.requested_modules, request.project);
  const byId = new Map(manifest.modules.map((module) => [module.id, module]));
  const activeModules = activeIds.map((id) => {
    const module = byId.get(id);
    const absolute = safePolicyPath(policyRoot, module.path);
    const record = fileRecord(absolute, module.path);
    assert(module.digest === `sha256:${record.sha256}`, `Required module digest mismatch: ${id}`);
    return {
      id,
      version: module.version,
      digest: module.digest,
      path: module.path,
      estimated_tokens: module.estimated_tokens,
      reason: request.operations.filter((operation) => manifest.operation_catalog[operation].required_modules.includes(id))
    };
  });
  const localIds = new Set(localDescriptors.map((entry) => entry.id));
  assert(localIds.size === localDescriptors.length, "Duplicate local policy descriptor id");
  for (const descriptor of localDescriptors) assert(!activeModules.some((module) => module.id === descriptor.id), `Local policy descriptor collides with global module: ${descriptor.id}`);
  activeModules.push(...localDescriptors);

  let ledger = contextLedgerFromLock(lock);
  let receiptChain = [];
  let deliveryHistory = [];
  if (request.prior_receipt) {
    const prior = request.prior_receipt;
    validateReceiptIdentity(prior, "context_acknowledgment", manifest, lock, policyRoot);
    validateContextLedger(prior.context_ledger, prior, manifest, lock);
    ledger = structuredClone(prior.context_ledger);
    receiptChain = [...prior.receipt_chain, prior.receipt_sha256];
    deliveryHistory = structuredClone(prior.delivery_history);
  }

  const already = Object.keys(ledger);
  const accumulated = ledgerTotal(ledger);
  const newModules = activeModules.filter((module) => !ledger[module.id]);
  const deltaTokens = newModules.reduce((sum, module) => sum + module.estimated_tokens, 0);
  const baseTokens = ledgerTotal(contextLedgerFromLock(lock));
  const activeClosureTokens = baseTokens + activeModules.reduce((sum, module) => sum + module.estimated_tokens, 0);
  const policyContextTarget = contextTargetFor(manifest, request.mode);
  const rolloverRequired = false;

  const manifestIdentity = {
    id: manifest.id,
    version: manifest.version,
    sha256: lock.manifest.sha256
  };

  const receipt = {
    receipt_type: "resolution_receipt",
    manifest: manifestIdentity,
    estimator: manifest.estimator,
    phase: request.phase,
    project: request.project,
    mode: request.mode,
    operations: request.operations,
    effect_classes: authorization.effect_classes,
    ignored_future_operations: request.future_operations,
    active_modules: activeModules.map(({ path: _path, ...module }) => module),
    already_in_context: already,
    context_ledger: ledger,
    receipt_chain: receiptChain,
    delivery_history: deliveryHistory,
    required_delta: newModules.map((module) => ({
      id: module.id,
      version: module.version,
      digest: module.digest,
      path: module.path,
      estimated_tokens: module.estimated_tokens
    })),
    accumulated_policy_tokens: accumulated,
    active_closure_tokens: activeClosureTokens,
    newly_delivered_policy_tokens: 0,
    next_delta_tokens: deltaTokens,
    policy_context_target: policyContextTarget,
    policy_context_enforcement: "advisory_only",
    context_growth_policy: "monotonic_unbounded_by_governance",
    runtime_capacity_evidence: "not_evaluated_by_policy_router",
    control_level: "required_by_kernel",
    authorization_decision: authorization,
    local_policy_descriptors: localDescriptors,
    rollover_required: rolloverRequired
  };
  receipt.receipt_sha256 = receiptDigest(receipt);

  const result = {
    schema_version: 1,
    phase: request.phase,
    next_operation: request.operations.length === 1 ? request.operations[0] : request.operations,
    active_modules: activeModules,
    newly_loaded_modules: [],
    newly_required_module_paths: newModules.map((module) => module.path),
    already_in_context: already,
    accumulated_policy_tokens: accumulated,
    active_closure_tokens: activeClosureTokens,
    next_delta_tokens: deltaTokens,
    policy_context_target: policyContextTarget,
    policy_context_enforcement: "advisory_only",
    context_growth_policy: "monotonic_unbounded_by_governance",
    rollover_required: rolloverRequired,
    resolution_receipt: receipt,
    receipt_semantics: {
      resolution_receipt: "closure calculated and verified",
      delivery_receipt: "verified policy content returned or read",
      context_acknowledgment: "coordinator reports content entered context; not authoritative runtime evidence",
      operation_receipt: "operation evaluated against acknowledged closure",
      runtime_enforcement_receipt: "available only from an authoritative interception gateway"
    },
    authorization_decision: authorization,
    enforcement: { level: "required_by_kernel", runtime_interception_evidence: "Unverified" }
  };

  result.local_policy_extension = localDescriptors.length ? {
    index_sha256: localDescriptors[0].local_index_sha256,
    organization_policy: localDescriptors[0].id,
    project_policy: localDescriptors[1].id,
    repository_agents_precedence: "reported_not_copied"
  } : null;
  result.completion_sentinel = localDescriptors.length
    ? `ACG_ROUTE_COMPLETE:${receipt.receipt_sha256.slice(7, 23)}`
    : `ACG_ROUTE_COMPLETE:${lock.manifest.sha256.slice(7, 23)}`;
  return result;
}

export function deliverResolvedPolicy(input, policyRoot = resolvePolicyRoot()) {
  const resolution = input.resolution_receipt ?? input;
  const manifest = readJson(path.join(policyRoot, "manifest.json"));
  const lock = readJson(path.join(policyRoot, "policy.lock.json"));
  validateReceiptIdentity(resolution, "resolution_receipt", manifest, lock, policyRoot);
  validateContextLedger(resolution.context_ledger, resolution, manifest, lock);
  assert(resolution.authorization_decision?.decision === "allow", "Resolution does not contain an allow decision");
  assert(resolution.rollover_required === false, "Cannot deliver policy when rollover is required");

  const byId = new Map(manifest.modules.map((module) => [module.id, module]));
  const localById = new Map((resolution.local_policy_descriptors ?? []).map((module) => [module.id, module]));
  const delivered = resolution.required_delta.map((required) => {
    const module = byId.get(required.id);
    const local = localById.get(required.id);
    assert(module || local, `Delivery references unknown module: ${required.id}`);
    if (local) assert(local.digest === required.digest && local.estimated_tokens === required.estimated_tokens && local.path === required.path, `Delivery contract differs for ${required.id}`);
    if (module) assert(module.digest === required.digest && module.estimated_tokens === required.estimated_tokens && module.path === required.path, `Delivery contract differs for ${required.id}`);
    const file = module ? safePolicyPath(policyRoot, module.path) : assertAbsoluteWithoutTraversal(local.path, `Local delivery path for ${required.id}`);
    if (local) assertPathContained(local.policy_root, file, `Local delivery path for ${required.id}`);
    const content = fs.readFileSync(file, "utf8");
    assert(`sha256:${sha256(Buffer.from(content))}` === required.digest, `Delivered module digest differs for ${required.id}`);
    return { ...required, source: local ? "local_policy" : "global_module", content };
  });

  const receipt = {
    receipt_type: "delivery_receipt",
    manifest: resolution.manifest,
    parent_resolution_sha256: resolution.receipt_sha256,
    delivered_modules: delivered.map(({ content: _content, ...module }) => module),
    delivered_policy_tokens: delivered.reduce((sum, module) => sum + module.estimated_tokens, 0),
    context_ledger_before: resolution.context_ledger,
    accumulated_policy_tokens_before: resolution.accumulated_policy_tokens,
    receipt_chain: [...resolution.receipt_chain, resolution.receipt_sha256],
    delivery_history_before: resolution.delivery_history,
    local_policy_descriptors: resolution.local_policy_descriptors ?? [],
    control_level: "required_by_kernel",
    integrity_claim: "consistency_detection_not_authenticity"
  };
  receipt.receipt_sha256 = receiptDigest(receipt);
  validateAgainstSchema(policyRoot, "receipt", receipt);
  return {
    schema_version: 1,
    resolution_receipt: resolution,
    delivery_receipt: receipt,
    delivered_modules: delivered,
    completion_sentinel: `ACG_DELIVERY_COMPLETE:${receipt.receipt_sha256.slice(7, 23)}`
  };
}

export function acknowledgeDelivery(input, policyRoot = resolvePolicyRoot()) {
  const { resolution_receipt: resolution, delivery_receipt: delivery } = input;
  const manifest = readJson(path.join(policyRoot, "manifest.json"));
  const lock = readJson(path.join(policyRoot, "policy.lock.json"));
  validateReceiptIdentity(resolution, "resolution_receipt", manifest, lock, policyRoot);
  validateReceiptIdentity(delivery, "delivery_receipt", manifest, lock, policyRoot);
  validateContextLedger(resolution.context_ledger, resolution, manifest, lock);
  assert(delivery.parent_resolution_sha256 === resolution.receipt_sha256, "Delivery receipt is not linked to the resolution");
  assert(canonicalJson(delivery.context_ledger_before) === canonicalJson(resolution.context_ledger), "Delivery receipt changed prior context state");
  assert(delivery.accumulated_policy_tokens_before === resolution.accumulated_policy_tokens, "Delivery receipt changed prior accounting");
  assert(canonicalJson(delivery.receipt_chain) === canonicalJson([...resolution.receipt_chain, resolution.receipt_sha256]), "Delivery receipt chain is invalid");
  assert(canonicalJson(delivery.delivery_history_before) === canonicalJson(resolution.delivery_history), "Delivery receipt changed delivery history");

  const ledger = structuredClone(resolution.context_ledger);
  for (const module of delivery.delivered_modules) {
    assert(!ledger[module.id], `Module was already acknowledged: ${module.id}`);
    ledger[module.id] = {
      digest: module.digest,
      estimated_tokens: module.estimated_tokens,
      source: module.source === "local_policy" ? "delivered_local_policy" : "delivered_module"
    };
  }
  const receipt = {
    receipt_type: "context_acknowledgment",
    manifest: resolution.manifest,
    parent_delivery_sha256: delivery.receipt_sha256,
    phase: resolution.phase,
    project: resolution.project,
    mode: resolution.mode,
    operations: resolution.operations,
    active_modules: resolution.active_modules,
    already_in_context: Object.keys(ledger),
    context_ledger: ledger,
    accumulated_policy_tokens: ledgerTotal(ledger),
    active_closure_tokens: resolution.active_closure_tokens,
    policy_context_target: resolution.policy_context_target,
    policy_context_enforcement: resolution.policy_context_enforcement,
    context_growth_policy: resolution.context_growth_policy,
    receipt_chain: [...delivery.receipt_chain, delivery.receipt_sha256],
    delivery_history: [
      ...resolution.delivery_history,
      {
        delivery_receipt_sha256: delivery.receipt_sha256,
        modules: delivery.delivered_modules
      }
    ],
    local_policy_descriptors: resolution.local_policy_descriptors ?? [],
    control_level: "required_by_kernel",
    runtime_context_evidence: "coordinator_acknowledgment_not_authoritative_runtime_evidence",
    integrity_claim: "verifiable_chain_consistency_not_authenticity"
  };
  receipt.receipt_sha256 = receiptDigest(receipt);
  validateContextLedger(ledger, receipt, manifest, lock);
  validateAgainstSchema(policyRoot, "receipt", receipt);
  return {
    schema_version: 1,
    context_acknowledgment: receipt,
    completion_sentinel: `ACG_CONTEXT_ACKNOWLEDGED:${receipt.receipt_sha256.slice(7, 23)}`
  };
}

const CONTINUITY_MODES = new Set([
  "project_managed",
  "read_only",
  "not_applicable",
  "non_repository",
  "externally_managed"
]);

function stripMarkdownValue(value) {
  return value.trim().replace(/^`|`$/g, "").trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labeledHandoffValue(text, labels) {
  for (const label of labels) {
    const expression = new RegExp(`^\\s*(?:[-*]\\s+)?${escapeRegex(label)}:\\s*(.*)$`, "im");
    const match = expression.exec(text);
    if (!match) continue;
    if (match[1].trim()) return stripMarkdownValue(match[1]);
    const following = text.slice(match.index + match[0].length).split(/\r?\n/);
    const value = following.find((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()));
    if (value) return stripMarkdownValue(value);
  }
  return null;
}

function handoffSection(text, title) {
  const expression = new RegExp(`^##\\s+${escapeRegex(title)}\\s*$([\\s\\S]*?)(?=^##\\s|\\s*$)`, "im");
  return expression.exec(text)?.[1]?.trim() ?? "";
}

function sectionBullets(section) {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim());
}

function firstSectionParagraph(section) {
  const lines = section.split(/\r?\n/).map((line) => line.trim());
  const first = lines.find((line) => line && !/^[-*0-9#`]/.test(line));
  return first ?? null;
}

export function parseHandoffDocument(text) {
  assert(typeof text === "string" && text.trim(), "Handoff content is empty");
  const endGoal = handoffSection(text, "End Goal");
  const validation = handoffSection(text, "Validation");
  const blockers = handoffSection(text, "Blockers");
  const openWork = handoffSection(text, "Open Work");
  const nextOpen = /The next open [^.]+ at handoff is ([^.]+)\./i.exec(text);
  return {
    repository: labeledHandoffValue(text, ["Repository of record", "Repository"]),
    worktree: labeledHandoffValue(text, ["Security integration worktree", "Worktree"]),
    branch: labeledHandoffValue(text, ["Security branch", "Branch"]),
    commit: labeledHandoffValue(text, ["Handoff candidate", "Candidate commit", "Commit"]),
    work_id: labeledHandoffValue(text, ["Work ID", "Work item", "Ticket"]),
    objective: labeledHandoffValue(text, ["Objective"]) ?? firstSectionParagraph(endGoal),
    validation: sectionBullets(validation),
    blockers: sectionBullets(blockers),
    open_work: sectionBullets(openWork),
    next_action: labeledHandoffValue(text, ["Next action", "Exact next action"])
      ?? (nextOpen ? `Close and validate ${nextOpen[1]}.` : null)
  };
}

function assertProjectSlug(project) {
  assert(typeof project === "string" && /^[a-z0-9][a-z0-9._-]*$/.test(project), "Project must be a lowercase slug using letters, digits, dots, underscores, or hyphens");
  return project;
}

function readableAbsoluteFile(file, label) {
  const absolute = assertAbsoluteWithoutTraversal(file, label);
  assert(fs.existsSync(absolute), `${label} is unreadable: ${absolute}`);
  assert(fs.statSync(absolute).isFile(), `${label} is not a file: ${absolute}`);
  return absolute;
}

function globalAdHocMemoryPath(file) {
  const root = path.join(os.homedir(), ".codex", "memories", "extensions", "ad_hoc", "notes");
  const absolute = path.resolve(file);
  return absolute === root || absolute.startsWith(root + path.sep);
}

function gitReadOnly(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    // Text is needed only for bounded metadata (paths, refs, and status).
    // Binary diff evidence is deliberately streamed and hashed above.
    maxBuffer: GIT_TEXT_MAX_BUFFER
  }).trim();
}

function captureRepositoryState(candidate) {
  const absolute = assertAbsoluteWithoutTraversal(candidate, "Repository or worktree");
  assert(fs.existsSync(absolute), `Repository or worktree is unreadable: ${absolute}`);
  let worktree;
  try {
    worktree = gitReadOnly(absolute, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new Error(`Path is not a Git repository or worktree: ${absolute}`);
  }
  const branch = gitReadOnly(worktree, ["branch", "--show-current"]);
  const commit = gitReadOnly(worktree, ["rev-parse", "HEAD"]);
  const statusText = gitReadOnly(worktree, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const changes = statusText ? statusText.split(/\r?\n/) : [];
  const state = {
    worktree: fs.realpathSync(worktree),
    branch: branch || null,
    commit,
    dirty: changes.length > 0,
    changes
  };
  state.state_sha256 = `sha256:${sha256(canonicalJson(state))}`;
  return state;
}

function filePurityState(file) {
  const record = fileRecord(file, file);
  return { path: file, sha256: `sha256:${record.sha256}`, bytes: record.bytes };
}

function uniqueRepositoryStates(candidates) {
  const states = [];
  const seen = new Set();
  for (const candidate of candidates.filter(Boolean)) {
    const state = captureRepositoryState(candidate);
    if (seen.has(state.worktree)) continue;
    seen.add(state.worktree);
    states.push(state);
  }
  assert(states.length > 0, "No repository or worktree could be resolved from the handoff; provide --repository or configure the project in ACG_MACHINE_PROFILE");
  return states;
}

function machineProjectConfiguration(project) {
  const configured = readMachineProfile().handoff_projects?.[project] ?? null;
  if (configured === null) return null;
  assert(configured && typeof configured === "object" && !Array.isArray(configured), `Machine handoff configuration is invalid for ${project}`);
  return configured;
}

function normalizeContinuityConfiguration(configuration, project, source) {
  if (!configuration) return null;
  assert(CONTINUITY_MODES.has(configuration.mode), `Continuity mode for ${project} is invalid. Valid values: ${[...CONTINUITY_MODES].join(", ")}`);
  const result = { mode: configuration.mode, source };
  if (configuration.mode === "project_managed") {
    result.event_log = assertAbsoluteWithoutTraversal(configuration.event_log, `Continuity event log for ${project}`);
    assert(!globalAdHocMemoryPath(result.event_log), "Global ad-hoc memory cannot be selected as canonical project continuity");
    if (configuration.projection) {
      result.projection = assertAbsoluteWithoutTraversal(configuration.projection, `Continuity projection for ${project}`);
      assert(!globalAdHocMemoryPath(result.projection), "Global ad-hoc memory cannot be selected as a project continuity projection");
    } else {
      result.projection = null;
    }
  }
  return result;
}

function discoverRepositoryContinuity(repositoryStates, project) {
  for (const state of repositoryStates) {
    const configFile = path.join(state.worktree, ".codex", "continuity.json");
    if (fs.existsSync(configFile)) {
      return normalizeContinuityConfiguration(readJson(configFile), project, configFile);
    }
    const eventLog = path.join(state.worktree, ".codex", "project-memory.jsonl");
    if (fs.existsSync(eventLog)) {
      const projection = path.join(state.worktree, ".codex", "PROJECT-STATE.md");
      return normalizeContinuityConfiguration({
        mode: "project_managed",
        event_log: eventLog,
        projection: fs.existsSync(projection) ? projection : null
      }, project, "existing_repository_continuity");
    }
  }
  return null;
}

function resolveContinuityConfiguration(project, repositoryStates) {
  const machineProject = machineProjectConfiguration(project);
  if (machineProject?.continuity) {
    return normalizeContinuityConfiguration(machineProject.continuity, project, "machine_profile");
  }
  return discoverRepositoryContinuity(repositoryStates, project);
}

function runPolicyLifecycle(request, policyRoot) {
  const route = resolveRoute(request, policyRoot);
  const delivery = deliverResolvedPolicy(route, policyRoot);
  const acknowledgment = acknowledgeDelivery(delivery, policyRoot);
  return { route, delivery, acknowledgment };
}

function routingReferences(lifecycle) {
  return {
    route_receipt_sha256: lifecycle.route.resolution_receipt.receipt_sha256,
    delivery_receipt_sha256: lifecycle.delivery.delivery_receipt.receipt_sha256,
    acknowledgment_receipt_sha256: lifecycle.acknowledgment.context_acknowledgment.receipt_sha256,
    route_sentinel: lifecycle.route.completion_sentinel,
    delivery_sentinel: lifecycle.delivery.completion_sentinel,
    acknowledgment_sentinel: lifecycle.acknowledgment.completion_sentinel
  };
}

function compareReadOnlyPurity(beforeRepositories, afterRepositories, beforeFiles, afterFiles) {
  const afterByWorktree = new Map(afterRepositories.map((state) => [state.worktree, state]));
  const repositoryChanges = beforeRepositories.flatMap((before) => {
    const after = afterByWorktree.get(before.worktree);
    if (after?.state_sha256 === before.state_sha256) return [];
    return [{
      worktree: before.worktree,
      before: before.changes,
      after: after?.changes ?? null
    }];
  });
  const afterByFile = new Map(afterFiles.map((state) => [state.path, state]));
  const fileChanges = beforeFiles.filter((before) => {
    const after = afterByFile.get(before.path);
    return !after || after.sha256 !== before.sha256 || after.bytes !== before.bytes;
  });
  return {
    passed: repositoryChanges.length === 0 && fileChanges.length === 0,
    repositories: beforeRepositories.map((state) => ({
      worktree: state.worktree,
      pre_existing_dirty: state.dirty,
      pre_existing_changes: state.changes,
      introduced_changes: repositoryChanges.find((entry) => entry.worktree === state.worktree) ?? null
    })),
    changed_input_files: fileChanges.map((entry) => entry.path)
  };
}

function reconciliationResult(reported, repositories) {
  const reportedWorktree = reported.worktree ? path.resolve(reported.worktree) : null;
  const primary = repositories.find((state) => state.worktree === reportedWorktree) ?? repositories[0];
  const differences = [];
  if (reported.branch && primary.branch !== reported.branch) {
    differences.push({ field: "branch", reported: reported.branch, verified: primary.branch });
  }
  if (reported.commit && primary.commit !== reported.commit) {
    differences.push({ field: "commit", reported: reported.commit, verified: primary.commit });
  }
  return {
    reported,
    verified: {
      primary_worktree: primary.worktree,
      branch: primary.branch,
      commit: primary.commit,
      dirty: primary.dirty,
      changes: primary.changes,
      repositories
    },
    differences
  };
}

export function verifyHandoffWorkflow(options, policyRoot = resolvePolicyRoot(), dependencies = {}) {
  const project = assertProjectSlug(options.project);
  const handoff = readableAbsoluteFile(options.handoff, "Handoff");
  const pointer = options.pointer ? readableAbsoluteFile(options.pointer, "Pointer") : null;
  const handoffContent = fs.readFileSync(handoff, "utf8");
  const pointerContent = pointer ? fs.readFileSync(pointer, "utf8") : null;
  const reported = parseHandoffDocument(handoffContent);
  const machineProject = machineProjectConfiguration(project);
  const repositoryCandidates = [
    options.repository,
    machineProject?.repository,
    reported.repository,
    reported.worktree
  ];
  const beforeRepositories = uniqueRepositoryStates(repositoryCandidates);
  const watchedFiles = [handoff, pointer].filter(Boolean);
  const beforeFiles = watchedFiles.map(filePurityState);
  const continuity = resolveContinuityConfiguration(project, beforeRepositories);
  const paths = [...new Set([...watchedFiles, ...beforeRepositories.map((state) => state.worktree)])];
  const request = {
    mode: "read_only",
    phase: "handoff-verification",
    project,
    operations: ["read_file", "resume_work"],
    tools: ["filesystem_read", "local_runtime"],
    paths,
    risk_tags: ["compound_command"],
    mutation_authority: false,
    runtime_capabilities: {
      filesystem_read: true,
      handoff_helper: true
    }
  };
  const lifecycle = runPolicyLifecycle(request, policyRoot);
  dependencies.afterRouting?.();
  const afterRepositories = beforeRepositories.map((state) => captureRepositoryState(state.worktree));
  const afterFiles = watchedFiles.map(filePurityState);
  const purity = compareReadOnlyPurity(beforeRepositories, afterRepositories, beforeFiles, afterFiles);
  assert(purity.passed, `Read-only purity check failed. Introduced repository or input-file changes: ${JSON.stringify({
    repositories: purity.repositories.filter((entry) => entry.introduced_changes),
    files: purity.changed_input_files
  })}`);
  const reconciliation = reconciliationResult(reported, afterRepositories);
  const refs = routingReferences(lifecycle);
  const verificationReceipt = {
    schema_version: 1,
    receipt_type: "handoff_verification",
    verified: true,
    project,
    handoff: {
      path: handoff,
      sha256: `sha256:${sha256(Buffer.from(handoffContent))}`
    },
    pointer: pointer ? {
      path: pointer,
      sha256: `sha256:${sha256(Buffer.from(pointerContent))}`,
      authority: globalAdHocMemoryPath(pointer) ? "supplementary_global_pointer" : "supplementary_pointer"
    } : null,
    reconciliation,
    purity,
    continuity,
    routing: refs,
    context_acknowledgment: lifecycle.acknowledgment.context_acknowledgment
  };
  verificationReceipt.receipt_sha256 = receiptDigest(verificationReceipt);
  return {
    schema_version: 1,
    command: "handoff verify",
    verified: true,
    project,
    handoff: verificationReceipt.handoff,
    pointer: verificationReceipt.pointer,
    reconciliation,
    purity,
    continuity,
    routing: { ...refs, lifecycle_calls: 1 },
    verification_receipt: verificationReceipt
  };
}

function extractVerificationReceipt(input) {
  assert(input && typeof input === "object" && !Array.isArray(input), "A full handoff verification receipt object is required; a receipt digest alone is not accepted");
  const receipt = input.verification_receipt ?? input;
  assert(receipt && typeof receipt === "object" && !Array.isArray(receipt), "A full handoff verification receipt object is required; a receipt digest alone is not accepted");
  assert(receipt.receipt_type === "handoff_verification" && receipt.verified === true, "A successful handoff verification receipt is required");
  assert(receiptDigest(receipt) === receipt.receipt_sha256, "Handoff verification receipt digest is invalid");
  assert(receipt.purity?.passed === true, "Handoff verification receipt did not pass read-only purity");
  return receipt;
}

function acceptanceEvent(receipt, refs) {
  const reported = receipt.reconciliation.reported;
  const verified = receipt.reconciliation.verified;
  return {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    event: "resumed",
    project: receipt.project,
    work_id: reported.work_id ?? `project:${receipt.project}`,
    handoff: {
      source: receipt.handoff.path,
      sha256: receipt.handoff.sha256
    },
    repository: reported.repository ?? verified.primary_worktree,
    branch: verified.branch,
    worktree: verified.primary_worktree,
    commit: verified.commit,
    objective: reported.objective,
    validation: reported.validation,
    blockers: reported.blockers,
    open_work: reported.open_work,
    next_action: reported.next_action,
    receipt_refs: {
      verification: receipt.receipt_sha256,
      route: refs.route_receipt_sha256,
      delivery: refs.delivery_receipt_sha256,
      acknowledgment: refs.acknowledgment_receipt_sha256
    }
  };
}

function projectStateProjection(event) {
  return [
    "# Project State",
    "",
    `Last reconciled: ${event.timestamp}`,
    `Project: ${event.project}`,
    "",
    "## Active Work",
    "",
    `### ${event.work_id}`,
    "",
    "Status: resumed",
    `Branch: ${event.branch ?? "unknown"}`,
    `Worktree: ${event.worktree ?? "unknown"}`,
    `Last verified commit: ${event.commit ?? "unknown"}`,
    "",
    "Objective:",
    event.objective ?? "Not stated in the handoff.",
    "",
    "Open work:",
    ...(event.open_work.length ? event.open_work.map((entry, index) => `${index + 1}. ${entry}`) : ["1. None recorded."]),
    "",
    "Blockers:",
    ...(event.blockers.length ? event.blockers.map((entry) => `- ${entry}`) : ["- None recorded."]),
    "",
    "Next action:",
    event.next_action ?? "Not stated in the handoff.",
    ""
  ].join("\n");
}

function alreadyAccepted(eventLog, verificationDigest) {
  if (!fs.existsSync(eventLog)) return false;
  return fs.readFileSync(eventLog, "utf8").split(/\r?\n/).filter(Boolean).some((line) => {
    try {
      return JSON.parse(line).receipt_refs?.verification === verificationDigest;
    } catch {
      throw new Error(`Canonical continuity contains invalid JSONL: ${eventLog}`);
    }
  });
}

export function acceptHandoffWorkflow(options, policyRoot = resolvePolicyRoot()) {
  const receipt = extractVerificationReceipt(options.verification);
  const project = options.project ? assertProjectSlug(options.project) : receipt.project;
  assert(project === receipt.project, `Verification receipt project mismatch: expected ${project}, received ${receipt.project}`);
  if (receipt.continuity?.mode === "project_managed") {
    assert(
      !alreadyAccepted(receipt.continuity.event_log, receipt.receipt_sha256),
      "This handoff verification receipt was already accepted"
    );
  }
  const handoff = readableAbsoluteFile(receipt.handoff.path, "Verified handoff");
  assert(`sha256:${fileRecord(handoff, handoff).sha256}` === receipt.handoff.sha256, "Handoff changed after verification; run handoff verify again");
  const currentRepositories = receipt.reconciliation.verified.repositories.map((state) => captureRepositoryState(state.worktree));
  for (const prior of receipt.reconciliation.verified.repositories) {
    const current = currentRepositories.find((state) => state.worktree === prior.worktree);
    assert(current?.state_sha256 === prior.state_sha256, `Repository state changed after verification: ${prior.worktree}. Run handoff verify again.`);
  }
  const continuity = resolveContinuityConfiguration(project, currentRepositories);
  assert(continuity, `Canonical project continuity is not configured for ${project}. Configure the project machine profile or an existing repository continuity file, then verify again.`);
  assert(canonicalJson(continuity) === canonicalJson(receipt.continuity), "Project continuity configuration changed after verification; run handoff verify again");
  const writesContinuity = continuity.mode === "project_managed";
  if (writesContinuity) {
    assert(options.authorizeMemoryWrite === true, "Project-managed handoff acceptance requires --authorize-memory-write");
  }
  const targetPaths = writesContinuity
    ? [continuity.event_log, continuity.projection].filter(Boolean)
    : [receipt.handoff.path];
  const request = {
    mode: writesContinuity ? "mutation" : "read_only",
    phase: "handoff-acceptance",
    project,
    operations: ["resume_work"],
    tools: [writesContinuity ? "shell" : "local_runtime"],
    paths: targetPaths,
    risk_tags: [],
    mutation_authority: writesContinuity
  };
  const lifecycle = runPolicyLifecycle(request, policyRoot);
  const refs = routingReferences(lifecycle);
  const event = acceptanceEvent(receipt, refs);
  if (writesContinuity) {
    fs.mkdirSync(path.dirname(continuity.event_log), { recursive: true });
    fs.appendFileSync(continuity.event_log, JSON.stringify(event) + "\n", "utf8");
    if (continuity.projection) {
      fs.mkdirSync(path.dirname(continuity.projection), { recursive: true });
      const temporary = `${continuity.projection}.tmp-${process.pid}-${crypto.randomUUID()}`;
      fs.writeFileSync(temporary, projectStateProjection(event), "utf8");
      fs.renameSync(temporary, continuity.projection);
    }
  }
  return {
    schema_version: 1,
    command: "handoff accept",
    accepted: true,
    project,
    continuity: {
      ...continuity,
      written: writesContinuity,
      external_action_required: continuity.mode === "externally_managed"
    },
    routing: { ...refs, lifecycle_calls: 1 },
    ...(writesContinuity ? { event } : { proposed_event: event })
  };
}

export function authorizeCommunication(options, policyRoot = resolvePolicyRoot()) {
  const project = assertProjectSlug(options.project);
  assert(typeof options.target === "string" && options.target.trim(), "Communication target is required");
  const scope = assertAbsoluteWithoutTraversal(options.scope, "Communication scope");
  const request = {
    mode: "mutation",
    phase: options.phase ?? "communication",
    project,
    operations: ["communicate"],
    tools: ["communication"],
    paths: [scope],
    risk_tags: ["external_effect"],
    mutation_authority: false,
    authorities: ["communication"],
    runtime_capabilities: { thread_coordination: true },
    subagent_worktree_receipt: options.subagentWorktreeReceipt ?? null
  };
  const lifecycle = runPolicyLifecycle(request, policyRoot);
  return {
    schema_version: 1,
    command: "communicate",
    communication_authorized: true,
    message_sent: false,
    project,
    target: options.target,
    canonical_request: request,
    routing: { ...routingReferences(lifecycle), lifecycle_calls: 1 },
    next_action: "Send the intended message with the authorized runtime task-communication tool."
  };
}

export function authorizeHandoffCommunication(options, policyRoot = resolvePolicyRoot()) {
  return {
    ...authorizeCommunication({ ...options, phase: "handoff-communication" }, policyRoot),
    command: "handoff communicate"
  };
}

export function runAuditWorkflow(options, policyRoot = resolvePolicyRoot()) {
  assert(typeof options?.project === "string" && options.project.trim(), "Audit project slug is required");
  assert(typeof options?.path === "string" && path.isAbsolute(options.path), "Audit path must be absolute");
  assert(fs.existsSync(options.path), `Audit path does not exist: ${options.path}`);
  const request = {
    mode: "deep_audit",
    phase: "audit",
    project: options.project.trim(),
    operations: ["audit"],
    tools: ["filesystem_read"],
    paths: [path.resolve(options.path)],
    risk_tags: [],
    mutation_authority: false,
    runtime_capabilities: { filesystem_read: true, local_runtime: true },
    prior_receipt: options.priorReceipt?.context_acknowledgment ?? options.priorReceipt ?? null
  };
  const lifecycle = runPolicyLifecycle(request, policyRoot);
  const routing = { ...routingReferences(lifecycle), lifecycle_calls: 1 };
  const receipt = {
    schema_version: 1,
    command: "audit",
    audit_ready: true,
    project: request.project,
    path: request.paths[0],
    canonical_request: request,
    active_modules: lifecycle.route.active_modules,
    delivered_modules: lifecycle.delivery.delivered_modules,
    context_acknowledgment: lifecycle.acknowledgment.context_acknowledgment,
    routing
  };
  return {
    ...receipt,
    completion_sentinel: `ACG_AUDIT_READY:${sha256(canonicalJson(receipt)).slice(0, 16)}`
  };
}

export function formatGovernanceError(error, command = "unknown") {
  const message = error instanceof Error ? error.message : String(error);
  const result = { error: message, command, failed_closed: true };
  if (/(?:not an allowed value|invalid value)/.test(message) && /Valid values:/.test(message)) {
    result.code = "invalid_enum";
    result.guidance = "Use the listed value. For routing classification, run 'node ~/.codex/policies/bin/acg.mjs list all' once.";
  } else if (/has type .*; expected/.test(message)) {
    result.code = "invalid_type";
    result.guidance = "Correct the field type shown in the error; do not retry the unchanged request.";
  } else if (/Missing explicit authority for effect class/.test(message)) {
    result.code = "missing_authority";
    result.required_authority = /effect class: ([a-z_]+)/.exec(message)?.[1] ?? null;
    result.guidance = "Use a high-level helper when available; otherwise add the exact authority reported by the router.";
  } else if (/full handoff verification receipt object/.test(message)) {
    result.code = "full_receipt_required";
    result.guidance = "Pass the complete JSON output from 'handoff verify', not only its SHA-256 digest.";
  } else if (/Read-only purity check failed/.test(message)) {
    result.code = "read_only_purity_failed";
    result.guidance = "Stop. Preserve pre-existing state and identify the newly introduced changes before retrying.";
  } else if (/Unknown immediate operation|Unknown risk tag|Unknown tool classification|Unknown authority grant/.test(message)) {
    result.code = "unknown_catalog_value";
    result.guidance = "Run 'node ~/.codex/policies/bin/acg.mjs list all' once, then correct the request without source inspection.";
  } else if (/Receipt manifest differs|Context ledger differs for kernel|Context ledger differs for govern-codex-policy/.test(message)) {
    result.code = "stale_context_receipt";
    result.guidance = "The prior receipt belongs to another policy release. Preserve its accounting, stop this operation, and continue in a fresh context loaded from the active release.";
  }
  return result;
}

function destinationExists(sourceRoot, destination) {
  return fs.existsSync(path.join(sourceRoot, destination));
}

export function verifyAll(policyRoot = resolvePolicyRoot()) {
  const sourceRoot = resolveSourceRoot(policyRoot);
  const releaseFile = path.join(sourceRoot, "release.json");
  if (path.basename(policyRoot) === "policies" && fs.existsSync(releaseFile)) {
    const metadata = verifyRelease(sourceRoot);
    const lock = readJson(path.join(policyRoot, "policy.lock.json"));
    const skill = validateSkill(sourceRoot);
    const targets = readJson(path.join(sourceRoot, "overlay-targets.json"));
    assert(Array.isArray(targets.targets), "Overlay targets are invalid");
    return {
      verified: true,
      manifest: lock.manifest,
      estimator: lock.estimator,
      kernel_tokens: fileRecord(path.join(sourceRoot, "AGENTS.md")).estimated_tokens,
      module_count: lock.modules.length,
      skill,
      traceability_rules: 0,
      traceability: "optional_local_migration_provenance",
      overlay_targets: targets.targets.length,
      release_id: metadata.release_id,
      source_commit: metadata.source_commit,
      system_version: metadata.system_version ?? "Unversioned legacy release",
      display_channel: metadata.display_channel ?? "Unversioned legacy release"
    };
  }
  const result = verifyPolicyRoot(policyRoot);
  const skill = validateSkill(sourceRoot);
  const targets = readJson(path.join(sourceRoot, "governance", "overlay-targets.json"));
  for (const target of targets.targets) assert(fs.existsSync(path.join(sourceRoot, target.source)), `Overlay source missing: ${target.id}`);
  const packageMetadata = readJson(path.join(sourceRoot, "package.json"));
  const systemVersion = packageMetadata.version;
  const displayChannel = packageMetadata.display_channel;
  parseSystemVersion(systemVersion);
  parseDisplayChannel(displayChannel);
  return { ...result, skill, traceability_rules: 0, traceability: "optional_local_migration_provenance", overlay_targets: targets.targets.length, system_version: systemVersion, display_channel: displayChannel };
}

function copyFileLocked(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyTree(source, destination) {
  fs.cpSync(source, destination, { recursive: true, dereference: true, errorOnExist: false });
}

function listFiles(root, current = root) {
  const output = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(root, absolute));
    else if (entry.isFile()) output.push(path.relative(root, absolute));
  }
  return output;
}

function listSourcePluginNames(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function bundleDigest(root, excluded = new Set(["release.json"])) {
  const records = listFiles(root)
    .filter((relative) => !excluded.has(relative))
    .map((relative) => {
      const data = fs.readFileSync(path.join(root, relative));
      return { path: relative, sha256: sha256(data), bytes: data.length };
    });
  return { records, sha256: sha256(canonicalJson(records)) };
}

function gitOutput(sourceRoot, args) {
  return execFileSync("git", ["-C", sourceRoot, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: GIT_TEXT_MAX_BUFFER
  }).trim();
}

function systemVersionAtCommit(sourceRoot, commit) {
  const content = gitOutput(sourceRoot, ["show", `${commit}:package.json`]);
  let metadata;
  try {
    metadata = JSON.parse(content);
  } catch (error) {
    throw new Error(`Cannot read governance system version at ${commit}: ${error.message}`);
  }
  parseSystemVersion(metadata.version);
  return metadata.version;
}

export function buildRelease(sourceRoot = codeRoot, requestedId = null) {
  const policyRoot = path.join(sourceRoot, "governance");
  const verification = verifyAll(policyRoot);
  const status = gitOutput(sourceRoot, ["status", "--porcelain"]);
  assert(status === "", "Release build requires a clean source repository");
  const branch = gitOutput(sourceRoot, ["branch", "--show-current"]);
  assert(branch === "main", `Production release build requires main, found ${branch}`);
  const commit = gitOutput(sourceRoot, ["rev-parse", "HEAD"]);
  const remoteLine = execFileSync("git", ["-C", sourceRoot, "ls-remote", "origin", "refs/heads/main"], { encoding: "utf8" }).trim();
  const remoteMain = remoteLine.split(/\s+/)[0];
  assert(/^[0-9a-f]{40}$/.test(remoteMain), "Unable to verify remote main");
  assert(commit === remoteMain, "Production release build requires pushed origin/main");
  const packageMetadata = readJson(path.join(sourceRoot, "package.json"));
  const systemVersion = packageMetadata.version;
  const displayChannel = parseDisplayChannel(packageMetadata.display_channel);
  parseSystemVersion(systemVersion);
  const bundledSourcePlugins = listSourcePluginNames(path.join(sourceRoot, "plugins"));
  assert(bundledSourcePlugins.length > 0, "At least one source plugin is required for the immutable release");
  const current = currentReleaseMetadata(sourceRoot);
  const previousSystemVersion = current
    ? (current.system_version ?? systemVersionAtCommit(sourceRoot, current.source_commit))
    : null;

  const releases = path.join(sourceRoot, ".runtime", "releases");
  const staging = path.join(releases, `.tmp-build-${process.pid}-${crypto.randomUUID()}`);
  fs.mkdirSync(staging, { recursive: true });

  try {
    copyFileLocked(path.join(sourceRoot, "README.md"), path.join(staging, "README.md"));
    copyFileLocked(path.join(sourceRoot, "docs", "agent-system-role.md"), path.join(staging, "docs", "agent-system-role.md"));
    copyFileLocked(path.join(sourceRoot, "docs", "agent-metrics.md"), path.join(staging, "docs", "agent-metrics.md"));
    copyFileLocked(path.join(policyRoot, "kernel", "AGENTS.md"), path.join(staging, "AGENTS.md"));
    copyTree(path.join(policyRoot, "modules"), path.join(staging, "policies", "modules"));
    copyTree(path.join(policyRoot, "schemas"), path.join(staging, "policies", "schemas"));
    copyFileLocked(path.join(policyRoot, "profiles", "codex-runtime.json"), path.join(staging, "policies", "profiles", "codex-runtime.json"));
    copyTree(path.join(sourceRoot, "bin"), path.join(staging, "policies", "bin"));
    copyTree(path.join(sourceRoot, "lib"), path.join(staging, "policies", "lib"));
    copyTree(path.join(sourceRoot, "plugins"), path.join(staging, "plugins"));
    copyFileLocked(path.join(policyRoot, "manifest.json"), path.join(staging, "policies", "manifest.json"));
    copyFileLocked(path.join(policyRoot, "policy.lock.json"), path.join(staging, "policies", "policy.lock.json"));
    copyFileLocked(path.join(policyRoot, "manifest.json"), path.join(staging, "manifest.json"));
    copyFileLocked(path.join(policyRoot, "policy.lock.json"), path.join(staging, "policy.lock.json"));
    copyTree(path.join(sourceRoot, "skills", "govern-codex-policy"), path.join(staging, "skills", "govern-codex-policy"));
    copyFileLocked(path.join(policyRoot, "overlay-targets.json"), path.join(staging, "overlay-targets.json"));

    const digest = bundleDigest(staging);
    const version = validateReleaseVersionTransition({
      previousVersion: previousSystemVersion,
      nextVersion: systemVersion,
      previousBundleSha256: current?.bundle_sha256 ?? null,
      nextBundleSha256: `sha256:${digest.sha256}`
    });
    const payload = {
      schema_version: 1,
      manifest: verification.manifest,
      ...version,
      display_channel: displayChannel,
      bundled_source_plugins: bundledSourcePlugins,
      host_plugin_activation: "Unverified",
      source_commit: commit,
      source_branch: branch,
      source_remote_commit: remoteMain,
      remote_verified_at: new Date().toISOString(),
      bundle_sha256: `sha256:${digest.sha256}`,
      files: digest.records,
      integrity_claim: "tamper_detection_not_tamper_prevention",
      activation_scope: ["filesystem"],
      new_context_activation: "requires_fresh_context_acknowledgment",
      existing_context_activation: "Unverified"
    };
    const contentSha = sha256(canonicalJson(payload));
    const releaseId = `v1-${contentSha.slice(0, 16)}`;
    if (requestedId) assert(requestedId === releaseId, `Requested release id is not content-addressed; expected ${releaseId}`);
    const finalRoot = path.join(releases, releaseId);
    assert(!fs.existsSync(finalRoot), `Release already exists: ${releaseId}`);
    writeJsonAtomic(path.join(staging, "release.json"), {
      release_id: releaseId,
      content_sha256: `sha256:${contentSha}`,
      ...payload
    });
    fs.renameSync(staging, finalRoot);
    for (const relative of listFiles(finalRoot)) fs.chmodSync(path.join(finalRoot, relative), 0o444);
    for (const directory of [finalRoot, ...listFiles(finalRoot).map((relative) => path.dirname(path.join(finalRoot, relative)))]) {
      if (fs.existsSync(directory) && fs.statSync(directory).isDirectory()) fs.chmodSync(directory, 0o555);
    }
    return {
      release_id: releaseId,
      path: finalRoot,
      source_commit: commit,
      bundle_sha256: `sha256:${digest.sha256}`,
      display_channel: displayChannel,
      bundled_source_plugins: bundledSourcePlugins,
      host_plugin_activation: "Unverified",
      ...version
    };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

export function verifyRelease(releaseRoot) {
  const metadata = readJson(path.join(releaseRoot, "release.json"));
  const legacyKeys = [
    "release_id", "content_sha256", "schema_version", "manifest", "source_commit",
    "source_branch", "source_remote_commit", "remote_verified_at", "bundle_sha256",
    "files", "integrity_claim", "activation_scope", "new_context_activation",
    "existing_context_activation"
  ];
  const versionKeys = ["system_version", "previous_system_version", "version_bump"];
  const rc3Keys = ["display_channel", "bundled_source_plugins", "host_plugin_activation"];
  const actualKeys = canonicalJson(Object.keys(metadata).sort());
  const legacyShape = actualKeys === canonicalJson([...legacyKeys].sort());
  const versionedShape = actualKeys === canonicalJson([...legacyKeys, ...versionKeys].sort());
  const rc3Shape = actualKeys === canonicalJson([...legacyKeys, ...versionKeys, ...rc3Keys].sort());
  if (metadata.system_version && parseSystemVersion(metadata.system_version).major >= 3) {
    assert(
      rc3Keys.every((key) => Object.hasOwn(metadata, key)),
      "Release metadata omits the display channel or bundled plugin provenance"
    );
  }
  assert(legacyShape || versionedShape || rc3Shape, "Release metadata shape is invalid");
  if (versionedShape || rc3Shape) {
    const parsedVersion = parseSystemVersion(metadata.system_version);
    if (parsedVersion.major >= 3) assert(rc3Shape, "Release metadata omits the display channel or bundled plugin provenance");
    if (metadata.previous_system_version === null) {
      assert(metadata.version_bump === "initial", "Initial release version metadata is invalid");
    } else {
      assert(
        metadata.version_bump === classifyVersionBump(metadata.previous_system_version, metadata.system_version),
        "Release semantic-version bump is inconsistent"
      );
    }
  }
  if (rc3Shape) {
    parseDisplayChannel(metadata.display_channel);
    assert(
      Array.isArray(metadata.bundled_source_plugins) &&
        metadata.bundled_source_plugins.length > 0 &&
        metadata.bundled_source_plugins.every((entry) => typeof entry === "string" && entry.length > 0),
      "Bundled source plugin metadata is invalid"
    );
    assert(
      canonicalJson(metadata.bundled_source_plugins) === canonicalJson([...new Set(metadata.bundled_source_plugins)].sort()),
      "Bundled source plugin metadata must be sorted and unique"
    );
    assert(metadata.host_plugin_activation === "Unverified", "Immutable release cannot claim host plugin activation");
    assert(
      canonicalJson(listSourcePluginNames(path.join(releaseRoot, "plugins"))) === canonicalJson(metadata.bundled_source_plugins),
      "Bundled source plugin inventory is inconsistent"
    );
  }
  const { release_id: releaseId, content_sha256: contentSha, ...payload } = metadata;
  assert(contentSha === `sha256:${sha256(canonicalJson(payload))}`, "Release metadata content digest mismatch");
  assert(releaseId === `v1-${contentSha.slice(7, 23)}`, "Release id is not content-addressed");
  assert(path.basename(releaseRoot) === releaseId, "Release directory does not match release id");
  assert(/^[0-9a-f]{40}$/.test(metadata.source_commit), "Release source commit is invalid");
  assert(metadata.source_branch === "main", "Release source branch is not main");
  assert(metadata.source_commit === metadata.source_remote_commit, "Release source and remote commits differ");
  const digest = bundleDigest(releaseRoot);
  assert(metadata.bundle_sha256 === `sha256:${digest.sha256}`, "Release bundle digest mismatch");
  assert(canonicalJson(metadata.files) === canonicalJson(digest.records), "Release file inventory mismatch");
  verifyPolicyRoot(path.join(releaseRoot, "policies"), {
    sourceRoot: releaseRoot,
    kernelFile: path.join(releaseRoot, "AGENTS.md"),
    skillFile: path.join(releaseRoot, "skills", "govern-codex-policy", "SKILL.md")
  });
  return metadata;
}

function atomicSymlink(target, link) {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  const temporary = path.join(path.dirname(link), `.${path.basename(link)}.acg-${process.pid}-${crypto.randomUUID()}`);
  fs.symlinkSync(target, temporary);
  fs.renameSync(temporary, link);
}

export function installStableLinks({ sourceRoot = codeRoot, releaseId, home = os.homedir(), faultAt = null }) {
  const releaseRoot = path.join(sourceRoot, ".runtime", "releases", releaseId);
  const releaseMetadata = verifyRelease(releaseRoot);
  const releaseRealRoot = fs.realpathSync(releaseRoot);
  const runtime = path.join(sourceRoot, ".runtime");
  const current = path.join(runtime, "current");
  const targets = [
    { id: "agents", link: path.join(home, ".codex", "AGENTS.md"), target: path.join(current, "AGENTS.md") },
    { id: "policies", link: path.join(home, ".codex", "policies"), target: path.join(current, "policies") },
    { id: "skill", link: path.join(home, ".codex", "skills", "govern-codex-policy"), target: path.join(current, "skills", "govern-codex-policy") }
  ];
  const stable = targets.every(({ link, target }) => {
    try {
      return fs.lstatSync(link).isSymbolicLink() && fs.readlinkSync(link) === target;
    } catch {
      return false;
    }
  });

  const priorCurrent = fs.existsSync(current) || fs.lstatSync(runtime, { throwIfNoEntry: false })
    ? (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink() ? fs.readlinkSync(current) : null)
    : null;
  const overlayStateFile = path.join(runtime, "overlay-state.json");
  if (fs.existsSync(overlayStateFile)) {
    const overlayState = readJson(overlayStateFile);
    for (const deployment of Object.values(overlayState.deployments ?? {})) {
      assert(
        deployment.compatible_manifest_versions?.includes(releaseMetadata.manifest.version),
        `Active overlay is incompatible with manifest version ${releaseMetadata.manifest.version}`
      );
    }
  }

  if (stable) {
    const temp = path.join(runtime, `.current-${process.pid}-${crypto.randomUUID()}`);
    try {
      fs.symlinkSync(releaseRoot, temp);
      fs.renameSync(temp, current);
      if (faultAt === "post_switch") throw new Error("Injected activation fault after pointer switch");
      for (const target of targets) assert(fs.realpathSync(target.link).startsWith(releaseRealRoot), `Stable link did not activate: ${target.id}`);
      return { release_id: releaseId, bootstrap: false, activation: "filesystem", existing_context_activation: "Unverified" };
    } catch (error) {
      fs.rmSync(temp, { force: true });
      if (priorCurrent) atomicSymlink(priorCurrent, current);
      else fs.rmSync(current, { force: true });
      throw error;
    }
  }

  fs.mkdirSync(runtime, { recursive: true });
  const transactionId = `bootstrap-${Date.now()}-${process.pid}`;
  const transactionDir = path.join(runtime, "transactions", transactionId);
  const backupDir = path.join(transactionDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const journalFile = path.join(transactionDir, "journal.json");
  const journal = { schema_version: 1, transaction_id: transactionId, release_id: releaseId, status: "staging", steps: [] };
  writeJsonAtomic(journalFile, journal);

  const staged = [];
  const installed = [];
  const backups = [];
  try {
    const currentTemp = path.join(runtime, `.current-${transactionId}`);
    fs.symlinkSync(releaseRoot, currentTemp);
    fs.renameSync(currentTemp, current);
    journal.steps.push("current_activated");
    writeJsonAtomic(journalFile, journal);
    if (faultAt === "current") throw new Error("Injected bootstrap fault at current");

    for (const target of targets) {
      fs.mkdirSync(path.dirname(target.link), { recursive: true });
      const temp = path.join(path.dirname(target.link), `.${path.basename(target.link)}.${transactionId}`);
      fs.symlinkSync(target.target, temp);
      assert(fs.existsSync(fs.realpathSync(temp)), `Staged link is unresolved: ${target.id}`);
      staged.push({ ...target, temp });
    }
    journal.steps.push("links_staged");
    writeJsonAtomic(journalFile, journal);
    if (faultAt === "staged") throw new Error("Injected bootstrap fault at staged");

    for (const target of staged) {
      if (fs.lstatSync(target.link, { throwIfNoEntry: false })) {
        const backup = path.join(backupDir, target.id);
        fs.renameSync(target.link, backup);
        backups.push({ link: target.link, backup });
      }
      fs.renameSync(target.temp, target.link);
      installed.push(target.link);
      journal.steps.push(`installed:${target.id}`);
      writeJsonAtomic(journalFile, journal);
      if (faultAt === target.id) throw new Error(`Injected bootstrap fault at ${target.id}`);
    }

    for (const target of targets) assert(fs.realpathSync(target.link).startsWith(releaseRealRoot), `Installed link did not resolve to release: ${target.id}`);
    journal.status = "complete";
    writeJsonAtomic(journalFile, journal);
    return { release_id: releaseId, bootstrap: true, transaction_id: transactionId, activation: "filesystem", existing_context_activation: "Unverified" };
  } catch (error) {
    for (const link of installed.reverse()) fs.rmSync(link, { recursive: true, force: true });
    for (const { link, backup } of backups.reverse()) if (fs.existsSync(backup)) fs.renameSync(backup, link);
    for (const target of staged) fs.rmSync(target.temp, { force: true });
    if (priorCurrent) atomicSymlink(priorCurrent, current);
    else fs.rmSync(current, { force: true });
    journal.status = "rolled_back";
    journal.error = error.message;
    writeJsonAtomic(journalFile, journal);
    throw error;
  }
}

function commitIsAncestor(sourceRoot, ancestor, descendant) {
  try {
    execFileSync("git", ["-C", sourceRoot, "merge-base", "--is-ancestor", ancestor, descendant], { stdio: "ignore" });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw new Error(`Cannot classify release ancestry: ${error.message}`);
  }
}

export function authorizeActivationDirection(sourceRoot, currentCommit, candidateCommit, allowRollback = false) {
  let direction = "same";
  if (currentCommit !== candidateCommit) {
    if (commitIsAncestor(sourceRoot, currentCommit, candidateCommit)) direction = "upgrade";
    else if (commitIsAncestor(sourceRoot, candidateCommit, currentCommit)) direction = "rollback";
    else direction = "divergent";
  }
  assert(
    allowRollback || direction === "same" || direction === "upgrade",
    `Refusing ${direction} activation from ${currentCommit} to ${candidateCommit}; use --allow-rollback for an explicitly authorized non-forward activation`
  );
  return direction;
}

export function activateRelease(sourceRoot = codeRoot, releaseId, home = os.homedir(), options = {}) {
  assert(releaseId, "Release id is required");
  const candidate = verifyRelease(path.join(sourceRoot, ".runtime", "releases", releaseId));
  const current = currentReleaseMetadata(sourceRoot);
  const direction = current
    ? authorizeActivationDirection(sourceRoot, current.source_commit, candidate.source_commit, options.allowRollback === true)
    : "bootstrap";
  const started = process.hrtime.bigint();
  const activation = installStableLinks({ sourceRoot, releaseId, home });
  const agentSystem = readAgentSystemProfile(process.env.ACG_MACHINE_PROFILE || path.join(home, ".codex", "governance-machine-profile.json"));
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    ...activation,
    previous_release_id: current?.release_id ?? null,
    previous_source_commit: current?.source_commit ?? null,
    source_commit: candidate.source_commit,
    system_version: candidate.system_version ?? "Unversioned legacy release",
    display_channel: candidate.display_channel ?? "Unversioned legacy release",
    previous_system_version: candidate.previous_system_version ?? null,
    version_bump: candidate.version_bump ?? "Unverified",
    activation_direction: direction,
    rollback_authorized: options.allowRollback === true,
    agent_system_consent: agentSystem.consent,
    agent_system_activation: agentSystem.consent.decision_required
      ? {
          status: "decision_required",
          mode: "inactive_local_only",
          next_actions: agentSystem.consent.next_actions
        }
      : { status: "configured", mode: agentSystem.reporting_contract.mode },
    activation_duration_ms: Math.round(durationMs * 1000) / 1000
  };
}

function currentReleaseMetadata(sourceRoot) {
  const current = path.join(sourceRoot, ".runtime", "current");
  if (!fs.existsSync(current)) return null;
  return readJson(path.join(fs.realpathSync(current), "release.json"));
}

function atomicCopy(source, target) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.acg-${process.pid}-${crypto.randomUUID()}`);
  fs.copyFileSync(source, temporary);
  fs.renameSync(temporary, target);
}

export function publishOverlays(sourceRoot = codeRoot) {
  const stateFile = path.join(sourceRoot, ".runtime", "overlay-state.json");
  const state = fs.existsSync(stateFile) ? readJson(stateFile) : { schema_version: 1, deployments: {} };
  const current = path.join(sourceRoot, ".runtime", "current");
  assert(fs.existsSync(current), "An active global release is required before overlay publication");
  const releaseRoot = fs.realpathSync(current);
  const activeRelease = verifyRelease(releaseRoot);
  const config = readJson(path.join(releaseRoot, "overlay-targets.json"));
  const results = [];
  const prepared = [];

  for (const target of config.targets) {
    assert(target.compatible_manifest_versions.includes(activeRelease.manifest.version), `Overlay ${target.id} is incompatible with the active manifest`);
    const source = path.join(releaseRoot, target.release_source);
    assert(fs.existsSync(source), `Overlay source missing: ${target.id}`);
    assert(fs.existsSync(path.dirname(target.target)), `Overlay target root missing: ${target.id}`);
    const actualRoot = execFileSync("git", ["-C", path.dirname(target.target), "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    assert(actualRoot === target.expected_git_root, `Overlay Git root differs for ${target.id}`);
    let actualRemote = null;
    try {
      actualRemote = execFileSync("git", ["-C", actualRoot, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      actualRemote = null;
    }
    assert(actualRemote === target.expected_remote, `Overlay remote identity differs for ${target.id}`);
    const sourceDigest = sha256(fs.readFileSync(source));
    const exists = fs.existsSync(target.target);
    const currentDigest = exists ? sha256(fs.readFileSync(target.target)) : null;
    const priorDigest = state.deployments[target.id]?.deployed_sha256 ?? target.initial_deployed_sha256 ?? null;
    const safe = !exists || currentDigest === sourceDigest || (priorDigest && currentDigest === priorDigest);
    assert(safe, `Overlay target drift detected: ${target.id}`);
    prepared.push({ target, source, sourceDigest, currentDigest, actualRoot });
  }

  for (const { target, source, sourceDigest, currentDigest, actualRoot } of prepared) {
    if (currentDigest !== sourceDigest) atomicCopy(source, target.target);

    if (target.ignore) {
      const excludeOutput = execFileSync("git", ["-C", actualRoot, "rev-parse", "--git-path", "info/exclude"], { encoding: "utf8" }).trim();
      const exclude = path.isAbsolute(excludeOutput) ? excludeOutput : path.join(actualRoot, excludeOutput);
      const relative = path.relative(actualRoot, target.target);
      const lines = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8").split("\n") : [];
      if (!lines.includes(relative)) fs.appendFileSync(exclude, `${lines.at(-1) === "" ? "" : "\n"}${relative}\n`, "utf8");
    }

    state.deployments[target.id] = {
      source: target.source,
      target: target.target,
      source_sha256: sourceDigest,
      deployed_sha256: sourceDigest,
      manifest_sha256: activeRelease.manifest.sha256,
      compatible_manifest_versions: target.compatible_manifest_versions,
      release_id: activeRelease.release_id,
      source_commit: activeRelease.source_commit,
      published_at: new Date().toISOString()
    };
    results.push({
      id: target.id,
      changed: currentDigest !== sourceDigest,
      sha256: sourceDigest,
      target: target.target,
      ignore_configured: target.ignore
    });
  }

  writeJsonAtomic(stateFile, state);
  return { release_id: activeRelease.release_id, results, state_file: stateFile };
}

export function runCanary(policyRoot = resolvePolicyRoot()) {
  const cases = [];
  const run = (name, request, check) => {
    const result = resolveRoute(request, policyRoot);
    check(result);
    cases.push({ name, passed: true });
    return result;
  };

  const trivial = run("trivial-read-only", {
    mode: "read_only", phase: "answer", project: "*", operations: ["read_file"], mutation_authority: false
  }, (result) => assert(result.active_modules.length === 0, "Trivial route loaded a specialist module"));

  run("review-minimum-closure", {
    mode: "read_only", phase: "review", project: "*", operations: ["repository_inspection"], mutation_authority: false
  }, (result) => assert(
    canonicalJson(result.active_modules.map((module) => module.id).sort()) ===
      canonicalJson(["context-routing", "jit-orchestration", "findings", "trust-and-data"].sort()),
    "Review closure is not minimal"
  ));

  run("future-phase-is-not-trigger", {
    mode: "read_only", phase: "plan", project: "*", operations: ["plan"], future_operations: ["build"], mutation_authority: false
  }, (result) => assert(!result.active_modules.some((module) => module.id === "storage"), "Future build speculatively loaded storage"));

  const planned = run("plan-receipt", {
    mode: "mutation", phase: "plan", project: "*", operations: ["plan"], mutation_authority: true
  }, (result) => assert(result.completion_sentinel.startsWith("ACG_ROUTE_COMPLETE:"), "Missing completion sentinel"));

  const plannedDelivery = deliverResolvedPolicy(planned, policyRoot);
  const acknowledged = acknowledgeDelivery(plannedDelivery, policyRoot).context_acknowledgment;

  run("phase-transition-delta", {
    mode: "mutation",
    phase: "build",
    project: "*",
    operations: ["build"],
    tools: ["shell"],
    paths: [path.join(codeRoot, ".runtime")],
    risk_tags: ["heavy_output"],
    mutation_authority: true,
    prior_receipt: acknowledged
  }, (result) => {
    assert(result.newly_required_module_paths.some((entry) => entry.endsWith("storage.md")), "Build did not require storage delta");
    assert(result.accumulated_policy_tokens === acknowledged.accumulated_policy_tokens, "Resolution changed accumulated accounting before delivery");
  });

  function loadIntoContext(request, prior = null) {
    const routed = resolveRoute({ ...request, prior_receipt: prior }, policyRoot);
    assert(!routed.rollover_required, `Unexpected rollover while preparing canary: ${request.operations}`);
    return acknowledgeDelivery(deliverResolvedPolicy(routed, policyRoot), policyRoot).context_acknowledgment;
  }

  let overflowPrior = loadIntoContext({
    mode: "read_only", phase: "plan", project: "*", operations: ["plan"], mutation_authority: false
  });
  overflowPrior = loadIntoContext({
    mode: "mutation",
    phase: "delegation",
    project: "*",
    operations: ["launch_mutating_subagent"],
    tools: ["subagent", "filesystem_write"],
    paths: [codeRoot],
    authorities: ["delegation"],
    mutation_authority: true
  }, overflowPrior);
  run("context-growth-never-rolls-over-from-policy-estimates", {
    mode: "read_only",
    phase: "review",
    project: "*",
    operations: ["repository_inspection"],
    tools: ["filesystem_read"],
    mutation_authority: false,
    prior_receipt: overflowPrior,
    objective: "Begin repository review",
    verified_state: "Context exceeds the advisory target",
    open_work: ["Load audit closure"]
  }, (result) => {
    assert(result.rollover_required === false, "Policy estimates forced a rollover");
    assert(result.newly_required_module_paths.length > 0, "Context growth hid the required module delta");
    assert(result.policy_context_enforcement === "advisory_only", "Context target was not advisory");
    assert(result.handoff === undefined, "Policy estimates produced a handoff");
  });

  run("fresh-context-current-closure-only", {
    mode: "read_only", phase: "review", project: "*", operations: ["repository_inspection"], mutation_authority: false
  }, (result) => assert(!result.already_in_context.includes("planning-and-capacity"), "Fresh context reloaded historical policy"));

  let unknownBlocked = false;
  try {
    resolveRoute({ mode: "read_only", phase: "unknown", project: "*", operations: ["future_magic"], mutation_authority: false }, policyRoot);
  } catch {
    unknownBlocked = true;
  }
  assert(unknownBlocked, "Unknown operation did not fail closed");
  cases.push({ name: "unknown-operation-default-deny", passed: true });

  let authorityBlocked = false;
  try {
    resolveRoute({
      mode: "read_only",
      phase: "release",
      project: "*",
      operations: ["deploy"],
      tools: ["deployment"],
      paths: [codeRoot],
      mutation_authority: false
    }, policyRoot);
  } catch {
    authorityBlocked = true;
  }
  assert(authorityBlocked, "Read-only deployment was not blocked");
  cases.push({ name: "effect-authority-default-deny", passed: true });

  return { passed: true, cases };
}
