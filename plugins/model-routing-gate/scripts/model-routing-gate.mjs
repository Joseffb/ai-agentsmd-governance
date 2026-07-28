#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const ENVELOPE_PREFIX = "MODEL_ROUTING_GATE_V1 ";
export const UNVERIFIED = "Unverified";

const MODEL_REASONING = new Map([
  ["gpt-5.6-luna", new Set(["low", "medium", "high", "xhigh", "max"])],
  ["gpt-5.6-terra", new Set(["low", "medium", "high", "xhigh", "max", "ultra"])],
  ["gpt-5.3-codex-spark", new Set(["low", "medium", "high", "xhigh"])],
  ["gpt-5.6-sol", new Set(["low", "medium", "high", "xhigh", "max", "ultra"])]
]);

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function ref(...parts) {
  return digest(parts.join("\0")).slice(0, 24);
}

function stateRoot(override) {
  if (override) return path.resolve(override);
  if (process.env.MODEL_ROUTING_GATE_STATE_DIR) return path.resolve(process.env.MODEL_ROUTING_GATE_STATE_DIR);
  if (process.env.PLUGIN_DATA) return path.join(path.resolve(process.env.PLUGIN_DATA), "model-routing-gate");
  return path.join(os.homedir(), ".codex", "plugin-data", "model-routing-gate");
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // Best-effort on filesystems without POSIX modes.
  }
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function atomicWrite(file, value) {
  ensurePrivateDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best-effort on filesystems without POSIX modes.
  }
}

function compactMetadata(value, name, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${name} must be explicit`);
    return null;
  }
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  const compact = value.trim().replace(/\s+/g, " ");
  if (compact.length > 320) throw new Error(`${name} must not exceed 320 characters`);
  return compact;
}

function routingEventLog(root) {
  return path.join(root, "model-routing-events.jsonl");
}

function appendRoutingEvent(root, event) {
  ensurePrivateDirectory(root);
  const record = {
    schema_version: 1,
    event_id: ref(
      "model-routing-event",
      event.event_type,
      event.session_id || "",
      event.tool_use_id || "",
      event.agent_id || "",
      event.status || ""
    ),
    recorded_at: new Date().toISOString(),
    coverage: "hook_observed",
    ...event
  };
  const file = routingEventLog(root);
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best-effort on filesystems without POSIX modes.
  }
  return record;
}

function pathsFor(root, sessionId) {
  const sessionRef = ref("session", sessionId);
  const base = path.join(root, "sessions", sessionRef);
  return {
    base,
    request: (toolUseId) => path.join(base, "requests", `${ref("tool", toolUseId)}.json`),
    start: (agentId) => path.join(base, "starts", `${ref("agent", agentId)}.json`),
    binding: (agentId) => path.join(base, "bindings", `${ref("agent", agentId)}.json`),
    receipt: (agentId) => path.join(base, "receipts", `${ref("agent", agentId)}.json`),
    attemptReceipt: (toolUseId) => path.join(base, "attempts", `${ref("tool", toolUseId)}.json`),
    seat: (seatId) => path.join(base, "seats", `${ref("seat", seatId)}.json`),
    lock: (seatId) => path.join(base, "locks", `${ref("seat", seatId)}.lock`)
  };
}

function withSeatLock(file, callback) {
  ensurePrivateDirectory(path.dirname(file));
  let handle;
  try {
    handle = fs.openSync(file, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Concurrent launch for the same seat is blocked");
    throw error;
  }
  try {
    return callback();
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(file);
  }
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    },
    systemMessage: reason
  };
}

function allow(additionalContext) {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow"
    }
  };
  if (additionalContext) output.hookSpecificOutput.additionalContext = additionalContext;
  return output;
}

function postFeedback(reason, stop = false) {
  return {
    ...(stop ? { continue: false, stopReason: reason } : {}),
    decision: "block",
    reason,
    systemMessage: reason,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: reason
    }
  };
}

function startContext(message) {
  return {
    systemMessage: message,
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext: message
    }
  };
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseEnvelope(message) {
  if (typeof message !== "string") throw new Error("Governed launches require a string message");
  const firstLine = message.split(/\r?\n/, 1)[0];
  if (!firstLine.startsWith(ENVELOPE_PREFIX)) throw new Error("Direct ungoverned launch blocked: missing Model Routing Gate envelope");
  let envelope;
  try {
    envelope = JSON.parse(firstLine.slice(ENVELOPE_PREFIX.length));
  } catch {
    throw new Error("Model Routing Gate envelope is not valid JSON");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("Model Routing Gate envelope must be an object");
  const allowed = new Set([
    "schema_version",
    "seat_id",
    "model_critical",
    "reasoning_critical",
    "attempt",
    "objective",
    "routing_reason",
    "weaker_insufficient",
    "stronger_unnecessary"
  ]);
  const unknown = Object.keys(envelope).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown Model Routing Gate envelope field: ${unknown.join(", ")}`);
  if (envelope.schema_version !== 1) throw new Error("Unsupported Model Routing Gate envelope version");
  if (typeof envelope.seat_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(envelope.seat_id)) {
    throw new Error("seat_id must be a stable 1-64 character identifier");
  }
  if (typeof envelope.model_critical !== "boolean") throw new Error("model_critical must be explicit");
  if (typeof envelope.reasoning_critical !== "boolean") throw new Error("reasoning_critical must be explicit");
  if (envelope.reasoning_critical && !envelope.model_critical) throw new Error("reasoning_critical requires model_critical");
  if (envelope.attempt !== 1 && envelope.attempt !== 2) throw new Error("attempt must be 1 or 2");
  return {
    ...envelope,
    objective: compactMetadata(envelope.objective, "objective"),
    routing_reason: compactMetadata(envelope.routing_reason, "routing_reason"),
    weaker_insufficient: compactMetadata(envelope.weaker_insufficient, "weaker_insufficient"),
    stronger_unnecessary: compactMetadata(envelope.stronger_unnecessary, "stronger_unnecessary")
  };
}

