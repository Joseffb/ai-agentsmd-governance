import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const PREFIX = "MODEL_ROUTING_GATE_V1 ";
const UNVERIFIED = "Unverified";

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target, files);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(target);
  }
  return files;
}

function findSessionFile(files, id) {
  const matches = files.filter((file) => path.basename(file).includes(id));
  if (matches.length !== 1) throw new Error(`Expected one task transcript for ${id}; found ${matches.length}`);
  return matches[0];
}

function parseEnvelope(message) {
  if (typeof message !== "string") return null;
  const first = message.split(/\r?\n/, 1)[0];
  if (!first.startsWith(PREFIX)) return null;
  try {
    const value = JSON.parse(first.slice(PREFIX.length));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function composerAssignmentMetadata(envelope) {
  if (!envelope || !Object.hasOwn(envelope, "composer_assignment")) {
    return {
      composer_assignment_status: "legacy_unbound",
      composer_bundle_digest: null,
      expected_requested_model: null,
      expected_requested_reasoning_raw: null,
      composer_worker_seat: null,
      spark_availability_evidence: null,
      spark_required: null,
      spark_fallback_authorized: null
    };
  }
  const value = envelope.composer_assignment;
  const gate = value?.spark_gate;
  const exactKeys = (candidate, expected) =>
    candidate && typeof candidate === "object" && !Array.isArray(candidate) &&
    JSON.stringify(Object.keys(candidate).sort()) === JSON.stringify([...expected].sort());
  const valid = exactKeys(value, [
    "schema_version",
    "bundle_path",
    "bundle_digest",
    "worker_seat",
    "worker_assignment_ids",
    "worker_prompt_envelope_sha256",
    "requested_model",
    "requested_reasoning_raw",
    "spark_gate",
    "availability_evidence"
  ]) &&
    value.schema_version === 1 &&
    typeof value.bundle_path === "string" &&
    path.isAbsolute(value.bundle_path) &&
    /^sha256:[a-f0-9]{64}$/.test(value.bundle_digest || "") &&
    Number.isInteger(value.worker_seat) &&
    value.worker_seat >= 1 &&
    envelope.seat_id === `seat-${value.worker_seat}` &&
    Array.isArray(value.worker_assignment_ids) &&
    value.worker_assignment_ids.length > 0 &&
    value.worker_assignment_ids.every((id) => typeof id === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(id)) &&
    /^sha256:[a-f0-9]{64}$/.test(value.worker_prompt_envelope_sha256 || "") &&
    typeof value.requested_model === "string" &&
    typeof value.requested_reasoning_raw === "string" &&
    value.availability_evidence === UNVERIFIED &&
    exactKeys(gate, [
      "work_kind",
      "requires_judgment",
      "availability",
      "actual_availability",
      "worker_required",
      "excluded_effects"
    ]) &&
    ["bounded_ai_transformation", "mechanical_edit", "unexposed"].includes(gate.work_kind) &&
    typeof gate.requires_judgment === "boolean" &&
    ["selectable", "authoritatively_unavailable", "separate_pool_exhausted", "unknown_or_unexposed"].includes(gate.availability) &&
    gate.actual_availability === UNVERIFIED &&
    typeof gate.worker_required === "boolean" &&
    Array.isArray(gate.excluded_effects) &&
    gate.excluded_effects.every((effect) => typeof effect === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(effect)) &&
    !["authoritatively_unavailable", "separate_pool_exhausted"].includes(gate.availability) &&
    (gate.work_kind !== "unexposed" || (
      gate.availability === "unknown_or_unexposed" &&
      gate.requires_judgment === true &&
      value.requested_model !== "gpt-5.3-codex-spark" &&
      !(value.requested_model === "gpt-5.6-terra" && value.requested_reasoning_raw === "low")
    ));
  if (!valid) {
    return {
      composer_assignment_status: "invalid_or_incomplete",
      composer_bundle_digest: null,
      expected_requested_model: null,
      expected_requested_reasoning_raw: null,
      composer_worker_seat: null,
      spark_availability_evidence: null,
      spark_required: null,
      spark_fallback_authorized: null
    };
  }
  const eligible = gate.work_kind !== "unexposed" &&
    gate.worker_required &&
    !gate.requires_judgment &&
    gate.excluded_effects.length === 0;
  return {
    composer_assignment_status: "bundle_reference_observed",
    composer_bundle_digest: value.bundle_digest,
    expected_requested_model: value.requested_model,
    expected_requested_reasoning_raw: value.requested_reasoning_raw,
    composer_worker_seat: value.worker_seat,
    spark_availability_evidence: UNVERIFIED,
    spark_required: eligible && gate.availability === "selectable",
    spark_fallback_authorized: eligible && gate.availability !== "selectable"
  };
}

function findAgentId(value) {
  if (!value) return null;
  if (typeof value === "object") {
    if (typeof value.agent_id === "string") return value.agent_id;
    for (const item of Array.isArray(value) ? value : Object.values(value)) {
      const found = findAgentId(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "string") return null;
  try {
    const found = findAgentId(JSON.parse(value));
    if (found) return found;
  } catch {
    // Tool output may be text rather than JSON.
  }
  return value.match(/"agent_id"\s*:\s*"([^"]+)"/)?.[1] || null;
}

async function readChildMetadata(file, parentThreadId) {
  let parent = null;
  let model = null;
  let reasoning = null;
  const stream = fs.createReadStream(file);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type === "session_meta") parent = row.payload?.parent_thread_id || null;
    if (row.type === "turn_context") {
      model ||= row.payload?.model || null;
      reasoning ||= row.payload?.collaboration_mode?.settings?.reasoning_effort || row.payload?.effort || null;
    }
    if (parent && model && reasoning) break;
  }
  lines.close();
  stream.destroy();
  if (parent !== parentThreadId) return null;
  return { model: model || UNVERIFIED, reasoning: reasoning || UNVERIFIED };
}

async function readParentLaunches(file) {
  const calls = [];
  const byCall = new Map();
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = row.payload;
    if (
      row.type === "response_item" &&
      payload?.type === "function_call" &&
      (payload.name === "spawn_agent" || String(payload.name).endsWith("__spawn_agent"))
    ) {
      let args = {};
      try {
        args = typeof payload.arguments === "string" ? JSON.parse(payload.arguments) : payload.arguments || {};
      } catch {
        // Invalid arguments remain observable as an incomplete assignment.
      }
      const envelope = parseEnvelope(args.message);
      const composer = composerAssignmentMetadata(envelope);
      const call = {
        timestamp: row.timestamp,
        tool_use_id: payload.call_id,
        seat_id: envelope?.seat_id || null,
        objective: envelope?.objective || null,
        routing_reason: envelope?.routing_reason || null,
        weaker_insufficient: envelope?.weaker_insufficient || null,
        stronger_unnecessary: envelope?.stronger_unnecessary || null,
        requested_model: typeof args.model === "string" ? args.model : null,
        requested_reasoning_raw: typeof args.reasoning_effort === "string" ? args.reasoning_effort : null,
        ...composer,
        model_critical: envelope?.model_critical ?? null,
        reasoning_critical: envelope?.reasoning_critical ?? null,
        attempt: envelope?.attempt ?? null,
        fork_context: args.fork_context ?? null,
        agent_id: null
      };
      calls.push(call);
      byCall.set(payload.call_id, call);
    }
    if (row.type === "response_item" && payload?.type === "function_call_output") {
      const call = byCall.get(payload.call_id);
      if (call) call.agent_id = findAgentId(payload.output);
    }
  }
  return calls;
}

