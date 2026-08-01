# Benchmark Calibration Policy

Agent System owns and version-controls this lightweight JIT planning service,
implemented as one policy module. It is the sole owner of the approved
human-to-AI benchmark calibration and is consumed only when planning estimates
AI time. It creates no runtime subsystem, telemetry optimizer, registry
service, workflow state, daemon, database, or metrics feedback path.

## Approved source-task planning calibration

Benchmark/calibration ID: `AS-JIT-BENCHMARK-2026-08-01-V1`.

Scope: comparable source-task planning only. Compression is **Proposed
comparable human engineering hours / Observed AI wall-clock hours**.

Auditable basis:

- Human numerator: `Proposed` comparable engineering range `2,700–4,200h`;
  midpoint human basis `3,450h`.
- AI denominator: `Observed` current segment `78h44m45s` (`78.7458h`), a
  lower bound.
- Complete-workstream denominator: `Unknown`.

Reproducible calculation, rounded to two decimals: low = `2,700 / 78.7458 =
34.29x`; midpoint = `3,450 / 78.7458 = 43.81x`; high = `4,200 / 78.7458 =
53.34x`. The approved compression range is **34.29x–53.34x**. The midpoint is
exactly **43.81x**; the rounded planning default is exactly **44x**. They are
distinct: use `43.81x` when reporting the benchmark midpoint and `44x` only as
the planning default.

Every AI-hour forecast derived from this calibration is a ROM estimate, never
a commitment or a measured universal rate. An explicitly approved
project-specific calibration may override it only for that project scope.
Apply the applicable calibration only to compressible human-active effort, then
add serial build, test, deploy, browser, model-latency, and operator-wait floors
separately. Do not turn a human schedule into AI-active time without this
bounded planning method.

The numerator remains `Proposed`; the denominator is an `Observed`
current-segment lower bound; and the complete-workstream denominator is
`Unknown`. This is planning calibration only, not labor-efficiency evidence or
a north-star verified delivery-compression result. Metrics remain
downstream-only and never influence execution, routing, authority, or this
calibration.

Adopting, changing, or superseding a benchmark requires an explicit
operator-reviewed, versioned policy release with provenance. Historical metrics
may inform a future release review only; they never update this benchmark
automatically. Until a release is approved, do not infer a replacement from
telemetry, an isolated estimate, or an incomplete workstream.

Invalid, missing, or tampered benchmark integrity blocks only the governed
`benchmark_calibrated_ai_hour_estimate` path. The policy router fails closed for
that path; it does not automatically provide a CLI fallback. The project and
Seat `0` immediately continue through existing native/manual planning with the
calibrated AI-hour value `Unknown` and an explicit coverage warning, without
waiting for Agent System. Any uncalibrated estimate remains clearly labeled ROM;
it is never silently promoted to a calibrated value or a commitment.

With a valid policy load, a calibration that is unavailable or not applicable
also yields calibrated AI-hour value `Unknown` and an explicit coverage warning.
