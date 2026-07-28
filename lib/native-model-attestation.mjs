import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENVELOPE_MARKER = "MODEL_ROUTING_GATE_V1";
const ENVELOPE_PREFIX = `${ENVELOPE_MARKER} `;
const QUARANTINE_MARKER = "MODEL_ROUTING_GATE_QUARANTINE_V1";
const READY_MARKER = "READY_FOR_NATIVE_ATTESTATION";
const QUARANTINE_INSTRUCTION =
  `Reply with exactly ${READY_MARKER}. Do not run tools or accept delegated work until a later admitted turn.`;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_TASK_NAME_PATTERN = /^\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/u;
const JSONL_READ_CHUNK_BYTES = 1024 * 1024;
const MAX_JSONL_RECORD_BYTES = 64 * 1024 * 1024;
const MAX_SESSION_META_BYTES = 1024 * 1024;
const PARENT_RECORD_PREFIX_BYTES = 256 * 1024;
const MAX_SESSION_DIRECTORY_DEPTH = 16;
const MAX_VISITED_SESSION_DIRECTORIES = 1024;
const MAX_VISITED_SESSION_FILES = 8192;
const MAX_IDENTITY_MATCHES = 2;
const SAFE_POST_COMPLETION_EVENT_TYPES = new Set(["token_count"]);

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function receiptHash(receipt) {
  return sha256(JSON.stringify(stable(receipt)));
}

function assertId(value, name) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error(`${name} must be an exact runtime task or agent ID`);
  }
}

function resolveAgentSelector({ agentId, agentTaskName, taskName }) {
  const namedSelectors = [agentTaskName, taskName].filter((value) => value !== undefined);
  if (namedSelectors.length > 1 || (agentId !== undefined && namedSelectors.length > 0)) {
    throw new Error("Provide exactly one of agentId, agentTaskName, or taskName");
  }
  const value = namedSelectors[0] ?? agentId;
  if (typeof value !== "string") {
    throw new Error("agentId or canonical collaboration task name must be explicit");
  }
  if (ID_PATTERN.test(value)) return { kind: "id", agentId: value };
  if (!CANONICAL_TASK_NAME_PATTERN.test(value)) {
    throw new Error("Native attestation task selector must be an exact canonical collaboration task name");
  }
  return { kind: "task_name", taskName: value };
}

function *sessionFiles(root) {
  const absoluteRoot = fs.realpathSync(root);
  const pending = [{ directory: absoluteRoot, depth: 0 }];
  let visitedDirectories = 0;
  let visitedFiles = 0;
  while (pending.length > 0) {
    const { directory, depth } = pending.pop();
    visitedDirectories += 1;
    if (visitedDirectories > MAX_VISITED_SESSION_DIRECTORIES) {
      throw new Error(
        `Session discovery exceeds ${MAX_VISITED_SESSION_DIRECTORIES} visited directories`
      );
    }
    const handle = fs.opendirSync(directory);
    try {
      let entry;
      while ((entry = handle.readSync()) !== null) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (depth < MAX_SESSION_DIRECTORY_DEPTH) pending.push({ directory: target, depth: depth + 1 });
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          visitedFiles += 1;
          if (visitedFiles > MAX_VISITED_SESSION_FILES) {
            throw new Error(`Session discovery exceeds ${MAX_VISITED_SESSION_FILES} visited JSONL files`);
          }
          yield target;
        }
      }
    } finally {
      handle.closeSync();
    }
  }
}

function findSessionFile(root, id) {
  const matches = [];
  for (const file of sessionFiles(root)) {
    if (!path.basename(file).includes(id)) continue;
    matches.push(file);
    if (matches.length >= MAX_IDENTITY_MATCHES) break;
  }
  if (matches.length !== 1) {
    throw new Error(`Expected one session transcript for ${id}; found ${matches.length}`);
  }
  return matches[0];
}