function validateAssignment(toolInput) {
  const model = cleanString(toolInput?.model);
  const reasoning = cleanString(toolInput?.reasoning_effort);
  if (!model || /^inherit(?: current)?$/i.test(model)) throw new Error("Exact runtime model ID is required; Inherit current is forbidden");
  if (!reasoning || /^inherit(?: current)?$/i.test(reasoning)) throw new Error("Exact raw reasoning value is required; Inherit current is forbidden");
  const supportedReasoning = MODEL_REASONING.get(model);
  if (!supportedReasoning) throw new Error(`Unsupported exact runtime model ID: ${model}`);
  if (!supportedReasoning.has(reasoning)) throw new Error(`Unsupported reasoning value '${reasoning}' for ${model}`);
  return { model, reasoning };
}

function attemptReceipt(input, request, status, reason) {
  return {
    schema_version: 1,
    receipt_type: "model_routing_launch_attempt",
    recorded_at: new Date().toISOString(),
    session_ref: ref("session", input.session_id),
    correlation_id: request?.correlation_id || ref("correlation", input.session_id, input.tool_use_id || "missing"),
    tool_use_ref: input.tool_use_id ? ref("tool", input.tool_use_id) : null,
    seat_id: request?.seat_id || null,
    attempt: request?.attempt || null,
    model_critical: request?.model_critical ?? null,
    reasoning_critical: request?.reasoning_critical ?? null,
    requested_model: request?.requested_model || null,
    requested_reasoning_raw: request?.requested_reasoning_raw || null,
    objective: request?.objective || null,
    routing_reason: request?.routing_reason || null,
    weaker_insufficient: request?.weaker_insufficient || null,
    stronger_unnecessary: request?.stronger_unnecessary || null,
    status,
    reason
  };
}

