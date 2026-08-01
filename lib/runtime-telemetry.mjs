import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  engineeringLedgerPath,
  normalizeEngineeringEvent,
  readEngineeringEvents,
  recordEngineeringEvent,
  recordEngineeringEventBestEffort
} from "./engineering-metrics.mjs";

const MAX_LINE_BYTES = 256 * 1024;
const MAX_SESSION_FILES = 8_192;
const MAX_SESSION_DIRECTORIES = 1_024;
const TOKEN_FIELDS = Object.freeze([
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "reasoning_output_tokens",
  "total_tokens"
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SESSION_META_LINE = /"type"\s*:\s*"session_meta"/;
const EVENT_MESSAGE_LINE = /"type"\s*:\s*"event_msg"/;
const TOKEN_COUNT_LINE = /"type"\s*:\s*"token_count"/;
const SUBAGENT_ACTIVITY_LINE = /"type"\s*:\s*"sub_agent_activity"/;
const TASK_COMPLETE_LINE = /"type"\s*:\s*"task_complete"/;

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function isoTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function boundedIdentifier(value) {
  return typeof value === "string" && IDENTIFIER.test(value) ? value : undefined;
}

function tokenUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const selected = {};
  for (const key of TOKEN_FIELDS) {
    const current = value[key];
    if (typeof current === "number" && Number.isSafeInteger(current) && current >= 0) {
      selected[key] = current;
    }
  }
  return Object.keys(selected).length > 0 ? selected : null;
}

function primaryQuota(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const selected = {};
  if (typeof value.used_percent === "number" && Number.isFinite(value.used_percent) &&
      value.used_percent >= 0 && value.used_percent <= 100) {
    selected.used_percent = value.used_percent;
  }
  if (typeof value.window_minutes === "number" && Number.isFinite(value.window_minutes) &&
      value.window_minutes >= 0) {
    selected.window_minutes = value.window_minutes;
  }
  const resetAt = isoTimestamp(value.reset_at ?? value.reset_timestamp);
  if (resetAt) selected.reset_at = resetAt;
  const resetEpoch = value.reset_epoch_seconds ?? value.reset_epoch;
  if (typeof resetEpoch === "number" && Number.isSafeInteger(resetEpoch) && resetEpoch >= 0) {
    selected.reset_epoch_seconds = resetEpoch;
  }
  return Object.keys(selected).length > 0 ? selected : null;
}

function parentLineage(payload) {
  const directParent = boundedIdentifier(payload?.parent_thread_id);
  if (directParent) return directParent;
  const nested = payload?.source?.subagent?.thread_spawn?.parent_thread_id;
  return boundedIdentifier(nested);
}

function explicitlySubagentSession(payload) {
  // A `thread_source: "subagent"` label alone is not parentage: root sessions
  // can carry it. A bounded direct or nested parent correlation is the
  // authoritative worker discriminator; host variants need no second marker.
  return Boolean(parentLineage(payload));
}

function matchingSessionMeta(parsed, projectPath, thread) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.type !== "session_meta") return null;
  const payload = parsed.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const taskIds = [payload.parent_thread_id, payload.thread_id, payload.task_id, payload.session_id]
    .map(boundedIdentifier)
    .filter(Boolean);
  const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
  const pathMatches = projectPath !== undefined && cwd !== undefined && cwdWithinRoot(cwd, projectPath);
  const threadMatches = thread !== undefined && taskIds.includes(thread);
  if (!pathMatches && !threadMatches) return { matched: false };
  const taskId = threadMatches ? thread : taskIds[0];
  // Project-root binding alone is insufficient to create a ledger fact: every
  // imported record must also have a bounded private task/thread correlation.
  if (!taskId) return { matched: false, unlinked: true };
  const isSubagent = explicitlySubagentSession(payload);
  return {
    matched: true,
    task_id: taskId,
    occurred_at: isoTimestamp(payload.timestamp ?? parsed.timestamp),
    session_ref: typeof payload.id === "string" && payload.id.length > 0
      ? digest(payload.id)
      : undefined,
    // In observed child sessions `id` is the child UUID, while session_id and
    // parent_thread_id identify the parent task. Keep task attribution on the
    // parent but use the child UUID to pair parent lifecycle activity.
    runtime_session_id: isSubagent
      ? boundedIdentifier(payload.id)
      : boundedIdentifier(payload.session_id ?? payload.thread_id ?? payload.task_id),
    is_subagent: isSubagent
  };
}