function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  const events = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event === "object") events.push(event);
    } catch {
      throw new Error(`Invalid model-routing JSONL: ${file}`);
    }
  }
  return events;
}

function appendNewEvents(file, events) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const known = new Set(readEvents(file).map((event) => event.event_id));
  const fresh = events.filter((event) => !known.has(event.event_id));
  if (fresh.length) fs.appendFileSync(file, `${fresh.map((event) => JSON.stringify(event)).join("\n")}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best-effort on filesystems without POSIX modes.
  }
  return fresh.length;
}

function summarize(events, threadId, days, imported) {
  const cutoff = Date.now() - days * 86_400_000;
  const filtered = events.filter((event) => {
    const timestamp = Date.parse(event.recorded_at || event.timestamp || "");
    return event.event_type === "transcript_launch_observed" &&
      event.task_id === threadId &&
      Number.isFinite(timestamp) &&
      timestamp >= cutoff;
  });
  const unique = [...new Map(filtered.map((event) => [event.event_id, event])).values()];
  const counts = {};
  for (const event of unique) {
    const key = `${event.requested_model || "missing"}/${event.requested_reasoning_raw || "missing"}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  const expensive = unique.filter((event) =>
    event.requested_model === "gpt-5.6-sol" &&
    ["xhigh", "max", "ultra"].includes(event.requested_reasoning_raw)
  );
  const proportionalityMissing = expensive.filter((event) => !event.weaker_insufficient);
  return {
    schema_version: 1,
    task_id: threadId,
    window_days: days,
    imported_events: imported,
    total_launches: unique.length,
    requested_assignment_counts: counts,
    sol_xhigh_or_stronger: {
      count: expensive.length,
      percent: unique.length ? Number((100 * expensive.length / unique.length).toFixed(1)) : 0
    },
    missing_explicit_assignment: unique.filter((event) =>
      !event.requested_model || !event.requested_reasoning_raw ||
      /^inherit/i.test(event.requested_model) || /^inherit/i.test(event.requested_reasoning_raw)
    ).length,
    unenveloped_launches: unique.filter((event) => !event.seat_id).length,
    actual_model_unverified: unique.filter((event) => event.actual_model === UNVERIFIED).length,
    model_mismatches: unique.filter((event) => event.model_attestation === "mismatch").length,
    composer_bound_launches: unique.filter((event) => event.composer_assignment_status === "bundle_reference_observed").length,
    composer_assignment_mismatches: unique.filter((event) =>
      event.composer_assignment_status === "invalid_or_incomplete" ||
      (event.composer_assignment_status === "bundle_reference_observed" && (
        event.requested_model !== event.expected_requested_model ||
        event.requested_reasoning_raw !== event.expected_requested_reasoning_raw
      ))
    ).length,
    spark_required_launches: unique.filter((event) => event.spark_required === true).length,
    spark_fallback_launches: unique.filter((event) => event.spark_fallback_authorized === true).length,
    actual_reasoning_unverified: unique.filter((event) => event.actual_reasoning_raw === UNVERIFIED).length,
    proportionality_evidence_missing: proportionalityMissing.length,
    expensive_seats_missing_weaker_analysis: proportionalityMissing.map((event) => event.seat_id || event.agent_id || event.tool_use_id),
    seats: unique.map((event) => ({
      timestamp: event.recorded_at,
      seat_id: event.seat_id,
      agent_id: event.agent_id,
      requested_model: event.requested_model,
      requested_reasoning_raw: event.requested_reasoning_raw,
      composer_assignment_status: event.composer_assignment_status,
      composer_bundle_digest: event.composer_bundle_digest,
      expected_requested_model: event.expected_requested_model,
      expected_requested_reasoning_raw: event.expected_requested_reasoning_raw,
      composer_worker_seat: event.composer_worker_seat,
      spark_availability_evidence: event.spark_availability_evidence,
      spark_required: event.spark_required,
      spark_fallback_authorized: event.spark_fallback_authorized,
      actual_model: event.actual_model,
      actual_reasoning_raw: event.actual_reasoning_raw,
      model_attestation: event.model_attestation,
      reasoning_attestation: event.reasoning_attestation,
      proportionality_evidence: event.weaker_insufficient ? "recorded" : "not_in_launch_envelope"
    })),
    evidence: {
      source: "authoritative local task and child-session transcripts",
      prompts_or_output_logged: false,
      hook_coverage_alone_complete: false
    }
  };
}