function readFirstSessionMeta(file) {
  const descriptor = fs.openSync(file, "r");
  const chunk = Buffer.allocUnsafe(JSONL_READ_CHUNK_BYTES);
  const fragments = [];
  let bytes = 0;
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null)) > 0) {
      const current = chunk.subarray(0, bytesRead);
      const newline = current.indexOf(10);
      const fragment = newline === -1 ? current : current.subarray(0, newline);
      bytes += fragment.length;
      if (bytes > MAX_SESSION_META_BYTES) {
        throw new Error(`Session metadata exceeds ${MAX_SESSION_META_BYTES} bytes at ${file}:1`);
      }
      fragments.push(Buffer.from(fragment));
      if (newline !== -1) break;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  if (bytes === 0) return null;
  let line = Buffer.concat(fragments, bytes);
  if (line[line.length - 1] === 13) line = line.subarray(0, line.length - 1);
  try {
    const value = JSON.parse(line.toString("utf8"));
    return value?.type === "session_meta" ? value.payload : null;
  } catch {
    throw new Error(`Invalid JSONL at ${file}:1`);
  }
}

function readJsonl(file, {
  shouldParseLine = () => true,
  selectRecord = () => true,
  onRecord = () => {},
  maxRecordBytes = MAX_JSONL_RECORD_BYTES
} = {}) {
  const descriptor = fs.openSync(file, "r");
  const digest = crypto.createHash("sha256");
  const chunk = Buffer.allocUnsafe(JSONL_READ_CHUNK_BYTES);
  const records = [];
  let fragments = [];
  let pendingBytes = 0;
  let totalBytes = 0;
  let lineNumber = 0;
  let maxRecordBytesObserved = 0;

  const addFragment = (value) => {
    if (value.length === 0) return;
    pendingBytes += value.length;
    if (pendingBytes > maxRecordBytes) {
      throw new Error(`JSONL record exceeds ${maxRecordBytes} bytes at ${file}:${lineNumber + 1}`);
    }
    fragments.push(Buffer.from(value));
  };

  const completeLine = (tail) => {
    const recordBytes = pendingBytes + tail.length;
    lineNumber += 1;
    maxRecordBytesObserved = Math.max(maxRecordBytesObserved, recordBytes);
    if (recordBytes > maxRecordBytes) {
      throw new Error(`JSONL record exceeds ${maxRecordBytes} bytes at ${file}:${lineNumber}`);
    }
    let lineBytes;
    if (fragments.length === 0) {
      lineBytes = tail;
    } else {
      if (tail.length > 0) fragments.push(Buffer.from(tail));
      lineBytes = Buffer.concat(fragments, recordBytes);
    }
    fragments = [];
    pendingBytes = 0;
    if (lineBytes.length === 0) return;
    if (lineBytes[lineBytes.length - 1] === 13) lineBytes = lineBytes.subarray(0, lineBytes.length - 1);
    if (lineBytes.length === 0 || !shouldParseLine(lineBytes)) return;
    const text = lineBytes.toString("utf8");
    if (!text.trim()) return;
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSONL at ${file}:${lineNumber}`);
    }
    const record = { line: lineNumber, value };
    onRecord(record);
    if (selectRecord(value)) records.push(record);
  };

  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null)) > 0) {
      const current = chunk.subarray(0, bytesRead);
      digest.update(current);
      totalBytes += bytesRead;
      let start = 0;
      let newline;
      while ((newline = current.indexOf(10, start)) !== -1) {
        completeLine(current.subarray(start, newline));
        start = newline + 1;
      }
      addFragment(current.subarray(start));
    }
    if (pendingBytes > 0) completeLine(Buffer.alloc(0));
  } finally {
    fs.closeSync(descriptor);
  }
  return {
    bytes: totalBytes,
    digest: `sha256:${digest.digest("hex")}`,
    maxRecordBytes: maxRecordBytesObserved,
    records
  };
}

function isPotentialParentBindingLine(lineBytes) {
  const prefix = lineBytes.subarray(0, PARENT_RECORD_PREFIX_BYTES).toString("utf8");
  return /"type"\s*:\s*"(?:function_call(?:_output)?|custom_tool_call(?:_output)?)"/u.test(prefix);
}

function isParentBindingRecord(value) {
  if (value?.type !== "response_item") return false;
  return [
    "function_call",
    "function_call_output",
    "custom_tool_call",
    "custom_tool_call_output"
  ].includes(value.payload?.type);
}

function parseJson(value, label) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") throw new Error(`${label} is not JSON`);
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function parseJsonOrNull(value) {
  try {
    return parseJson(value, "spawn result");
  } catch {
    return null;
  }
}

function findAgentIds(value, found = new Set()) {
  if (!value) return found;
  if (Array.isArray(value)) {
    for (const item of value) findAgentIds(item, found);
    return found;
  }
  if (typeof value === "object") {
    if (typeof value.agent_id === "string") found.add(value.agent_id);
    for (const item of Object.values(value)) findAgentIds(item, found);
  }
  return found;
}

function isSpawn(name) {
  return typeof name === "string" && /(^|[._:])spawn_agent$/u.test(name);
}

function parentRecords(records) {
  const calls = new Map();
  const outputs = [];
  const wrapperCalls = new Map();
  const wrapperOutputs = [];
  for (const record of records) {
    if (record.value?.type !== "response_item") continue;
    const payload = record.value.payload;
    if (payload?.type === "function_call" && payload.call_id) calls.set(payload.call_id, record);
    if (payload?.type === "function_call_output" && payload.call_id) outputs.push(record);
    if (payload?.type === "custom_tool_call" && payload.call_id) wrapperCalls.set(payload.call_id, record);
    if (payload?.type === "custom_tool_call_output" && payload.call_id) wrapperOutputs.push(record);
  }
  return { calls, outputs, wrapperCalls, wrapperOutputs };
}

function directSpawnRecords(records) {
  const { calls, outputs } = parentRecords(records);
  return outputs.flatMap((output) => {
    const call = calls.get(output.value.payload.call_id);
    if (!call || !isSpawn(call.value.payload.name)) return [];
    return [{
      call,
      output
    }];
  });
}

function wrappedSpawnError(records, selector) {
  const { wrapperCalls, wrapperOutputs } = parentRecords(records);
  const wrappedBindings = wrapperOutputs.flatMap((output) => {
    const call = wrapperCalls.get(output.value.payload.call_id);
    if (!call) return [];
    const result = parseJsonOrNull(output.value.payload.output);
    const matches = selector.kind === "id"
      ? findAgentIds(result).has(selector.agentId)
      : result?.task_name === selector.taskName;
    return matches ? [{ call, output }] : [];
  });
  if (wrappedBindings.length > 0) {
    const error = new Error(
      "Native attestation requires one direct spawn_agent tool call per seat; wrapped or batched spawning is not attestable"
    );
    error.nextAction = "close_seat_and_prepare_attempt_2_with_direct_spawn_agent";
    throw error;
  }
}

function validateEnvelope(envelope) {
  const allowed = new Set(["schema_version", "seat_id", "model_critical", "reasoning_critical", "attempt"]);
  const unknown = Object.keys(envelope).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown Model Routing Gate envelope field: ${unknown.join(", ")}`);
  if (envelope.schema_version !== 1) throw new Error("Unsupported Model Routing Gate envelope version");
  if (typeof envelope.seat_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(envelope.seat_id)) {
    throw new Error("seat_id must be a stable 1-64 character identifier");
  }
  if (envelope.model_critical !== true) throw new Error("Native attestation is only for model-critical seats");
  if (typeof envelope.reasoning_critical !== "boolean") throw new Error("reasoning_critical must be explicit");
  if (envelope.attempt !== 1 && envelope.attempt !== 2) throw new Error("attempt must be 1 or 2");
  return envelope;
}