function lifecycleRecord(parsed, session) {
  if (!session?.matched || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.type !== "event_msg" || !parsed.payload || typeof parsed.payload !== "object") return null;
  const payload = parsed.payload;
  if (payload.type === "sub_agent_activity") {
    const runtimeSessionId = boundedIdentifier(payload.agent_thread_id);
    if (!runtimeSessionId || !["started", "completed", "interrupted"].includes(payload.kind)) return null;
    const occurredAt = typeof payload.occurred_at_ms === "number" && Number.isSafeInteger(payload.occurred_at_ms) && payload.occurred_at_ms >= 0
      ? new Date(payload.occurred_at_ms).toISOString()
      : isoTimestamp(parsed.timestamp);
    if (!occurredAt) return null;
    return {
      task_id: session.task_id,
      runtime_session_id: runtimeSessionId,
      kind: payload.kind,
      occurred_at: occurredAt,
      coverage_status: "complete"
    };
  }
  // `task_complete` is an observation in a child transcript, not transcript
  // EOF. Its record timestamp may be the first time completion was observed,
  // so it is deliberately partial unless the runtime gave a completion time.
  if (payload.type === "task_complete" && session.is_subagent && session.runtime_session_id) {
    const completedAt = isoTimestamp(payload.completed_at);
    const observedAt = isoTimestamp(parsed.timestamp);
    if (!completedAt && !observedAt) return null;
    return {
      task_id: session.task_id,
      runtime_session_id: session.runtime_session_id,
      kind: "completed",
      occurred_at: completedAt ?? observedAt,
      coverage_status: completedAt ? "complete" : "partial"
    };
  }
  return null;
}

function tokenRecord(parsed, session) {
  if (!session?.matched || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.type !== "event_msg" || parsed.payload?.type !== "token_count") return null;
  const info = parsed.payload?.info;
  if (!info || typeof info !== "object" || Array.isArray(info)) return null;
  // `last_token_usage` is a per-turn delta. Deliberately never read
  // `total_token_usage`, which is a cumulative snapshot and would double count.
  const usage = tokenUsage(info.last_token_usage);
  const quota = primaryQuota(
    // Codex runtime token-count records put quota data beside `info`, not in it.
    parsed.payload?.rate_limits?.primary ??
    info.primary_rate_limit ?? info.rate_limits?.primary ?? info.rate_limit?.primary
  );
  return {
    occurred_at: isoTimestamp(parsed.timestamp) ?? session.occurred_at,
    usage,
    quota
  };
}

function cwdWithinRoot(cwd, root) {
  try {
    const relative = path.relative(root, path.resolve(cwd));
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
  } catch {
    return false;
  }
}

function sessionFiles(root) {
  const files = [];
  const pending = [path.resolve(root)];
  let directories = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    directories += 1;
    if (directories > MAX_SESSION_DIRECTORIES) throw new Error("Session discovery directory limit exceeded");
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(target);
        if (files.length > MAX_SESSION_FILES) throw new Error("Session discovery file limit exceeded");
      }
    }
  }
  return files.sort();
}

/**
 * Reads JSONL records without retaining a whole transcript or an unbounded
 * line. Oversized records are reported once and discarded through their
 * newline, so even a long-lived active session cannot force a giant string
 * allocation during ingestion.
 */
async function* boundedJsonLines(file) {
  const lineBuffer = Buffer.allocUnsafe(MAX_LINE_BYTES);
  let lineLength = 0;
  let discardingOversizedLine = false;
  const stream = fs.createReadStream(file, { highWaterMark: 64 * 1024 });

  for await (const chunk of stream) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(0x0A, start);
      const end = newline === -1 ? chunk.length : newline;
      const segmentLength = end - start;

      if (discardingOversizedLine) {
        if (newline !== -1) discardingOversizedLine = false;
      } else if (lineLength + segmentLength > MAX_LINE_BYTES) {
        // Do not copy or stringify the excess bytes. This yield is emitted
        // once per record, then all remaining chunks are skipped to newline.
        yield { oversized: true };
        lineLength = 0;
        discardingOversizedLine = newline === -1;
      } else {
        chunk.copy(lineBuffer, lineLength, start, end);
        lineLength += segmentLength;
        if (newline !== -1) {
          const contentLength = lineLength > 0 && lineBuffer[lineLength - 1] === 0x0D
            ? lineLength - 1
            : lineLength;
          if (contentLength > 0) yield { line: lineBuffer.toString("utf8", 0, contentLength) };
          lineLength = 0;
        }
      }

      if (newline === -1) break;
      start = newline + 1;
    }
  }

  if (!discardingOversizedLine && lineLength > 0) {
    const contentLength = lineBuffer[lineLength - 1] === 0x0D ? lineLength - 1 : lineLength;
    if (contentLength > 0) yield { line: lineBuffer.toString("utf8", 0, contentLength) };
  }
}