function recordDeniedAttempt(root, input, request, reason) {
  if (!input.session_id || !input.tool_use_id) return;
  const p = pathsFor(root, input.session_id);
  atomicWrite(p.attemptReceipt(input.tool_use_id), attemptReceipt(input, request, "rejected_before_launch", reason));
  appendRoutingEvent(root, {
    event_type: "launch_rejected",
    session_id: input.session_id,
    tool_use_id: input.tool_use_id,
    seat_id: request?.seat_id || null,
    requested_model: request?.requested_model || cleanString(input.tool_input?.model),
    requested_reasoning_raw: request?.requested_reasoning_raw || cleanString(input.tool_input?.reasoning_effort),
    status: "rejected_before_launch",
    reason
  });
}

function isSpawn(name) {
  return name === "Agent" || /(^|__)spawn_agent$/.test(name || "");
}

function isWait(name) {
  return /(^|__)wait_agent$/.test(name || "");
}

function isClose(name) {
  return /(^|__)close_agent$/.test(name || "");
}

function extractAgentId(value) {
  if (!value) return null;
  if (typeof value === "object") {
    if (typeof value.agent_id === "string") return value.agent_id;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = extractAgentId(item);
        if (found) return found;
      }
    } else {
      for (const item of Object.values(value)) {
        const found = extractAgentId(item);
        if (found) return found;
      }
    }
    return null;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    const found = extractAgentId(parsed);
    if (found) return found;
  } catch {
    // Model-facing output may be text rather than raw JSON.
  }
  const match = value.match(/"agent_id"\s*:\s*"([^"]+)"/);
  return match?.[1] || null;
}

function actualReasoning(start) {
  for (const key of ["reasoning_effort", "reasoning", "reasoning_level"]) {
    const value = cleanString(start?.[key]);
    if (value) return value;
  }
  return UNVERIFIED;
}

function finalStatus(request, start) {
  const actualModel = cleanString(start?.model) || UNVERIFIED;
  const actualReasoningRaw = actualReasoning(start);
  const modelAttestation = actualModel === UNVERIFIED
    ? "missing_runtime_evidence"
    : actualModel === request.requested_model
      ? "verified"
      : "mismatch";
  const reasoningAttestation = actualReasoningRaw === UNVERIFIED
    ? "configured_not_runtime_attested"
    : actualReasoningRaw === request.requested_reasoning_raw
      ? "verified"
      : "mismatch";

  let status = "accepted";
  let reason = "Requested model matches authoritative SubagentStart model metadata";
  if (modelAttestation !== "verified") {
    status = request.attempt === 2 ? "blocked_runtime_routing_defect" : "rejected";
    reason = modelAttestation === "mismatch" ? "Runtime model differs from requested model" : "Authoritative SubagentStart model evidence is missing";
  } else if (reasoningAttestation === "mismatch") {
    status = request.attempt === 2 ? "blocked_runtime_routing_defect" : "rejected";
    reason = "Runtime reasoning differs from requested reasoning";
  } else if (request.reasoning_critical && reasoningAttestation !== "verified") {
    status = request.attempt === 2 ? "blocked_runtime_routing_defect" : "rejected";
    reason = "Reasoning-critical seat lacks authoritative runtime reasoning evidence";
  } else if (!request.model_critical) {
    status = "accepted_non_critical";
    reason = "Explicit assignment is model-attested; seat is not model-critical";
  }

  return {
    actualModel,
    actualReasoningRaw,
    modelAttestation,
    reasoningAttestation,
    status,
    reason,
    outputAdmissible: status === "accepted" || status === "accepted_non_critical"
  };
}

