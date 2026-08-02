#!/usr/bin/env node
import { handleReadRootProfileCommand } from "../lib/profile-read-roots.mjs";

try {
  if (handleReadRootProfileCommand(process.argv.slice(2))) {
    process.exit(0);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    command: process.argv.slice(2, 4).join(" "),
    failed_closed: true
  }, null, 2)}\n`);
  process.exit(1);
}
import fs from "node:fs";
import {
  buildAfterActionReport,
  buildMetricsReport,
  recordEngineeringEvent
} from "../lib/engineering-metrics.mjs";
import { buildExecutionEvidenceReport } from "../lib/execution-evidence-report.mjs";
import { ingestRuntimeTelemetry } from "../lib/runtime-telemetry.mjs";
import { attestNativeSubagent } from "../lib/native-model-attestation.mjs";
import { auditModelRouting } from "../lib/model-routing-audit.mjs";
import {
  assignSeat,
  continueSeat,
  explainSeat,
  finalizeSeat,
  inspectSeat,
  preflightSeat,
  recoverSeat
} from "../lib/seat-workflow.mjs";
import {
  acceptHandoffWorkflow,
  addMachineProjectRoot,
  adoptCurrentContext,
  acknowledgeDelivery,
  activateRelease,
  authorizeCommunication,
  authorizeHandoffCommunication,
  buildRelease,
  configureApprovalMode,
  configureAgentSystemProfile,
  deliverResolvedPolicy,
  formatGovernanceError,
  generateTraceability,
  legacyContextGuidance,
  listPolicyCatalog,
  lockPolicies,
  lockLocalPolicies,
  publishOverlays,
  readAgentSystemProfile,
  recordLocalAgentSystemIssue,
  removeMachineProjectRoot,
  resolvePolicyRoot,
  resolvePolicyRootForReceipt,
  resolveRoute,
  runAuditWorkflow,
  runCanary,
  verifyHandoffWorkflow,
  verifyLocalPolicies,
  verifyAll
} from "../lib/core.mjs";
import {
  orchestrateLaunch,
  orchestrateNext,
  readOrchestrationFacts,
  verifyPersistedOrchestrationBundle
} from "../lib/orchestration-cli.mjs";

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const args = { command, positional: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--policy-root") args.policyRoot = rest[++index];
    else if (value === "--file") args.file = rest[++index];
    else if (value === "--index") args.index = rest[++index];
    else if (value === "--release-id") args.releaseId = rest[++index];
    else if (value === "--project") args.project = rest[++index];
    else if (value === "--base") args.base = rest[++index];
    else if (value === "--seat") args.seat = rest[++index];
    else if (value === "--work-id") args.workId = rest[++index];
    else if (value === "--worktree") args.worktree = rest[++index];
    else if (value === "--worktree-root") args.worktreeRoot = rest[++index];
    else if (value === "--source") args.source = rest[++index];
    else if (value === "--copy") (args.copyPaths ??= []).push(rest[++index]);
    else if (value === "--write-scope") (args.writeScopes ??= []).push(rest[++index]);
    else if (value === "--generated-scope") (args.generatedScopes ??= []).push(rest[++index]);
    else if (value === "--risk-tag") (args.riskTags ??= []).push(rest[++index]);
    else if (value === "--model") args.model = rest[++index];
    else if (value === "--reasoning") args.reasoning = rest[++index];
    else if (value === "--objective") args.objective = rest[++index];
    else if (value === "--receipt") args.receipt = rest[++index];
    else if (value === "--expected-head") args.expectedHead = rest[++index];
    else if (value === "--intent") args.intent = rest[++index];
    else if (value === "--facts") args.facts = rest[++index];
    else if (value === "--prior-bundle") args.priorBundle = rest[++index];
    else if (value === "--bundle") args.bundle = rest[++index];
    else if (value === "--assignment") args.assignment = rest[++index];
    else if (value === "--provenance-root") args.provenanceRoot = rest[++index];
    else if (value === "--path") args.path = rest[++index];
    else if (value === "--handoff") args.handoff = rest[++index];
    else if (value === "--pointer") args.pointer = rest[++index];
    else if (value === "--prior-receipt") args.priorReceipt = rest[++index];
    else if (value === "--repository") args.repository = rest[++index];
    else if (value === "--verification-receipt") args.verificationReceipt = rest[++index];
    else if (value === "--subagent-worktree-receipt") args.subagentWorktreeReceipt = rest[++index];
    else if (value === "--target") args.target = rest[++index];
    else if (value === "--scope") args.scope = rest[++index];
    else if (value === "--parent-thread") args.parentThreadId = rest[++index];
    else if (value === "--agent") args.agentId = rest[++index];
    else if (value === "--session-root") args.sessionRoot = rest[++index];
    else if (value === "--diagnostics") args.diagnostics = true;
    else if (value === "--days") args.days = Number(rest[++index]);
    else if (value === "--log") args.logFile = rest[++index];
    else if (value === "--ledger") args.ledger = rest[++index];
    else if (value === "--execution") args.execution = rest[++index];
    else if (value === "--thread") args.thread = rest[++index];
    else if (value === "--task") args.task = rest[++index];
    else if (value === "--attempt") args.attempt = rest[++index];
    else if (value === "--event") args.event = rest[++index];
    else if (value === "--at") args.at = rest[++index];
    else if (value === "--manual-hours") args.manualHoursEstimate = Number(rest[++index]);
    else if (value === "--manual-hours-avoided") args.manualHoursAvoidedEstimate = Number(rest[++index]);
    else if (value === "--duration-ms") args.durationMs = Number(rest[++index]);
    else if (value === "--outcome") args.outcome = rest[++index];
    else if (value === "--first-pass") args.firstPass = rest[++index];
    else if (value === "--material") args.material = true;
    else if (value === "--memory") args.memory = rest[++index];
    else if (value === "--label") args.label = rest[++index];
    else if (value === "--mode") args.mode = rest[++index];
    else if (value === "--persistent-task") {
      const choice = rest[++index];
      if (choice !== "yes" && choice !== "no") throw new Error("--persistent-task must be yes or no");
      args.persistentTask = choice === "yes";
    } else if (value === "--automatic-defect-report") {
      const choice = rest[++index];
      if (choice !== "yes" && choice !== "no") throw new Error("--automatic-defect-report must be yes or no");
      args.automaticDefectReport = choice === "yes";
    }
    else if (value === "--automatic-repair") {
      const choice = rest[++index];
      if (choice !== "yes" && choice !== "no") throw new Error("--automatic-repair must be yes or no");
      args.automaticRepair = choice === "yes";
    }
    else if (value === "--reported-defect-action") args.reportedDefectAction = rest[++index];
    else if (value === "--delivery-unavailable") args.deliveryUnavailable = true;
    else if (value === "--acknowledge-agent-system-token-cost") args.acknowledgeTokenCost = true;
    else if (value === "--category") args.category = rest[++index];
    else if (value === "--failure-class") args.failureClass = rest[++index];
    else if (value === "--correction-of") args.correctionOf = rest[++index];
    else if (value === "--reclassified-from-category") args.reclassifiedFromCategory = rest[++index];
    else if (value === "--material-repair-evidence") args.materialRepairEvidence = true;
    else if (value === "--core-capability") args.coreCapability = true;
    else if (value === "--locally-actionable") args.locallyActionable = true;
    else if (value === "--private-agent-system-scope") args.privateAgentSystemScope = true;
    else if (value === "--repair-authority") args.repairAuthority = true;
    else if (value === "--complete-exclusions") args.exclusionsComplete = true;
    else if (value === "--supported-fallback") {
      const choice = rest[++index];
      if (choice !== "yes" && choice !== "no") throw new Error("--supported-fallback must be yes or no");
      args.supportedFallback = choice === "yes";
    }
    else if (value === "--summary") args.summary = rest[++index];
    else if (value === "--evidence") args.evidence = rest[++index];
    else if (value === "--evidence-class") args.evidenceClass = rest[++index];
    else if (value === "--issue-id") args.issueId = rest[++index];
    else if (value === "--severity") args.severity = rest[++index];
    else if (value === "--authorize-memory-write") args.authorizeMemoryWrite = true;
    else if (value === "--authorize-profile-write") args.authorizeProfileWrite = true;
    else if (value === "--automatic-report" || value === "--auto-create" || value === "--auto-report") throw new Error(`${value} is deprecated; use --persistent-task yes|no --automatic-defect-report yes|no --automatic-repair yes|no with --reported-defect-action log_only|auto_correct and --acknowledge-agent-system-token-cost`);
    else if (value === "--operator-confirmed-pre-hook") args.operatorConfirmedPreHook = true;
    else if (value === "--allow-rollback") args.allowRollback = true;
    else if (value.startsWith("--")) throw new Error(`Unknown option: ${value}`);
    else args.positional.push(value);
  }
  return args;
}

async function readInput(file) {
  if (file) return JSON.parse(fs.readFileSync(file, "utf8"));
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  if (!input.trim()) throw new Error("JSON input is required on stdin or with --file");
  return JSON.parse(input);
}

let args = { command: process.argv[2] ?? "help", positional: [] };
let quiet = false;

try {
  args = parseArgs(process.argv.slice(2));
  if (args.project === "null" && !(args.command === "seat" && args.positional[0] === "inspect")) {
    throw new Error("--project null is permitted only for seat inspect");
  }
  let result;
  if (args.command === "profile" && args.positional[0] === "add-root") {
    result = addMachineProjectRoot({
      project: args.project,
      path: args.path,
      authorizeProfileWrite: args.authorizeProfileWrite
    });
  } else if (args.command === "profile" && args.positional[0] === "remove-root") {
    result = removeMachineProjectRoot({
      project: args.project,
      path: args.path,
      authorizeProfileWrite: args.authorizeProfileWrite
    });
  } else if (args.command === "profile" && args.positional[0] === "approval") {
    result = configureApprovalMode({
      mode: args.mode,
      authorizeProfileWrite: args.authorizeProfileWrite
    });
  } else if (args.command === "profile" && args.positional[0] === "agent-system") {
    result =
      args.label || args.thread || args.memory || args.authorizeProfileWrite || args.persistentTask !== undefined || args.automaticDefectReport !== undefined || args.automaticRepair !== undefined || args.reportedDefectAction !== undefined || args.acknowledgeTokenCost
        ? configureAgentSystemProfile({
            label: args.label,
            threadId: args.thread,
            memoryPath: args.memory,
            persistentTask: args.persistentTask,
            automaticDefectReport: args.automaticDefectReport,
            automaticRepair: args.automaticRepair,
            reportedDefectAction: args.reportedDefectAction,
            acknowledgeTokenCost: args.acknowledgeTokenCost,
            authorizeProfileWrite: args.authorizeProfileWrite
          })
        : readAgentSystemProfile();
  } else if (args.command === "agent-system" && args.positional[0] === "record-issue") {
    result = recordLocalAgentSystemIssue({ project: args.project, issueId: args.issueId, severity: args.severity, summary: args.summary, evidenceClass: args.evidenceClass, evidence: args.evidence, category: args.category, failureClass: args.failureClass, correctionOf: args.correctionOf, reclassifiedFromCategory: args.reclassifiedFromCategory, materialRepairEvidence: args.materialRepairEvidence, coreCapability: args.coreCapability, locallyActionable: args.locallyActionable, privateAgentSystemScope: args.privateAgentSystemScope, repairAuthority: args.repairAuthority, exclusionsComplete: args.exclusionsComplete, supportedFallback: args.supportedFallback, deliveryUnavailable: args.deliveryUnavailable });
  } else if (args.command === "context" && args.positional[0] === "legacy") {
    result = legacyContextGuidance({
      operatorConfirmedPreHook: args.operatorConfirmedPreHook === true
    }, resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "context" && args.positional[0] === "adopt-current") {
    result = adoptCurrentContext({
      operatorConfirmedPreHook: args.operatorConfirmedPreHook === true
    }, resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "audit") {
    const priorReceipt = args.priorReceipt ? await readInput(args.priorReceipt) : null;
    result = runAuditWorkflow({
      project: args.project,
      path: args.path,
      mode: args.mode,
      priorReceipt
    }, resolvePolicyRootForReceipt(priorReceipt, args.policyRoot));
  } else if (args.command === "orchestrate" && args.positional[0] === "next") {
    result = orchestrateNext({
      project: args.project,
      root: args.path,
      intent: args.intent,
      facts: await readOrchestrationFacts(args.facts),
      priorBundle: args.priorBundle
    });
  } else if (args.command === "orchestrate" && args.positional[0] === "verify") {
    result = verifyPersistedOrchestrationBundle(args.bundle);
  } else if (args.command === "orchestrate" && args.positional[0] === "launch") {
    result = orchestrateLaunch({
      bundlePath: args.bundle,
      seat: args.seat
    });
  } else if (args.command === "seat" && args.positional[0] === "inspect") {
    const priorReceipt = args.priorReceipt ? await readInput(args.priorReceipt) : null;
    result = inspectSeat(
      { ...args, priorReceipt },
      resolvePolicyRootForReceipt(priorReceipt, args.policyRoot)
    );
  } else if (args.command === "seat" && args.positional[0] === "preflight") {
    result = preflightSeat(args, resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "seat" && ["assign", "recover"].includes(args.positional[0])) {
    const priorReceipt = args.priorReceipt ? await readInput(args.priorReceipt) : null;
    const options = { ...args, priorReceipt };
    const policyRoot = resolvePolicyRootForReceipt(priorReceipt, args.policyRoot);
    result = args.positional[0] === "assign"
      ? assignSeat(options, policyRoot)
      : recoverSeat(options, policyRoot);
  } else if (args.command === "seat" && args.positional[0] === "continue") {
    result = continueSeat(args, resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "seat" && args.positional[0] === "finalize") {
    result = finalizeSeat(args, resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "seat" && args.positional[0] === "explain") {
    result = explainSeat(args);
  } else if (args.command === "handoff" && args.positional[0] === "verify") {
    result = verifyHandoffWorkflow({
      project: args.project,
      handoff: args.handoff,
      pointer: args.pointer,
      repository: args.repository
    }, resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "handoff" && args.positional[0] === "accept") {
    result = acceptHandoffWorkflow({
      project: args.project,
      verification: await readInput(args.verificationReceipt),
      authorizeMemoryWrite: args.authorizeMemoryWrite === true
    }, resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "handoff" && args.positional[0] === "communicate") {
    result = authorizeHandoffCommunication({
      project: args.project,
      target: args.target,
      scope: args.scope,
      subagentWorktreeReceipt: args.subagentWorktreeReceipt
    }, resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "communicate") {
    result = authorizeCommunication({
      project: args.project,
      target: args.target,
      scope: args.scope,
      subagentWorktreeReceipt: args.subagentWorktreeReceipt
    }, resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "route") {
    const request = await readInput(args.file);
    result = resolveRoute(request, resolvePolicyRootForReceipt(request.prior_receipt, args.policyRoot));
  } else if (args.command === "deliver") {
    const input = await readInput(args.file);
    result = deliverResolvedPolicy(input, resolvePolicyRootForReceipt(input.resolution_receipt ?? input, args.policyRoot));
  } else if (args.command === "acknowledge") {
    const input = await readInput(args.file);
    result = acknowledgeDelivery(input, resolvePolicyRootForReceipt(input.resolution_receipt, args.policyRoot));
  } else if (args.command === "attest-native-model") {
    result = attestNativeSubagent({
      parentThreadId: args.parentThreadId,
      agentId: args.agentId,
      sessionRoot: args.sessionRoot
    });
    if (!result.output_admissible) process.exitCode = 2;
  } else if (args.command === "model-audit") {
    result = await auditModelRouting({
      threadId: args.thread,
      days: args.days,
      sessionRoot: args.sessionRoot,
      logFile: args.logFile
    });
  } else if (args.command === "metrics" && args.positional[0] === "report") {
    result = buildMetricsReport({
      project: args.project,
      thread: args.thread,
      days: args.days,
      ledger: args.ledger
    });
  } else if (args.command === "metrics" && args.positional[0] === "after-action") {
    result = buildAfterActionReport({
      project: args.project,
      thread: args.thread,
      days: args.days,
      ledger: args.ledger
    });
  } else if (args.command === "metrics" && args.positional[0] === "execution") {
    result = buildExecutionEvidenceReport({
      execution: args.execution,
      ledger: args.ledger
    });
  } else if (args.command === "metrics" && args.positional[0] === "record") {
    let event;
    if (args.file) {
      event = await readInput(args.file);
    } else {
      let firstPass;
      if (args.firstPass !== undefined) {
        if (!["true", "false"].includes(args.firstPass)) throw new Error("--first-pass must be true or false");
        firstPass = args.firstPass === "true";
      }
      event = Object.fromEntries(Object.entries({
        type: args.event,
        project: args.project,
        thread_id: args.thread,
        task_id: args.task,
        work_id: args.workId,
        attempt_id: args.attempt,
        seat_id: args.seat,
        occurred_at: args.at,
        source: args.source,
        duration_ms: args.durationMs,
        manual_hours_estimate: args.manualHoursEstimate,
        manual_hours_avoided_estimate: args.manualHoursAvoidedEstimate,
        material: args.material,
        first_pass: firstPass,
        outcome: args.outcome
      }).filter(([, value]) => value !== undefined));
    }
    recordEngineeringEvent(event, { ledger: args.ledger });
    quiet = true;
    result = null;
  } else if (args.command === "metrics" && args.positional[0] === "ingest-runtime") {
    result = await ingestRuntimeTelemetry({
      sessionRoot: args.sessionRoot,
      project: args.project,
      ledger: args.ledger,
      projectPath: args.path,
      thread: args.thread
    });
    quiet = args.diagnostics !== true;
  } else if (args.command === "lock") {
    result = lockPolicies(resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "local-lock") {
    result = lockLocalPolicies(args.index ?? args.positional[0], resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "local-verify") {
    const selection = args.file ? await readInput(args.file) : null;
    result = verifyLocalPolicies(args.index ?? args.positional[0], selection, resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "traceability") {
    result = generateTraceability();
  } else if (args.command === "verify") {
    result = verifyAll(resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "canary") {
    result = runCanary(resolvePolicyRoot(args.policyRoot));
  } else if (args.command === "build-release") {
    result = buildRelease(undefined, args.releaseId ?? args.positional[0] ?? null);
  } else if (args.command === "activate") {
    result = activateRelease(undefined, args.releaseId ?? args.positional[0], undefined, { allowRollback: args.allowRollback === true });
  } else if (args.command === "publish-overlays") {
    result = publishOverlays();
  } else if (args.command === "list") {
    result = listPolicyCatalog(args.positional[0] ?? "all", resolvePolicyRoot(args.policyRoot));
  } else {
    result = {
      commands: ["audit", "orchestrate next", "orchestrate verify", "orchestrate launch", "seat inspect", "seat preflight", "seat assign", "seat recover", "seat continue", "seat finalize", "seat explain", "metrics report", "metrics execution", "metrics after-action", "metrics record", "metrics ingest-runtime", "context adopt-current", "context legacy", "profile add-root", "profile remove-root", "profile approval", "profile agent-system", "agent-system record-issue", "handoff verify", "handoff accept", "handoff communicate", "communicate", "route", "deliver", "acknowledge", "attest-native-model", "model-audit", "list", "lock", "local-lock", "local-verify", "traceability", "verify", "canary", "build-release", "activate", "publish-overlays"],
      audit: "audit --project <slug> --path <absolute-root> [--prior-receipt <file|->]",
      orchestrate: {
        next: "orchestrate next --project <slug> --path <absolute-root> --intent <intent> --facts <json-file|-> [--prior-bundle <absolute-path>]",
        verify: "orchestrate verify --bundle <absolute-path>",
        launch: "orchestrate launch --bundle <private-v6-bundle> --seat <1..N>"
      },
      seat: {
        inspect: "seat inspect --project <slug> --path <absolute-root> --seat <name> --model <id> --reasoning <value> [--bundle <private-v6-bundle>] [--attempt 1|2] [--objective <text>] [--prior-receipt <file|->]",
        preflight: "seat preflight --assignment <read-only-assignment-package>",
        assign: "seat assign --project <slug> --repository <repo> --base <sha> --seat <worker-name> --worktree-root <root> --write-scope <path> [--generated-scope <non-integrable-path>]... --model <id> --reasoning <value> [--bundle <private-v6-bundle>]",
        recover: "seat recover --assignment <governed-mutating-assignment-package>",
        continue: "seat continue --project <slug> --receipt <original-assignment-receipt> --expected-head <sha> [--intent implementation|validate|deploy]",
        finalize: "seat finalize --assignment <assignment-package> [--receipt <continuation-receipt>]",
        explain: "seat explain --assignment <assignment-package>"
      },
      profile: {
        add_root: "profile add-root --project <slug> --path <absolute-path> --authorize-profile-write",
        remove_root: "profile remove-root --project <slug> --path <absolute-path> --authorize-profile-write",
        approval: "profile approval --mode ask|approve_for_me|full --authorize-profile-write",
        agent_system: "profile agent-system --persistent-task yes|no --automatic-defect-report yes|no --automatic-repair yes|no [--reported-defect-action log_only|auto_correct when reporting is enabled] --acknowledge-agent-system-token-cost --authorize-profile-write [--label <exact-task-title> --memory <absolute-path>]; all three choices can consume tokens",
        record_issue: "agent-system record-issue --project <slug> --issue-id <id> --severity P0|P1|P2|P3|P4 --summary <bounded-text> [--category agent_system|worker_adherence|host_runtime|project_tool_side_effect|caller_error|expected_fail_closed --failure-class <stable-lowercase-slug> --evidence-class Observed|Verified|Inferred|Proposed|Unknown|Unverified --evidence <bounded-text> --material-repair-evidence --core-capability --locally-actionable --private-agent-system-scope --repair-authority --complete-exclusions --supported-fallback yes|no --correction-of <event-or-class> --reclassified-from-category <category>] [--delivery-unavailable (requires explicit --category and --failure-class; always local-only and never resent)]"
      },
      context: {
        adopt_current: "context adopt-current --operator-confirmed-pre-hook",
        legacy: "context legacy --operator-confirmed-pre-hook (deprecated alias)"
      },
      metrics: {
        report: "metrics report [--project <slug>] [--thread <id>] [--days 30] [--ledger <private-jsonl>]",
        execution: "metrics execution --execution <id> [--ledger <private-jsonl>]",
        after_action: "metrics after-action --project <slug> --thread <id> [--days <n>]",
        record: "metrics record --event <type> --project <slug> [--thread <id>] [--task <id>] [--seat <id>] [bounded event fields]",
        ingest_runtime: "metrics ingest-runtime --session-root <absolute-root> --project <slug> [--path <exact-project-root>] [--thread <exact-task-id>] [--ledger <private-jsonl>] [--diagnostics]; require --path and/or --thread"
      },
      handoff: {
        verify: "handoff verify --project <slug> --handoff <absolute-path> [--pointer <absolute-path>] [--repository <absolute-path>]",
        accept: "handoff accept --verification-receipt <json-file> [--project <slug>] [--authorize-memory-write]",
        communicate: "handoff communicate --project <slug> --target <task-id> --scope <absolute-project-path>"
      },
      communicate: "communicate --project <slug> --target <task-id> --scope <absolute-project-path> [--subagent-worktree-receipt <receipt>]",
      acknowledge: "acknowledge --file <complete-deliver-output.json>; do not construct a partial payload",
      attest_native_model: "attest-native-model --parent-thread <id> --agent <runtime-uuid-or-canonical-task-path> [--session-root <absolute-path>]",
      model_audit: "model-audit --thread <task-id> [--days 14] [--session-root <absolute-path>] [--log <absolute-path>]",
      note: "Prefer high-level commands. If low-level routing classification is uncertain, run `list all` once."
    };
  }
  if (!quiet) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  const command = args.command === "handoff" ? `handoff ${args.positional[0] ?? ""}`.trim() : args.command;
  process.stderr.write(JSON.stringify(formatGovernanceError(error, command), null, 2) + "\n");
  process.exitCode = 1;
}
