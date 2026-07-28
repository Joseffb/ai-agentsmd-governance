# Agent System Engineering Metrics

Agent System metrics are optional engineering analytics for answering whether
multi-agent delivery is becoming faster and more autonomous. Their architecture
is one-way:

```text
Kernel -> Receipts -> Events -> Metrics
```

Metrics consume bounded lifecycle evidence. They do not authorize, deny, block,
route, modify, or score governed execution, and no metric is a completion gate.

## Anti-optimization doctrine

Metrics observe execution and never become execution authority. Goodhart's,
Campbell's, Lucas's, and Conway's warnings apply: a measured proxy can be
gamed, distorted by incentives, changed by the rule that reacts to it, or
mistaken for a universal organizational signal. Therefore no KPI, alone or in
combination, may automatically route, rank, reward, punish, block, authorize,
select models, choose delegation, set worker count, declare progress or
completion, or mutate policy. Historical metrics are downstream-only; they
cannot feed live prompts or decisions automatically.

Keep raw components, evidence labels, coverage, and denominators with every
derived metric. Always interpret speed with validation, quality, and rework;
tokens with accepted scope; parallelism with integration and rework cost; and
autonomy with operator intervention and escaped defects; context compression
with information loss and clarification rate; and test pass rate with defect
escape rate. Worker topology follows real, independently integrable
architecture boundaries: agent count is never a target.

Tag comparisons with the Agent System version, rule set, model mix, and
validation topology. Do not blend pre- and post-policy relationships without a
qualification. A metric-informed policy change requires explicit operator
review, a new version, stated assumptions, and post-change recalibration; it is
not an automated feedback loop.

Ashby's Law of Requisite Variety constrains governance complexity: it must not
exceed what operators can understand or workers can reliably execute. Add rules
only for observed failure classes; every rule needs a clear purpose and
observable effect. Expose unresolved rule conflicts rather than silently
choosing, and ensure governance reduces uncertainty rather than creating it.

## Local Event Ledger

The default ledger is a private JSONL file in the local Codex governance data
directory. `ACG_METRICS_LEDGER` or `--ledger` may select another private local
file. `ACG_METRICS_DISABLED=1` disables best-effort automatic seat events.

The schema accepts only portable identifiers, timestamps, enums, booleans, and
bounded numeric durations or estimates. It rejects unknown fields. Prompts,
source code, model output, free-form notes, credentials, secrets, paths, and
hidden reasoning are not event fields.

Record a lifecycle fact the system cannot derive:

```sh
node bin/acg.mjs metrics record \
  --event task.started \
  --project example \
  --thread thread-123
```

Successful event writes are silent. Use `metrics report` to inspect analytics.
Malformed or prohibited ledger rows are ignored and counted as invalid coverage
rather than echoed into output.

Task, estimate, seat, operator, quality, validation, proof, coverage, and
coordination events require at least one bounded `thread`, `task`, or `work`
identifier. Use the same task identity and optional attempt identifier for every
event in one lifecycle. A `coverage.seat_intervals` event marked `complete`
asserts that the task's active and idle intervals are complete; paired interval
events without that assertion remain unavailable for concurrency metrics.

Absence is not silently treated as success or zero activity. Use the explicit
`coverage.intervention`, `coverage.quality`, `coverage.validation`,
`coverage.proof`, and `coverage.seat_intervals` facts when observation for that
surface is complete.

Intent-oriented `seat inspect`, `seat assign`, `seat recover`, and `seat
finalize` commands record only workflow facts they directly own. `seat
continue` records an event when the caller supplies the project and seat
identity. Telemetry failures are best-effort and never change the governance
command's result.

Seat metrics use the delegation counting contract. Seat `0` is the
coordinator/orchestrator and is not a delegated seat, so it is excluded from
average, peak, and displayed agent or seat counts. A displayed count of `N`
represents delegated seats `1` through `N`; topology labels run from `0`
through `N`.

## Runtime Telemetry Ingestion Contract