function reconcileAgent(root, sessionId, agentId) {
  const p = pathsFor(root, sessionId);
  const binding = readJson(p.binding(agentId));
  if (!binding) return null;
  const request = readJson(p.request(binding.tool_use_id));
  if (!request) throw new Error("Agent binding refers to a missing launch request");

  if (request.kind === "reuse") {
    const receipt = {
      ...request.prior_receipt,
      receipt_type: "model_routing_attestation",
      recorded_at: new Date().toISOString(),
      correlation_id: request.correlation_id,
      tool_use_ref: ref("tool", request.tool_use_id),
      seat_id: request.seat_id,
      requested_model: request.requested_model,
      requested_reasoning_raw: request.requested_reasoning_raw,
      status: "accepted_reuse",
      reason: "Previously attested agent reused with an identical explicit assignment",
      output_admissible: true,
      close_required: false,
      evidence: {
        pre_tool_use: true,
        post_tool_use: true,
        subagent_start: request.prior_receipt.evidence?.subagent_start === true,
        source: "Codex lifecycle hook metadata"
      }
    };
    atomicWrite(p.receipt(agentId), receipt);
    return receipt;
  }

  const start = readJson(p.start(agentId));
  if (!start) {
    const pending = {
      schema_version: 1,
      receipt_type: "model_routing_attestation",
      recorded_at: new Date().toISOString(),
      session_ref: ref("session", sessionId),
      correlation_id: request.correlation_id,
      tool_use_ref: ref("tool", request.tool_use_id),
      agent_ref: ref("agent", agentId),
      seat_id: request.seat_id,
      attempt: request.attempt,
      model_critical: request.model_critical,
      reasoning_critical: request.reasoning_critical,
      requested_model: request.requested_model,
      actual_model: UNVERIFIED,
      model_attestation: "missing_runtime_evidence",
      requested_reasoning_raw: request.requested_reasoning_raw,
      actual_reasoning_raw: UNVERIFIED,
      reasoning_attestation: "configured_not_runtime_attested",
      status: "pending_runtime_evidence",
      output_admissible: false,
      close_required: false,
      reason: "Awaiting authoritative SubagentStart evidence",
      evidence: {
        pre_tool_use: true,
        post_tool_use: true,
        subagent_start: false,
        source: "Codex lifecycle hook metadata"
      }
    };
    atomicWrite(p.receipt(agentId), pending);
    return pending;
  }

  const evaluated = finalStatus(request, start);
  const receipt = {
    schema_version: 1,
    receipt_type: "model_routing_attestation",
    recorded_at: new Date().toISOString(),
    session_ref: ref("session", sessionId),
    correlation_id: request.correlation_id,
    tool_use_ref: ref("tool", request.tool_use_id),
    agent_ref: ref("agent", agentId),
    seat_id: request.seat_id,
    attempt: request.attempt,
    model_critical: request.model_critical,
    reasoning_critical: request.reasoning_critical,
    requested_model: request.requested_model,
    actual_model: evaluated.actualModel,
    model_attestation: evaluated.modelAttestation,
    requested_reasoning_raw: request.requested_reasoning_raw,
    actual_reasoning_raw: evaluated.actualReasoningRaw,
    reasoning_attestation: evaluated.reasoningAttestation,
    status: evaluated.status,
    output_admissible: evaluated.outputAdmissible,
    close_required: !evaluated.outputAdmissible,
    reason: evaluated.reason,
    evidence: {
      pre_tool_use: true,
      post_tool_use: true,
      subagent_start: true,
      source: "Codex lifecycle hook metadata"
    }
  };
  atomicWrite(p.receipt(agentId), receipt);

  const seat = readJson(p.seat(request.seat_id)) || {};
  atomicWrite(p.seat(request.seat_id), {
    ...seat,
    seat_id: request.seat_id,
    attempts: Math.max(seat.attempts || 0, request.attempt),
    status: evaluated.outputAdmissible ? "accepted" : evaluated.status,
    agent_id: agentId,
    actual_model: evaluated.actualModel,
    requested_model: request.requested_model
  });
  return receipt;
}