function recordId(type, taskId, occurredAt, value, sessionRef) {
  return digest(JSON.stringify([type, taskId, occurredAt, value, sessionRef ?? null]));
}

function executionIdForTask(taskId) {
  // Runtime task identifiers are already bounded opaque correlations. Hashing
  // them again keeps the canonical execution key stable without exposing a
  // transcript, session path, prompt, output, or other free-form content.
  return `execution-${digest(JSON.stringify(["runtime", taskId]))
    .slice("sha256:".length, "sha256:".length + 32)}`;
}

function coverageForUsage(usage) {
  return usage?.total_tokens !== undefined ? "complete" : "partial";
}

function coverageForQuota(quota) {
  return quota?.used_percent !== undefined && quota?.window_minutes !== undefined &&
    (quota?.reset_at !== undefined || quota?.reset_epoch_seconds !== undefined)
    ? "complete"
    : "partial";
}

function opaqueSeatId(session) {
  // Session identifiers are private runtime correlations. Keep only a bounded
  // deterministic digest in the engineering ledger; never project a path or
  // raw runtime/session identifier as a seat identity.
  return `runtime-${digest(JSON.stringify([
    session.session_ref ?? null,
    session.task_id,
    session.occurred_at
  ])).slice("sha256:".length, "sha256:".length + 32)}`;
}

function seatStartIdentity(event) {
  if (event?.type !== "seat.started" || typeof event.project !== "string" ||
      typeof event.task_id !== "string" || typeof event.seat_id !== "string") return null;
  return JSON.stringify([event.project, event.task_id, event.seat_id]);
}

/**
 * Reads a supplied local transcript without changing it. Only verified matching
 * `session_meta` and `event_msg/token_count` records are parsed; the resulting
 * private ledger contains schema-validated task-correlated projections only.
 */