function parseEnvelope(message) {
  if (typeof message !== "string") throw new Error("Native quarantine message must be a string");
  const [firstLine, ...remaining] = message.split(/\r?\n/u);
  if (firstLine === ENVELOPE_MARKER) {
    throw new Error(
      "MODEL_ROUTING_GATE_V1 JSON must be on the same first line; use seat inspect native_quarantine.spawn_request verbatim"
    );
  }
  if (!firstLine.startsWith(ENVELOPE_PREFIX)) throw new Error("Missing MODEL_ROUTING_GATE_V1 envelope");
  if (remaining.join("\n").trim() !== `${QUARANTINE_MARKER}\n${QUARANTINE_INSTRUCTION}`) {
    throw new Error(
      `Native launch must contain only the envelope, ${QUARANTINE_MARKER}, and the canonical ready instruction`
    );
  }
  return validateEnvelope(parseJson(firstLine.slice(ENVELOPE_PREFIX.length), "Model Routing Gate envelope"));
}

export function buildNativeQuarantineLaunch({
  seatId,
  model,
  reasoning,
  attempt = 1,
  reasoningCritical = false
}) {
  if (typeof model !== "string" || !model) throw new Error("Native quarantine model must be explicit");
  if (typeof reasoning !== "string" || !reasoning) throw new Error("Native quarantine reasoning must be explicit");
  const normalizedAttempt = Number(attempt);
  const envelope = validateEnvelope({
    schema_version: 1,
    seat_id: seatId,
    model_critical: true,
    reasoning_critical: reasoningCritical,
    attempt: normalizedAttempt
  });
  return {
    schema_version: 1,
    contract: "native_read_only_model_quarantine",
    attempt: normalizedAttempt,
    spawn_request: {
      fork_context: false,
      message: `${ENVELOPE_PREFIX}${JSON.stringify(envelope)}\n${QUARANTINE_MARKER}\n${QUARANTINE_INSTRUCTION}`,
      model,
      reasoning_effort: reasoning
    },
    expected_initial_response: READY_MARKER,
    next_action: "wait_for_exact_initial_response_then_attest_before_sending_assignment_or_child_preflight",
    transport_contract: {
      required_tool: "spawn_agent",
      direct_tool_call_only: true,
      one_seat_per_call: true,
      wrappers_and_batches_forbidden: true
    },
    pass_spawn_request_verbatim: true
  };
}