function preSpawn(root, input) {
  let envelope;
  let assignment;
  try {
    envelope = parseEnvelope(input.tool_input?.message);
    assignment = validateAssignment(input.tool_input);
  } catch (error) {
    recordDeniedAttempt(root, input, null, error.message);
    return deny(error.message);
  }
  if (!cleanString(input.session_id) || !cleanString(input.tool_use_id)) {
    const reason = "Codex did not provide deterministic session and tool-use identifiers";
    recordDeniedAttempt(root, input, null, reason);
    return deny(reason);
  }

  const p = pathsFor(root, input.session_id);
  const request = {
    schema_version: 1,
    kind: cleanString(input.tool_input?.agent_id) ? "reuse" : "launch",
    session_id: input.session_id,
    tool_use_id: input.tool_use_id,
    correlation_id: ref("correlation", input.session_id, input.tool_use_id),
    seat_id: envelope.seat_id,
    attempt: envelope.attempt,
    model_critical: envelope.model_critical,
    reasoning_critical: envelope.reasoning_critical,
    requested_model: assignment.model,
    requested_reasoning_raw: assignment.reasoning,
    objective: envelope.objective,
    routing_reason: envelope.routing_reason,
    weaker_insufficient: envelope.weaker_insufficient,
    stronger_unnecessary: envelope.stronger_unnecessary
  };

  if (readJson(p.request(input.tool_use_id))) {
    const reason = "Duplicate or stale tool correlation is blocked";
    recordDeniedAttempt(root, input, request, reason);
    return deny(reason);
  }

  try {
    return withSeatLock(p.lock(envelope.seat_id), () => {
      if (request.kind === "reuse") {
        const agentId = input.tool_input.agent_id;
        const prior = readJson(p.receipt(agentId));
        if (!prior?.output_admissible) throw new Error("Agent reuse requires an accepted model-routing receipt");
        if (prior.seat_id !== envelope.seat_id) throw new Error("Agent reuse cannot change the verified seat identity");
        if (prior.actual_model !== assignment.model) throw new Error("Agent reuse model is incompatible with the requested model");
        if (prior.requested_reasoning_raw !== assignment.reasoning) throw new Error("Agent reuse reasoning differs from the configured assignment");
        request.prior_receipt = prior;
        atomicWrite(p.request(input.tool_use_id), request);
        atomicWrite(p.attemptReceipt(input.tool_use_id), attemptReceipt(input, request, "reuse_requested", "Compatible verified agent reuse"));
        appendRoutingEvent(root, {
          event_type: "launch_requested",
          session_id: input.session_id,
          tool_use_id: input.tool_use_id,
          seat_id: request.seat_id,
          requested_model: request.requested_model,
          requested_reasoning_raw: request.requested_reasoning_raw,
          objective: request.objective,
          routing_reason: request.routing_reason,
          weaker_insufficient: request.weaker_insufficient,
          stronger_unnecessary: request.stronger_unnecessary,
          status: "reuse_requested"
        });
        return allow(`Model Routing Gate accepted compatible reuse for seat ${envelope.seat_id}.`);
      }

      const seat = readJson(p.seat(envelope.seat_id));
      const expectedAttempt = !seat ? 1 : seat.status === "rejected" && seat.attempts === 1 ? 2 : null;
      if (expectedAttempt === null) throw new Error("Seat already launched or exhausted its single governed relaunch");
      if (envelope.attempt !== expectedAttempt) throw new Error(`Seat requires governed attempt ${expectedAttempt}`);
      atomicWrite(p.request(input.tool_use_id), request);
      atomicWrite(p.seat(envelope.seat_id), {
        seat_id: envelope.seat_id,
        attempts: envelope.attempt,
        status: "launch_requested",
        tool_use_id: input.tool_use_id,
        requested_model: assignment.model
      });
      atomicWrite(p.attemptReceipt(input.tool_use_id), attemptReceipt(input, request, "launch_requested", "Explicit assignment accepted before launch"));
      appendRoutingEvent(root, {
        event_type: "launch_requested",
        session_id: input.session_id,
        tool_use_id: input.tool_use_id,
        seat_id: request.seat_id,
        requested_model: request.requested_model,
        requested_reasoning_raw: request.requested_reasoning_raw,
        model_critical: request.model_critical,
        reasoning_critical: request.reasoning_critical,
        objective: request.objective,
        routing_reason: request.routing_reason,
        weaker_insufficient: request.weaker_insufficient,
        stronger_unnecessary: request.stronger_unnecessary,
        status: "launch_requested"
      });
      return allow(`Model Routing Gate recorded ${assignment.model}/${assignment.reasoning} for seat ${envelope.seat_id}.`);
    });
  } catch (error) {
    recordDeniedAttempt(root, input, request, error.message);
    return deny(error.message);
  }
}