export async function ingestRuntimeTelemetry({
  sessionRoot,
  project,
  ledger,
  projectPath,
  thread,
  now = new Date()
} = {}) {
  if (typeof sessionRoot !== "string" || !sessionRoot) throw new Error("sessionRoot is required");
  if (typeof project !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(project)) {
    throw new Error("project must be a lowercase portable slug");
  }
  const exactProjectPath = projectPath === undefined ? undefined : path.resolve(projectPath);
  const exactThread = thread === undefined ? undefined : boundedIdentifier(thread);
  if (thread !== undefined && !exactThread) throw new Error("thread must be a bounded opaque identifier");
  if (exactProjectPath === undefined && exactThread === undefined) {
    throw new Error("ingest-runtime requires --path <exact project root> and/or --thread <exact task id>");
  }

  const targetLedger = engineeringLedgerPath(ledger);
  const existingEvents = readEngineeringEvents({ ledger: targetLedger }).events;
  const existing = new Set(existingEvents.map((event) => event.event_id));
  const existingSeatStarts = new Set(existingEvents.map(seatStartIdentity).filter(Boolean));
  const firstOutputExecutionIds = new Set(existingEvents
    .filter((event) => event.type === "execution.first_output" && typeof event.execution_id === "string")
    .map((event) => event.execution_id));
  const pending = [];
  const earliestMainSessionStarts = new Map();
  const earliestSubagentSessionStarts = new Map();
  const subagentSeatIdsByRuntimeSessionId = new Map();
  const lifecycle = new Map();
  const coverage = {
    session_files: 0,
    matching_sessions: 0,
    token_count_records: 0,
    accepted_records: 0,
    task_started_projections: 0,
    seat_started_projections: 0,
    seat_stopped_projections: 0,
    observed_completion_projections: 0,
    quota_snapshots: 0,
    skipped_existing: 0,
    unbound_sessions: 0,
    malformed_or_oversized_lines: 0
  };
  const recordedAt = new Date(now).toISOString();
  const enqueue = (input) => {
    const event = normalizeEngineeringEvent({
      ...input,
      ...(input.task_id && input.execution_id === undefined
        ? { execution_id: executionIdForTask(input.task_id) }
        : {})
    });
    if (existing.has(event.event_id)) {
      coverage.skipped_existing += 1;
      return;
    }
    const seatIdentity = seatStartIdentity(event);
    // Older runtime projections used a different start timestamp in their
    // event ID. Preserve that append-only history while recognizing the same
    // project/task/opaque-seat fact during a backfill.
    if (seatIdentity && existingSeatStarts.has(seatIdentity)) {
      coverage.skipped_existing += 1;
      return;
    }
    existing.add(event.event_id);
    if (seatIdentity) existingSeatStarts.add(seatIdentity);
    pending.push(event);
  };

  for (const file of sessionFiles(sessionRoot)) {
    coverage.session_files += 1;
    let session = null;
    for await (const entry of boundedJsonLines(file)) {
      if (entry.oversized) {
        coverage.malformed_or_oversized_lines += 1;
        continue;
      }
      const { line } = entry;
      const isSessionMeta = SESSION_META_LINE.test(line);
      const isTokenCount = EVENT_MESSAGE_LINE.test(line) && TOKEN_COUNT_LINE.test(line);
      const isLifecycle = EVENT_MESSAGE_LINE.test(line) && (SUBAGENT_ACTIVITY_LINE.test(line) || TASK_COMPLETE_LINE.test(line));
      // This prefilter rejects arbitrary event_msg, model, and tool records
      // before JSON.parse. Exact type checks are repeated after parsing.
      if (!isSessionMeta && !isTokenCount && !isLifecycle) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { coverage.malformed_or_oversized_lines += 1; continue; }
      if (isSessionMeta) {
        const candidate = matchingSessionMeta(parsed, exactProjectPath, exactThread);
        if (!candidate?.matched) {
          if (candidate) {
            session = null;
            coverage.unbound_sessions += 1;
          }
          continue;
        }
        session = candidate;
        coverage.matching_sessions += 1;
        // A subagent transcript remains valid token evidence for the parent
        // task, but cannot attest when that parent task itself began.
        if (!session.is_subagent && session.occurred_at) {
          const current = earliestMainSessionStarts.get(session.task_id);
          if (!current || session.occurred_at < current.occurred_at) {
            earliestMainSessionStarts.set(session.task_id, session);
          }
        } else if (session.is_subagent && session.occurred_at) {
          const seatId = opaqueSeatId(session);
          if (session.runtime_session_id) subagentSeatIdsByRuntimeSessionId.set(session.runtime_session_id, seatId);
          const current = earliestSubagentSessionStarts.get(seatId);
          if (!current || session.occurred_at < current.occurred_at) {
            earliestSubagentSessionStarts.set(seatId, { ...session, seat_id: seatId });
          }
        }
        continue;
      }
      if (isLifecycle) {
        const record = lifecycleRecord(parsed, session);
        if (!record) continue;
        const current = lifecycle.get(record.runtime_session_id) ?? { task_id: record.task_id, runtime_session_id: record.runtime_session_id };
        if (record.kind === "started" && (!current.started || record.occurred_at < current.started.occurred_at)) current.started = record;
        if (["completed", "interrupted"].includes(record.kind) && (!current.stopped || record.occurred_at < current.stopped.occurred_at)) current.stopped = record;
        lifecycle.set(record.runtime_session_id, current);
        continue;
      }
      const record = tokenRecord(parsed, session);
      if (!record) continue;
      coverage.token_count_records += 1;
      if (!record.occurred_at) continue;
      if (record.usage) {
        enqueue({
          event_id: recordId("token.usage", session.task_id, record.occurred_at, record.usage, session.session_ref),
          type: "token.usage",
          project,
          task_id: session.task_id,
          occurred_at: record.occurred_at,
          recorded_at: recordedAt,
          source: "runtime",
          evidence_class: "observed",
          evidence_authority: "runtime_metadata",
          coverage_status: coverageForUsage(record.usage),
          ...record.usage
        });
        coverage.accepted_records += 1;
        if (Number.isFinite(record.usage.output_tokens) && record.usage.output_tokens > 0) {
          const executionId = executionIdForTask(session.task_id);
          if (!firstOutputExecutionIds.has(executionId)) {
            // Token metadata proves an output was produced, but not whether it
            // was accepted, validated, or complete. Keep this one fact
            // observational and let schema compatibility make it best-effort.
            if (recordEngineeringEventBestEffort({
              event_id: recordId("execution.first_output", session.task_id, record.occurred_at, "positive-output-tokens", session.session_ref),
              type: "execution.first_output",
              project,
              task_id: session.task_id,
              execution_id: executionId,
              occurred_at: record.occurred_at,
              recorded_at: recordedAt,
              source: "runtime",
              evidence_class: "observed",
              evidence_authority: "runtime_metadata",
              coverage_status: "complete"
            }, { ledger: targetLedger })) {
              firstOutputExecutionIds.add(executionId);
            }
          }
        }
      }
      if (record.quota) {
        enqueue({
          event_id: recordId("token.quota_snapshot", session.task_id, record.occurred_at, record.quota, session.session_ref),
          type: "token.quota_snapshot",
          project,
          task_id: session.task_id,
          occurred_at: record.occurred_at,
          recorded_at: recordedAt,
          source: "runtime",
          evidence_class: "observed",
          evidence_authority: "runtime_metadata",
          coverage_status: coverageForQuota(record.quota),
          ...record.quota
        });
        coverage.quota_snapshots += 1;
      }
    }
  }
  for (const session of earliestMainSessionStarts.values()) {
    enqueue({
      // Start is one task-level fact, not one fact per transcript. Its ID is
      // intentionally independent of a session reference so repeated main
      // logs at the same earliest timestamp stay idempotent.
      event_id: recordId("task.started", session.task_id, session.occurred_at, "runtime-session-meta"),
      type: "task.started",
      project,
      task_id: session.task_id,
      occurred_at: session.occurred_at,
      recorded_at: recordedAt,
      source: "runtime",
      evidence_class: "observed",
      evidence_authority: "runtime_metadata",
      coverage_status: "complete"
    });
    coverage.task_started_projections += 1;
  }
  const incompleteSeatCoverage = new Map();
  for (const session of earliestSubagentSessionStarts.values()) {
    const lifecycleKey = session.runtime_session_id ?? session.seat_id;
    const existingLifecycle = lifecycle.get(lifecycleKey);
    if (!existingLifecycle?.started) {
      lifecycle.set(lifecycleKey, { ...existingLifecycle, task_id: session.task_id, runtime_session_id: session.runtime_session_id, seat_id: session.seat_id, started: { occurred_at: session.occurred_at, coverage_status: "partial" } });
    }
  }
  for (const session of lifecycle.values()) {
    const seatId = session.seat_id ?? subagentSeatIdsByRuntimeSessionId.get(session.runtime_session_id) ?? opaqueSeatId({
      runtime_session_id: session.runtime_session_id,
      task_id: session.task_id,
      occurred_at: session.started?.occurred_at ?? session.stopped?.occurred_at
    });
    if (session.started) {
    enqueue({
      event_id: recordId("seat.started", session.task_id, session.started.occurred_at, seatId),
      type: "seat.started",
      project,
      task_id: session.task_id,
      seat_id: seatId,
      occurred_at: session.started.occurred_at,
      recorded_at: recordedAt,
      source: "runtime",
      evidence_class: "observed",
      evidence_authority: "runtime_metadata",
      coverage_status: session.started.coverage_status
    });
    coverage.seat_started_projections += 1;
    }
    if (session.stopped) {
      enqueue({
        event_id: recordId("seat.stopped", session.task_id, session.stopped.occurred_at, seatId),
        type: "seat.stopped",
        project,
        task_id: session.task_id,
        seat_id: seatId,
        occurred_at: session.stopped.occurred_at,
        recorded_at: recordedAt,
        source: "runtime",
        evidence_class: "observed",
        evidence_authority: "runtime_metadata",
        coverage_status: session.stopped.coverage_status
      });
      coverage.seat_stopped_projections += 1;
      if (session.stopped.coverage_status === "partial") coverage.observed_completion_projections += 1;
    }
    const current = incompleteSeatCoverage.get(session.task_id);
    // Observing one or more starts/stops does not enumerate every worker, so
    // runtime ingestion cannot claim globally complete seat intervals.
    if (session.started && (!current || session.started.occurred_at < current)) {
      incompleteSeatCoverage.set(session.task_id, session.started.occurred_at);
    }
  }
  for (const [taskId, occurredAt] of incompleteSeatCoverage) {
    // Transcript EOF is not a stop observation. Make the missing interval
    // explicit so consumers keep seat utilization/duration unavailable.
    enqueue({
      event_id: recordId("coverage.seat_intervals", taskId, occurredAt, "runtime-subagent-start-without-stop"),
      type: "coverage.seat_intervals",
      project,
      task_id: taskId,
      occurred_at: occurredAt,
      recorded_at: recordedAt,
      source: "runtime",
      evidence_class: "observed",
      evidence_authority: "runtime_metadata",
      coverage_status: "partial",
      outcome: "incomplete"
    });
  }
  for (const event of pending) recordEngineeringEvent(event, { ledger: targetLedger });
  return { ledger: targetLedger, appended: pending.length, coverage };
}