export async function auditModelRouting({
  threadId,
  days = 14,
  sessionRoot = path.join(os.homedir(), ".codex", "sessions"),
  logFile = path.join(os.homedir(), ".codex", "plugin-data", "model-routing-gate", "model-routing-events.jsonl")
} = {}) {
  if (typeof threadId !== "string" || !threadId) throw new Error("--thread is required");
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("--days must be an integer from 1 to 365");
  const files = walk(path.resolve(sessionRoot));
  const parentFile = findSessionFile(files, threadId);
  const launches = await readParentLaunches(parentFile);
  const events = [];
  for (const launch of launches) {
    let actual = null;
    let childFile = null;
    if (launch.agent_id) {
      const matches = files.filter((file) => path.basename(file).includes(launch.agent_id));
      if (matches.length === 1) {
        childFile = matches[0];
        actual = await readChildMetadata(childFile, threadId);
      }
    }
    const actualModel = actual?.model || UNVERIFIED;
    const actualReasoning = actual?.reasoning || UNVERIFIED;
    events.push({
      schema_version: 1,
      event_id: sha256(`transcript\0${threadId}\0${launch.tool_use_id}`).slice(0, 32),
      event_type: "transcript_launch_observed",
      coverage: "authoritative_task_transcript",
      recorded_at: launch.timestamp,
      task_id: threadId,
      tool_use_id: launch.tool_use_id,
      seat_id: launch.seat_id,
      agent_id: launch.agent_id,
      objective: launch.objective,
      routing_reason: launch.routing_reason,
      weaker_insufficient: launch.weaker_insufficient,
      stronger_unnecessary: launch.stronger_unnecessary,
      requested_model: launch.requested_model,
      requested_reasoning_raw: launch.requested_reasoning_raw,
      composer_assignment_status: launch.composer_assignment_status,
      composer_bundle_digest: launch.composer_bundle_digest,
      expected_requested_model: launch.expected_requested_model,
      expected_requested_reasoning_raw: launch.expected_requested_reasoning_raw,
      composer_worker_seat: launch.composer_worker_seat,
      spark_availability_evidence: launch.spark_availability_evidence,
      spark_required: launch.spark_required,
      spark_fallback_authorized: launch.spark_fallback_authorized,
      actual_model: actualModel,
      actual_reasoning_raw: actualReasoning,
      model_attestation: actualModel === UNVERIFIED
        ? "missing_runtime_evidence"
        : actualModel === launch.requested_model ? "verified" : "mismatch",
      reasoning_attestation: actualReasoning === UNVERIFIED
        ? "configured_not_runtime_attested"
        : actualReasoning === launch.requested_reasoning_raw ? "verified" : "mismatch",
      model_critical: launch.model_critical,
      reasoning_critical: launch.reasoning_critical,
      attempt: launch.attempt,
      fork_context: launch.fork_context,
      evidence: {
        parent_transcript: parentFile,
        child_transcript: childFile,
        prompts_or_output_logged: false
      }
    });
  }
  const imported = appendNewEvents(path.resolve(logFile), events);
  return {
    ...summarize(readEvents(path.resolve(logFile)), threadId, days, imported),
    ledger: path.resolve(logFile),
    completion_sentinel: `ACG_MODEL_AUDIT_COMPLETE:${sha256(`${threadId}\0${days}\0${events.length}`).slice(0, 16)}`
  };
}