Runtime telemetry is a **one-stream, typed-family** adapter, not a task
control plane. A conforming implementation deterministically reads a supplied
immutable stream and accepts only the following allowlisted record families:

| Record family | Allowlisted fields | Treatment |
| --- | --- | --- |
| `session_meta` | bounded session/task identity linkage needed for correlation | bounded identity projection only |
| `token_count` | per-turn `last_token_usage` fields and primary rate-limit snapshot fields when supplied | exact observed values only |

Unknown record families and fields are discarded. The adapter never parses or
stores prompt text, source code, model output, hidden reasoning, credentials,
or raw machine paths. Source session and task files are read-only inputs:
they are never created, modified, truncated, renamed, or deleted by ingestion.

Run the adapter only with at least one binding: `--path <exact-project-root>`
and/or `--thread <exact-task-id>`. A session is admitted only when its
`session_meta` proves that its `cwd` is within the exact root and/or that its
task identity exactly matches the requested thread. Root selection alone never
labels every session in a transcript. The adapter stores neither `cwd` nor a
raw local path; every imported event is correlated through its bounded
`task_id` or `thread_id`. A matching session timestamp may add one idempotent
`task.started` projection, but ingestion never invents completion or
acceptance.

`last_token_usage` is a per-turn observation. Cumulative
`total_token_usage` snapshots are not read or summed. A token event is emitted
only as schema-recognized `token.usage`. Primary quota snapshots use only
observed `used_percent`, `window_minutes`, and reset timestamp/epoch fields as
schema-recognized `token.quota_snapshot`; they never include credits, balance,
plan, or an inferred remaining percentage. Operator-reported quota facts use a
separate `source: operator`, `evidence_class: user_report` ledger event.

The only durable effect is an append-only, private local ledger event. Ingested
events carry a stable bounded idempotency key, so replaying the same input
produces no duplicate ledger fact. No event is rewritten or backfilled in
place; a correction is a new linked append-only fact under the existing ledger
rules.

Token facts preserve exact values when observed. A missing, withheld, malformed,
or non-numeric token component is `null`, with explicit coverage describing
what was observed; it is never converted to zero, estimated, or borrowed from a
different event. Reporting may project this ledger into exactly these bounded
families: **Runtime**, **Work**, **Token**, **Acceptance**, and
**Utilization**. A projection retains its coverage and cannot invent a value
outside its input evidence.

Tooling failures, unavailable host metadata, malformed records, and permitted
fallbacks are reported only as telemetry coverage or tooling-health facts. They
do not inflate task, acceptance, validation, or product-quality failure counts.
Raw local machine paths remain local-only; any report or after-action payload
uses bounded project, task, work, or session identities instead.

This adapter has no authority to inject context, create or accept a handoff,
send task messages, make network calls, create automatic reports, schedule
work, or alter routing, model choice, delegation, validation, acceptance, or
execution from a metric. Reports remain operator-requested and downstream-only.

## Reports

```sh
# Default: 30-day portfolio grouped by project
node bin/acg.mjs metrics report

# Primary project detail
node bin/acg.mjs metrics report --project example --days 30

# Diagnostic thread drilldown
node bin/acg.mjs metrics report --thread thread-123 --days 14

# Explicitly bound, quiet runtime import (at least --path or --thread is required)
node bin/acg.mjs metrics ingest-runtime \
  --session-root <session-root> \
  --project example \
  --path <project-root> \
  --thread thread-123

# Identity-free projection for large-goal cleanup
node bin/acg.mjs metrics after-action \
  --project example \
  --thread thread-123
```

Every report includes project dashboards and weekly trend data. A thread filter
matches either the recorded thread ID or its linked task ID and adds task
diagnostics without returning raw ledger rows. The JSON shape is
deterministic for the selected ledger, filters, and report time, making it safe
for a later scheduled task. Comparison reporting is operator-requested only;
no schedule is created without an explicit operator cadence.
The after-action projection omits ledger diagnostics and raw task/thread IDs;
it is the bounded payload supplied to the configured Agent System lane.

## Metric Semantics

- Delivery Compression = manual engineering hours estimate / observed
  wall-clock hours, using only tasks with both values.