function preWait(root, input) {
  const ids = Array.isArray(input.tool_input?.ids)
    ? input.tool_input.ids
    : Array.isArray(input.tool_input?.agent_ids)
      ? input.tool_input.agent_ids
      : [];
  if (!ids.length) return deny("wait_agent requires explicit agent IDs for model-routing admission");
  const p = pathsFor(root, input.session_id);
  for (const agentId of ids) {
    const receipt = readJson(p.receipt(agentId));
    if (!receipt?.output_admissible) {
      const status = receipt?.status || "missing_receipt";
      return deny(`Subagent output is inadmissible (${status}); close rejected seats before relaunch or integration`);
    }
  }
  return allow("All requested subagent outputs have admissible model-routing receipts.");
}

function postSpawn(root, input) {
  const p = pathsFor(root, input.session_id);
  const request = readJson(p.request(input.tool_use_id));
  if (!request) return postFeedback("Spawn completed without a recorded Model Routing Gate request; close the ungoverned agent", true);
  const agentId = extractAgentId(input.tool_response);
  if (!agentId) return postFeedback("Spawn response lacked a deterministic agent_id; output is inadmissible", true);
  const existing = readJson(p.binding(agentId));
  if (existing && existing.tool_use_id !== input.tool_use_id) {
    return postFeedback("Duplicate or stale agent correlation detected; close the agent", true);
  }
  atomicWrite(p.binding(agentId), { agent_id: agentId, tool_use_id: input.tool_use_id });
  appendRoutingEvent(root, {
    event_type: "launch_bound",
    session_id: input.session_id,
    tool_use_id: input.tool_use_id,
    agent_id: agentId,
    seat_id: request.seat_id,
    requested_model: request.requested_model,
    requested_reasoning_raw: request.requested_reasoning_raw,
    status: "bound"
  });
  const receipt = reconcileAgent(root, input.session_id, agentId);
  if (receipt) appendRoutingEvent(root, {
    event_type: "runtime_attestation",
    session_id: input.session_id,
    tool_use_id: input.tool_use_id,
    agent_id: agentId,
    seat_id: receipt.seat_id,
    requested_model: receipt.requested_model,
    requested_reasoning_raw: receipt.requested_reasoning_raw,
    actual_model: receipt.actual_model,
    actual_reasoning_raw: receipt.actual_reasoning_raw,
    model_attestation: receipt.model_attestation,
    reasoning_attestation: receipt.reasoning_attestation,
    output_admissible: receipt.output_admissible,
    status: receipt.status
  });
  if (!receipt?.output_admissible && receipt?.status !== "pending_runtime_evidence") {
    return postFeedback(`${receipt.reason}. Close agent ${agentId}; its output is inadmissible.`, true);
  }
  return {
    systemMessage: receipt?.status === "pending_runtime_evidence"
      ? "Model Routing Gate bound the agent and is awaiting SubagentStart evidence; do not collect output yet."
      : `Model Routing Gate accepted ${receipt.actual_model} for seat ${receipt.seat_id}.`,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: receipt?.status === "pending_runtime_evidence"
        ? "Await runtime model attestation before wait_agent."
        : `Model routing receipt accepted for ${receipt.seat_id}.`
    }
  };
}