function resolveParentTaskName(records, taskName) {
  const requestedTaskName = taskName.slice(taskName.lastIndexOf("/") + 1);
  const bindings = [];
  for (const binding of directSpawnRecords(records)) {
    const args = parseJsonOrNull(binding.call.value.payload.arguments);
    if (args?.task_name !== requestedTaskName) continue;
    const result = parseJsonOrNull(binding.output.value.payload.output);
    if (Array.isArray(result)) {
      const error = new Error("Native attestation requires one direct spawn_agent tool call per seat; batched spawning is not attestable");
      error.nextAction = "close_seat_and_prepare_attempt_2_with_direct_spawn_agent";
      throw error;
    }
    if (result?.task_name !== taskName) continue;
    if (Object.keys(result).length !== 1) {
      const error = new Error("Native canonical task-name resolution requires a direct spawn output containing only task_name");
      error.nextAction = "close_seat_and_prepare_attempt_2_with_direct_spawn_agent";
      throw error;
    }
    bindings.push({ ...binding, args });
  }
  if (bindings.length === 0) wrappedSpawnError(records, { kind: "task_name", taskName });
  if (bindings.length !== 1) {
    throw new Error(
      `Expected one direct parent spawn binding for canonical task ${taskName}; found ${bindings.length}`
    );
  }
  const { call, output, args } = bindings[0];
  return {
    taskName,
    callId: call.value.payload.call_id,
    args,
    callLine: call.line,
    outputLine: output.line
  };
}

function resolveParent(records, agentId) {
  const bindings = [];
  for (const binding of directSpawnRecords(records)) {
    const result = parseJsonOrNull(binding.output.value.payload.output);
    const ids = [...findAgentIds(result)];
    if (!ids.includes(agentId)) continue;
    if (ids.length !== 1) {
      const error = new Error("Native attestation requires one direct spawn_agent tool call per seat; batched spawning is not attestable");
      error.nextAction = "close_seat_and_prepare_attempt_2_with_direct_spawn_agent";
      throw error;
    }
    const args = parseJson(binding.call.value.payload.arguments, "spawn_agent arguments");
    bindings.push({ ...binding, args });
  }
  if (bindings.length === 0) wrappedSpawnError(records, { kind: "id", agentId });
  if (bindings.length !== 1) throw new Error(`Expected one parent spawn binding for agent ${agentId}; found ${bindings.length}`);
  const { call, output, args } = bindings[0];
  return {
    callId: call.value.payload.call_id,
    args,
    callLine: call.line,
    outputLine: output.line
  };
}

function authoritativeAgentPath(meta) {
  const sourcePath = meta?.source?.subagent?.thread_spawn?.agent_path;
  if (typeof meta?.agent_path !== "string" || typeof sourcePath !== "string" || meta.agent_path !== sourcePath) {
    throw new Error("Child session lacks matching authoritative agent_path and source.subagent.thread_spawn.agent_path");
  }
  if (!CANONICAL_TASK_NAME_PATTERN.test(meta.agent_path)) {
    throw new Error("Child session authoritative agent_path is not canonical");
  }
  return meta.agent_path;
}