- Parallelization Efficiency = effective seat-hours / (wall-clock hours *
  peak concurrent seats), using only complete seat and idle intervals.
- Operator Load = material approvals, interventions, redirects, and
  clarification requests.
- Autonomous Completion Rate = completions without intervention / tasks with a
  classified completion, restart, abandonment, or block outcome.
- Human Waiting Time = task start to the first usable operator result.
- Manual Hours Avoided is a separately supplied engineering estimate. It is
  never derived from wall-clock time and is always labeled estimate-based.
- Comparison projections include accepted tasks/hour, accepted tasks/million
  exact observed tokens, mean accepted-task latency, average delegated worker
  count (excluding Seat `0`), duplicated-work duration/admitted seat time, and
  orchestration-overhead duration/wall-clock. Each uses only the accepted-task
  cohort and reports `null` whenever its full timing, token, worker, duplicate,
  coordination, or wall-clock denominator is incomplete. `coverage.duplicated_work`
  and `coverage.coordination` explicitly close their corresponding observation
  surfaces; their absence is not treated as zero.

Missing timings, estimates, intervals, acceptance evidence, validation, or
proof return `null` with coverage. They are never inferred from unrelated
receipts, seat preparation, command success, or narrative status.

Supporting project fields cover delivery, quality, agent efficiency, and
diagnostic governance signals. Governance signals explain safety and recovery;
they are not the product purpose and never influence governance decisions.

## AI-native Forecasting

Substantial work keeps three evidence classes separate:

1. conventional human P50/P80 effort for a defined scope;
2. AI P50/P80 wall-clock forecast and its critical path; and
3. observed AI segments, gaps, tokens, seat-hours, validation, operator time,
   rework, and accepted scope.

The forecast record also carries aggregate seat-hours, serial and parallel
machine-validation time, operator touch/wait, manual-equivalent P50/P80,
rework allowance, confidence, comparable sample count, and counts of
assumptions, external dependencies, and stop gates. Missing values remain
`null`; incomplete goal segments produce only explicitly labeled lower bounds,
never a full-workstream compression result.

`forecast.remaining` preserves each initial and revised remaining-time window
as a completion target, together with critical-path remainder, the serial
validation floor, scope version, gate counts, confidence, and one bounded
revision reason. Reports show elapsed time between forecasts and how far the
P50/P80 completion targets moved. A target that advances by hours during only
minutes of execution is a forecast revision, not delivery compression, and
requires material gate, scope, failure, validation, parallelism, calibration,
or operator evidence.

`estimate.conventional`, `forecast.created`, `runtime.segment`, `runtime.gap`,
`validation.run`, `operator.touch`, and `operator.wait` are closed,
append-only event types. Evidence is labeled `observed`, `user_report`,
`unknown`, `derived`, or `proposed`; completeness is `complete`,
`lower_bound`, or `unknown`. Scope classes keep source-task work,
accepted-product scope, full-program scope, slices, and historical assumptions
separate. A valid `supersedes_event_id` preserves corrections without deleting
history; invalid or cyclic links are excluded and diagnosed.

`benchmark.compression_snapshot` can retain an explicitly requested
current-segment comparison without promoting it into the north-star metric. It
records the manual-equivalent range, the observed denominator, both scope
labels, and comparability. A source-task numerator divided by one goal segment
is reported as a qualified category mismatch and remains ineligible for
portfolio delivery compression until the complete comparable workstream
denominator is available.

### Capture status

| Signal | Automatic today | Explicit event | Runtime limitation |
| --- | --- | --- | --- |
| Seat preparation/recovery/continuation/finalization | Yes, from intent seat commands | No | Does not prove active time |
| Task lifecycle, active/idle seats, forecast, accepted scope | No | Yes | Host hooks may improve later |
| Goal elapsed/tokens/status and linked-goal gaps | No | Import each authoritative segment | Historical goal chains may be unavailable |
| Validation duration/first pass | No | Yes | No universal test-run hook |
| Operator touch/wait | No | Yes | No authoritative host timer |
| Requested model/reasoning | Separate routing ledger only | Not in KPI ledger | Not actual routing |
| Actual model/reasoning | No | Not in KPI ledger yet | Host metadata may be unavailable; otherwise `Unverified` |