function onSubagentStart(root, input) {
  if (!cleanString(input.session_id) || !cleanString(input.agent_id)) {
    return startContext("Model Routing Gate could not correlate this subagent; its output is inadmissible.");
  }
  const p = pathsFor(root, input.session_id);
  const existing = readJson(p.start(input.agent_id));
  const observed = {
    agent_id: input.agent_id,
    model: cleanString(input.model) || UNVERIFIED,
    ...(cleanString(input.reasoning_effort) ? { reasoning_effort: input.reasoning_effort } : {}),
    ...(cleanString(input.reasoning) ? { reasoning: input.reasoning } : {}),
    ...(cleanString(input.reasoning_level) ? { reasoning_level: input.reasoning_level } : {})
  };
  if (existing && JSON.stringify(existing) !== JSON.stringify(observed)) {
    return startContext("Conflicting SubagentStart evidence detected; this agent output is inadmissible.");
  }
  atomicWrite(p.start(input.agent_id), observed);
  const receipt = reconcileAgent(root, input.session_id, input.agent_id);
  if (!receipt) return startContext("Model Routing Gate captured runtime model evidence and is awaiting deterministic spawn binding.");
  appendRoutingEvent(root, {
    event_type: "runtime_attestation",
    session_id: input.session_id,
    agent_id: input.agent_id,
    seat_id: receipt.seat_id,
    requested_model: receipt.requested_model,
    requested_reasoning_raw: receipt.requested_reasoning_raw,
    actual_model: receipt.actual_model,
    actual_reasoning_raw: receipt.actual_reasoning_raw,
    model_attestation: receipt.model_attestation,
    reasoning_attestation: receipt.reasoning_attestation,
    output_admissible: receipt.output_admissible,
    status: receipt.status
  });
  if (!receipt.output_admissible) return startContext(`${receipt.reason}. Stop work; this seat is rejected and must be closed.`);
  return startContext(`Runtime model ${receipt.actual_model} accepted for seat ${receipt.seat_id}. Reasoning attestation: ${receipt.reasoning_attestation}.`);
}

function onSubagentStop(root, input) {
  if (!cleanString(input.session_id) || !cleanString(input.agent_id)) {
    const reason = "Subagent stopped without correlatable model-routing evidence; output is inadmissible";
    return { continue: false, stopReason: reason, systemMessage: reason };
  }
  const receipt = readJson(pathsFor(root, input.session_id).receipt(input.agent_id));
  if (!receipt?.output_admissible) {
    const reason = `Subagent output is inadmissible (${receipt?.status || "missing_receipt"}); do not synthesize or integrate it`;
    return { continue: false, stopReason: reason, systemMessage: reason };
  }
  appendRoutingEvent(root, {
    event_type: "seat_stopped",
    session_id: input.session_id,
    agent_id: input.agent_id,
    seat_id: receipt.seat_id,
    requested_model: receipt.requested_model,
    requested_reasoning_raw: receipt.requested_reasoning_raw,
    actual_model: receipt.actual_model,
    actual_reasoning_raw: receipt.actual_reasoning_raw,
    status: "completed"
  });
  return {};
}

export function processHook(input, options = {}) {
  const root = stateRoot(options.stateRoot);
  ensurePrivateDirectory(root);
  const event = input?.hook_event_name;
  if (event === "PreToolUse") {
    if (isClose(input.tool_name)) return allow("close_agent is permitted for rejected-seat cleanup.");
    if (isWait(input.tool_name)) return preWait(root, input);
    if (isSpawn(input.tool_name)) return preSpawn(root, input);
    return {};
  }
  if (event === "PostToolUse" && isSpawn(input.tool_name)) return postSpawn(root, input);
  if (event === "SubagentStart") return onSubagentStart(root, input);
  if (event === "SubagentStop") return onSubagentStop(root, input);
  return {};
}

export function readAgentReceipt(root, sessionId, agentId) {
  return readJson(pathsFor(path.resolve(root), sessionId).receipt(agentId));
}

export function receiptPathForAgent(root, sessionId, agentId) {
  return pathsFor(path.resolve(root), sessionId).receipt(agentId);
}

export function routingEventLogPath(root) {
  return routingEventLog(path.resolve(root));
}

function main() {
  if (process.argv[2] !== "hook") {
    process.stderr.write("Usage: model-routing-gate.mjs hook\n");
    process.exitCode = 64;
    return;
  }
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    raw += chunk;
  });
  process.stdin.on("end", () => {
    try {
      const output = processHook(JSON.parse(raw));
      process.stdout.write(`${JSON.stringify(output)}\n`);
    } catch (error) {
      process.stderr.write(`Model Routing Gate failed closed: ${error.message}\n`);
      process.exitCode = 2;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