function findCanonicalChildSession(root, parentThreadId, taskName) {
  const matches = [];
  for (const file of sessionFiles(root)) {
    const meta = readFirstSessionMeta(file);
    if (meta?.parent_thread_id !== parentThreadId) continue;
    let agentPath;
    try {
      agentPath = authoritativeAgentPath(meta);
    } catch {
      continue;
    }
    if (agentPath !== taskName) continue;
    assertId(meta.id, "Child session id");
    matches.push({ file, agentId: meta.id });
    if (matches.length >= MAX_IDENTITY_MATCHES) break;
  }
  if (matches.length !== 1) {
    throw new Error(`Expected one child session for canonical task ${taskName}; found ${matches.length}`);
  }
  return matches[0];
}

function contentText(content) {
  if (
    !Array.isArray(content) ||
    content.length === 0 ||
    content.some((item) => !item || typeof item !== "object" || typeof item.text !== "string")
  ) {
    return null;
  }
  const text = content.map((item) => item.text).join("");
  return text || null;
}

function childFailure(reason, nextAction = "close_seat") {
  return { reason, nextAction };
}

function scanChildTranscript(file, {
  parentThreadId,
  agentId,
  expectedTaskName,
  expectedMessage
}) {
  let matchingMeta = null;
  let matchingMetaCount = 0;
  let pendingContext = null;
  let launchContext = null;
  let launchLine = null;
  let launchCount = 0;
  let completionLine = null;
  let responseLine = null;
  let responseCount = 0;
  let violation = null;

  const reject = (reason, nextAction = "close_seat_and_prepare_attempt_2") => {
    violation ??= childFailure(reason, nextAction);
  };

  const transcript = readJsonl(file, {
    selectRecord: () => false,
    onRecord(record) {
      const { value, line } = record;
      if (value?.type === "session_meta" && value.payload?.id === agentId) {
        matchingMetaCount += 1;
        matchingMeta ??= record;
        return;
      }

      if (value?.type === "turn_context") {
        if (completionLine !== null) {
          reject("Native quarantine transcript contains a new turn after the completed handshake");
        } else if (launchLine !== null) {
          reject("Native quarantine transcript contains a new turn before handshake completion");
        } else {
          pendingContext = record;
        }
        return;
      }

      if (value?.type === "response_item") {
        const payload = value.payload;
        const exactLaunch = payload?.type === "message" &&
          payload.role === "user" &&
          contentText(payload.content) === expectedMessage;
        if (exactLaunch) {
          launchCount += 1;
          if (launchLine !== null) {
            reject("Child transcript contains multiple exact native quarantine launch messages");
          } else {
            launchLine = line;
            launchContext = pendingContext;
          }
          return;
        }
        if (launchLine === null) return;
        if (completionLine !== null) {
          reject("Native quarantine transcript contains response activity after the completed handshake");
          return;
        }
        if (payload?.type === "reasoning") return;
        if (payload?.type === "message" && payload.role === "assistant") {
          responseCount += 1;
          if (contentText(payload.content) === READY_MARKER && responseLine === null) {
            responseLine = line;
          } else {
            reject(`Native quarantine response mismatch; expected exact ${READY_MARKER} before admission`);
          }
          return;
        }
        reject(
          `Native quarantine child emitted disallowed or unknown response_item type ${JSON.stringify(payload?.type ?? null)} before admission`
        );
        return;
      }

      if (value?.type !== "event_msg") return;
      const eventType = value.payload?.type;
      if (eventType === "task_complete") {
        if (launchLine === null) {
          pendingContext = null;
        } else if (completionLine === null) {
          completionLine = line;
        } else {
          reject("Native quarantine transcript contains additional task completion after the completed handshake");
        }
        return;
      }
      if (completionLine !== null && !SAFE_POST_COMPLETION_EVENT_TYPES.has(eventType)) {
        reject(`Native quarantine transcript contains post-completion event ${JSON.stringify(eventType)}`);
      }
    }
  });

  if (matchingMetaCount !== 1) {
    return {
      transcript,
      failure: childFailure(`Expected one child session_meta for ${agentId}; found ${matchingMetaCount}`)
    };
  }
  if (matchingMeta.value.payload.parent_thread_id !== parentThreadId) {
    return {
      transcript,
      failure: childFailure("Child session parent_thread_id does not match the requested parent task")
    };
  }
  let agentPath;
  if (expectedTaskName !== undefined) {
    try {
      agentPath = authoritativeAgentPath(matchingMeta.value.payload);
    } catch (error) {
      return { transcript, failure: childFailure(error.message) };
    }
    if (agentPath !== expectedTaskName) {
      return {
        transcript,
        failure: childFailure(
          "Child session authoritative agent_path does not match the requested canonical collaboration task name"
        )
      };
    }
  }
  if (launchCount !== 1 || launchLine === null) {
    return {
      transcript,
      failure: childFailure(
        launchCount === 0
          ? "Child transcript lacks the exact native quarantine launch message"
          : `Child transcript contains ${launchCount} exact native quarantine launch messages`
      )
    };
  }
  if (!launchContext || launchContext.line <= matchingMeta.line || launchContext.line >= launchLine) {
    return {
      transcript,
      failure: childFailure("Child transcript lacks authoritative launch-turn context metadata")
    };
  }
  const contextPayload = launchContext.value.payload;
  if (typeof contextPayload?.model !== "string" || !contextPayload.model) {
    return {
      transcript,
      failure: childFailure("Child transcript lacks authoritative turn_context model metadata")
    };
  }
  const reasoning = contextPayload.collaboration_mode?.settings?.reasoning_effort;
  if (typeof reasoning !== "string" || !reasoning) {
    return {
      transcript,
      failure: childFailure("Child transcript lacks authoritative turn_context reasoning metadata")
    };
  }
  const actual = {
    model: contextPayload.model,
    reasoning,
    metaLine: matchingMeta.line,
    contextLine: launchContext.line,
    taskName: agentPath
  };
  if (violation) return { transcript, actual, failure: violation };
  if (completionLine === null) {
    return {
      transcript,
      failure: childFailure(
        `Native quarantine handshake is incomplete; wait for exact ${READY_MARKER} completion, then retry attestation`,
        "wait_for_quarantine_completion_then_retry_attestation"
      )
    };
  }
  if (responseCount !== 1 || responseLine === null) {
    return {
      transcript,
      failure: childFailure(
        `Native quarantine response mismatch; expected exact ${READY_MARKER} before admission`,
        "close_seat_and_prepare_attempt_2"
      )
    };
  }
  return {
    transcript,
    actual,
    handshake: {
      launchLine,
      responseLine,
      completionLine
    }
  };
}