### Forecast-stability example

One observed task reported the following ordered phase snapshots during a
single active turn: `34% 8-14h`, `43% 8-14h`, `47% 7-12h`, `51% 6-11h`,
`54% 6-10h`, `61% 5-9h`, `68% 4-8h`, and `71% 4-7h`. Per-message timestamps
were unavailable, so the elapsed interval is Unknown; the operator reported
that some reductions occurred minutes apart. The midpoint nevertheless moved
from 11 hours to 5.5 hours. Treat this as forecast-instability evidence until
gate-linked `forecast.remaining` events explain the target movement. Do not
mislabel the change as measured delivery speed.

`metrics record --file <event.json>` quietly validates and appends one closed
event. The report is read-only and computes actual-versus-forecast only when
all linked runtime segments and gaps are complete.

## Default-estimate Benchmark Protocol

A raw default-model estimate, a conventional analyst work breakdown, and
observed AI execution are different artifacts. Never normalize one into
another.

For a blinded default-estimate experiment, use a fresh context and one
sanitized performed-work scope with no timing, agent count, Agent System,
tokens, actual elapsed, desired unit, or efficiency cue. Variant A appends only
`Give me an estimate.` Variant B asks for conventional human effort; Variant C
asks for a governed multi-agent execution estimate; Variant D adds authorized
historical telemetry. Keep the scope identical.

The portable fixture is
[`fixtures/ai-estimation-benchmark.example.json`](../fixtures/ai-estimation-benchmark.example.json).

Capture the initial response in its task transcript before critique. The KPI
ledger stores only normalized hours, team size, variant, model/reasoning
metadata, attestation state, whether an AI/human distinction appeared, and an
opaque response-artifact ID—never verbatim model output. Label reconstructed
answers `reconstructed_not_blinded`; only fresh runs are `blinded`. Use at
least 5 samples per configuration for exploration and 10 or more for a useful
distribution. Experiment launch and cost require separate operator direction.

The estimate task must use the sanitized prompt as its only factual evidence.
Repository, filesystem, memory, web, prior-task, and continuity inspection are
prohibited. Loading the automatically injected governance bootstrap is allowed
and is recorded separately from prompt content. Inspection beyond that boundary
invalidates and contaminates the sample before normalization.

Admit a sample only when authoritative launch metadata proves that its fresh
parent/task loaded the current Agent System release and launch hooks before the
estimate prompt entered the context. Keep governance bootstrap outside the
factual benchmark prompt. A task created from an older context does not acquire
newly installed launch hooks through reload; create a fresh task from a
current-hook parent. A missing bootstrap from such a verified current-hook
parent is defect evidence. A missing bootstrap from an older or unverified
parent invalidates the sample but does not establish a projectless-bootstrap
defect.

Preserve invalid samples append-only with their evidence and qualification.
A withheld estimate after raw-route failures is invalid. An estimate obtained
only after prompt-visible governance coaching is both invalid and contaminated.
Neither belongs in the estimate distribution.

`benchmark.probe` records every attempted run, including invalid runs, with an
opaque fixture/digest, launch-hook attestation, prompt-purity result, bounded
invalid-reason enum, requested routing when explicit, actual routing only when
attested, and governance release identity. `benchmark.estimate_sample` records
normalized estimate values only for admitted or explicitly reconstructed
samples. Verbatim responses stay in their task transcript.

The canonical generic fixture is the complete detailed work-package prompt,
not a synopsis. An operator may retain a context-disclosed response for
comparison as `operator_included_context_disclosed`; its complete response
remains in the linked task transcript and it must not be represented as an
unqualified blinded sample.

Historical imports use `workstream.registered` as a reporting/cohort anchor
when the actual task start is unknown. It does not create a start time:
wall-clock, calendar duration, and waiting metrics remain `null` until truthful
lifecycle timing exists.
