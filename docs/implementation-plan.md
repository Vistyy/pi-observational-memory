# OM roadmap

This file tracks current work only.
Stable architecture lives in `reflection-only-memory-design.md`.
User-facing behavior lives in the README.

## Current architecture

```text
observer -> reflector -> maintainer -> active reflections
                         -> emergency rewrite only under hard pressure
recall -> exact evidence recovery
compaction -> observer tail flush + deterministic render
```

Current invariants:

- Observations are durable evidence.
- Active memory is current reflections only.
- Maintainer is the normal cleanup path.
- Rewrite is an emergency fallback.
- Compaction must stay near-instant.
- Recall is exact-id evidence navigation, not search.

## Implemented

- Additive mode removed.
- Curator, pin/unpin, reviewed markers, follow-up flags, dropped observations, and dropper behavior removed from live runtime/evals.
- Typed ids implemented: `obs_*`, `ref_*`, and typed `sources`.
- Reflection records carry `createdAt`.
- Legacy records normalize only at read boundaries.
- Observer input is source-only and bounded.
- Reflector input is current reflections plus pending observations.
- Maintainer runs as default local cleanup after new-reflection thresholds.
- Rewrite is retained only as a rare over-budget fallback.
- `om.reflections.rewritten` retires refs while preserving recall history.
- Recall traverses typed observation/reflection provenance.
- Recall uses `mode: "evidence" | "provenance"`.
- Recall source rendering is bounded and excludes assistant thinking/tool-call payloads.
- Status includes maintenance/rewrite pressure and usage signals.
- OM compact fork snapshots exist in `pi-fork` via an isolated worker preflight.

## Validation status

Recent known status:

- Extension typecheck and tests are green.
- Full OM eval smoke reached 31/32.
- The remaining known failure was optional observer grader quality, not a hard safety failure.
- Reflector, maintainer, and rewrite stress cases were green in that run.

Treat eval status as moving.
Rerun before prompt or contract changes.

## Next work

1. Dogfood before prompt tuning.
   Prefer observed failures over speculative prompt edits.

2. Keep reflector admission principle simple.
   Record durable future-use facts, not local changelog noise.
   Do not replace this with a fixed taxonomy.

3. Improve status only where dogfooding shows gaps.
   Useful signals are pressure, skip reasons, failures, usage, and pending reflection work.

4. Evaluate compact fork snapshots.
   Compare full vs `om-compact` for cost, latency, exact anchors, stale/current status, and lost nuance.

5. Keep recall hardening evidence-driven.
   Add cases only when real compacted-memory use exposes ambiguity, missing evidence, or unsafe output shape.

## Deferred

- Semantic recall/search for OM agents.
- Tags/topics for maintainer clustering.
- Structured reflection categories.
- Pure-deletion maintenance.
- Making rewrite a normal lifecycle stage.