function rejectedReceipt(base, reason, nextAction = "close_seat") {
  const receipt = {
    ...base,
    status: "rejected",
    output_admissible: false,
    reason,
    next_action: nextAction
  };
  return { ...receipt, receipt_sha256: receiptHash(receipt) };
}

export function attestNativeSubagent({
  parentThreadId,
  agentId,
  agentTaskName,
  taskName,
  sessionRoot = path.join(os.homedir(), ".codex", "sessions")
}) {
  assertId(parentThreadId, "parentThreadId");
  const selector = resolveAgentSelector({ agentId, agentTaskName, taskName });
  const parentFile = findSessionFile(sessionRoot, parentThreadId);
  const parent = readJsonl(parentFile, {
    shouldParseLine: isPotentialParentBindingLine,
    selectRecord: isParentBindingRecord
  });
  const parentBase = {
    schema_version: 1,
    receipt_type: "native_model_routing_attestation",
    attestation_mode: "native_transcript_binding",
    native_scope: "read_only_quarantine_only",
    parent_thread_id: parentThreadId,
    evidence: {
      parent_transcript: {
        path: parentFile,
        digest: parent.digest,
        bytes: parent.bytes,
        max_record_bytes: parent.maxRecordBytes
      }
    }
  };

  let binding;
  let childFile;
  try {
    if (selector.kind === "id") {
      binding = { ...resolveParent(parent.records, selector.agentId), agentId: selector.agentId };
      childFile = findSessionFile(sessionRoot, selector.agentId);
    } else {
      binding = resolveParentTaskName(parent.records, selector.taskName);
      const childSession = findCanonicalChildSession(sessionRoot, parentThreadId, selector.taskName);
      childFile = childSession.file;
      binding = { ...binding, agentId: childSession.agentId };
    }
  } catch (error) {
    return rejectedReceipt({
      ...parentBase,
      ...(selector.kind === "id" ? { agent_id: selector.agentId } : { requested_task_name: selector.taskName })
    }, error.message, error.nextAction);
  }

  const base = {
    ...parentBase,
    agent_id: binding.agentId,
    ...(binding.taskName ? { requested_task_name: binding.taskName } : {})
  };

  const withBinding = {
    ...base,
    tool_call_id: binding.callId,
    evidence: {
      ...base.evidence,
      parent_call_line: binding.callLine,
      parent_output_line: binding.outputLine
    }
  };

  let envelope;
  try {
    envelope = parseEnvelope(binding.args.message);
  } catch (error) {
    return rejectedReceipt(withBinding, error.message);
  }
  if (binding.args.fork_context !== false) {
    return rejectedReceipt(withBinding, "Native quarantine launch requires fork_context:false");
  }
  if (typeof binding.args.model !== "string" || !binding.args.model) {
    return rejectedReceipt(withBinding, "spawn_agent model must be explicit");
  }
  if (typeof binding.args.reasoning_effort !== "string" || !binding.args.reasoning_effort) {
    return rejectedReceipt(withBinding, "spawn_agent reasoning_effort must be explicit");
  }

  let childScan;
  try {
    childScan = scanChildTranscript(childFile, {
      parentThreadId,
      agentId: binding.agentId,
      expectedTaskName: binding.taskName,
      expectedMessage: binding.args.message
    });
  } catch (error) {
    return rejectedReceipt({
      ...withBinding,
      seat_id: envelope.seat_id,
      attempt: envelope.attempt,
      model_critical: envelope.model_critical,
      reasoning_critical: envelope.reasoning_critical,
      requested_model: binding.args.model,
      requested_reasoning_raw: binding.args.reasoning_effort
    }, error.message, error.nextAction);
  }

  const withChild = {
    ...withBinding,
    evidence: {
      ...withBinding.evidence,
      child_transcript: {
        path: childFile,
        digest: childScan.transcript.digest,
        bytes: childScan.transcript.bytes,
        max_record_bytes: childScan.transcript.maxRecordBytes
      }
    }
  };
  const assignmentEvidence = {
    ...withChild,
    seat_id: envelope.seat_id,
    attempt: envelope.attempt,
    model_critical: envelope.model_critical,
    reasoning_critical: envelope.reasoning_critical,
    requested_model: binding.args.model,
    requested_reasoning_raw: binding.args.reasoning_effort,
    ...(childScan.actual ? {
      actual_model: childScan.actual.model,
      actual_reasoning_raw: childScan.actual.reasoning,
      evidence: {
        ...withChild.evidence,
        child_session_meta_line: childScan.actual.metaLine,
        child_turn_context_line: childScan.actual.contextLine
      }
    } : {})
  };
  if (childScan.failure) {
    return rejectedReceipt({
      ...assignmentEvidence
    }, childScan.failure.reason, childScan.failure.nextAction);
  }
  const actual = childScan.actual;
  const handshake = childScan.handshake;

  const modelAttestation = actual.model === binding.args.model ? "verified" : "mismatch";
  const reasoningAttestation = actual.reasoning === binding.args.reasoning_effort ? "verified" : "mismatch";
  const outputAdmissible = modelAttestation === "verified" && reasoningAttestation === "verified";
  const receipt = {
    ...withChild,
    seat_id: envelope.seat_id,
    attempt: envelope.attempt,
    model_critical: envelope.model_critical,
    reasoning_critical: envelope.reasoning_critical,
    requested_model: binding.args.model,
    actual_model: actual.model,
    model_attestation: modelAttestation,
    requested_reasoning_raw: binding.args.reasoning_effort,
    actual_reasoning_raw: actual.reasoning,
    reasoning_attestation: reasoningAttestation,
    evidence: {
      ...withChild.evidence,
      child_session_meta_line: actual.metaLine,
      child_turn_context_line: actual.contextLine,
      child_quarantine_launch_line: handshake.launchLine,
      child_quarantine_response_line: handshake.responseLine,
      child_quarantine_completion_line: handshake.completionLine
    },
    status: outputAdmissible ? "accepted" : "rejected",
    output_admissible: outputAdmissible,
    quarantine_handshake: "verified",
    next_action: outputAdmissible ? "send_exact_admitted_assignment_as_a_new_turn" : "close_seat",
    reason: outputAdmissible
      ? "Requested assignment and completed quarantine handshake match authoritative child session metadata"
      : "Requested and actual native subagent assignment differ"
  };
  return { ...receipt, receipt_sha256: receiptHash(receipt) };
}

export const NATIVE_QUARANTINE_MARKER = QUARANTINE_MARKER;
