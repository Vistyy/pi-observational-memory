# Checkpoint speed, cost, and pruning plan

## Purpose

Keep checkpoints focused on fork-ready handoff quality while making checkpoint updates and pruning fast enough to stay out of the user's way.

Recall is intentionally out of scope.

See [Recall session plan](recall-session-plan.md).

## Design values

Checkpoint Markdown is the current curated handoff.

Observer is the source-backed compression boundary.

CheckpointEditor is the whole-file handoff editor.

Checkpoint updates must preserve handoff-critical facts.

Checkpoint pruning must never make interactive work feel stuck.

The main agent should retrieve or verify evidence instead of guessing about project state, file contents, tool output, prior user decisions, or session history.

## Prompt and instruction changes

Use a sharper gate than `Will the next agent act better because this is preserved?`.

Recommended leading word:

```text
handoff-critical
```

Definition:

```text
A fact is handoff-critical when it would change a future agent's next action, prevent repeated work or a known mistake, preserve a user constraint or preference, explain current state or a decision, or provide an exact anchor needed to act.
```

Observer prompt should record only source-backed, handoff-critical evidence.

CheckpointEditor prompt should keep every checkpoint detail that is handoff-critical and remove details that do not pass the gate.

The default agent prompt should include an anti-guessing contract:

```text
If an answer depends on prior session context, project state, file contents, tool output, or previous user decisions, and that evidence is not visible, retrieve or verify it before answering.
If retrieval is unavailable or inconclusive, say what is unknown.
Do not fill session-specific gaps from plausibility.
```

## Current prune latency problem

Checkpoint prune can trigger during interactive work, including fork spawning.

A large checkpoint prune was observed taking longer than a minute before being abandoned.

That is not acceptable for an interactive path.

Current pruning appears to use the same CheckpointEditor loop as normal checkpoint editing.

That means a large prune can require model calls, whole-file reads, exact-span edits, and a final finish call.

If the model performs several edits, later requests can carry large prior edit arguments.

This makes prune latency and request count a first-class performance problem, not only a token-cost problem.

## Prune performance acceptance criteria

Add these criteria before optimizing the implementation:

- Health prune must not block fork spawning or other interactive work for more than a small fixed budget.
- Compaction-pressure prune must have a hard timeout or deterministic fallback.
- Large-checkpoint prune evals must record wall time, request count, token usage, and CheckpointEditor tool metrics.
- A prune that cannot finish inside the budget must fail safely and leave the previous checkpoint intact.
- Prune must preserve handoff-critical facts.
- Prune must remove stale, duplicate, or non-handoff-critical detail.

Suggested initial latency budgets:

- health prune during normal turn-end work: skip or defer if it cannot start safely
- fork-triggered or interactive pressure path: target under 5 seconds, hard stop under 10 seconds
- offline eval path: measure full quality and cost without the interactive timeout

These numbers are starting points.

They should be adjusted after a real large-checkpoint benchmark exists.

## Missing eval coverage

Existing prune evals cover basic behavior on small synthetic checkpoints.

They do not prove that pruning a large checkpoint is fast enough.

Add a large-checkpoint prune eval before changing pruning behavior.

The eval should include:

- a checkpoint above the normal prune target
- a checkpoint above the hard max target
- enough sections and repeated stale detail to resemble real bloat
- handoff-critical details that must survive
- stale details that must be removed
- duration metrics
- CheckpointEditor read calls
- CheckpointEditor edit calls
- successful and failed edit calls
- total edit `oldText` chars
- total edit `newText` chars
- finish calls
- finish retry count
- total cost
- request count
- input tokens
- output tokens
- cache read tokens
- cache write tokens

The eval should fail if pruning destroys required handoff facts.

The eval should separately report whether it exceeded the interactive latency budget.

## CheckpointEditor cost question

The current cost concern is request count more than per-request size.

Observer usually completes in one request.

CheckpointEditor often uses `read -> edit -> finish_checkpoint_edit`.

If it makes multiple edits, each later request carries prior edit tool-call arguments.

Successful edit arguments may include large `oldText` and `newText` payloads.

A naive redaction transform may reduce input tokens but can reduce prompt-cache reuse.

We need measured cost, not guesses.

## Cost experiment plan

Phase 1 is measurement only.

Do not change CheckpointEditor behavior yet.

Add or verify eval artifacts for:

- session-replay usage records
- usage summary by agent
- usage summary by operation
- CheckpointEditor read calls
- CheckpointEditor edit calls
- successful and failed edit calls
- total edit `oldText` chars
- total edit `newText` chars
- finish calls
- finish retry count
- wall-clock duration by checkpoint operation

Run baseline evals and compare actual cost fields, not just token totals.

Phase 2 tests one behavior change at a time.

The first scheduling change is:

```text
Run CheckpointEditor update only when uncheckpointed observations >= 8 or their source span >= 32 records.
```

Observer still runs on its existing source-record thresholds.

Forced catch-up before compaction remains unchanged.

Candidate later variants:

1. compact successful edit tool-call arguments before the next model request
2. add a native-feeling terminal `edit_and_finish` tool if measurement shows the finish request is still pure waste
3. add a deterministic emergency prune fallback for interactive pressure paths
4. move health prune out of fork-spawn critical paths

Compare each variant against baseline on the same eval cases.

## Experiment decision criteria

Prefer cadence changes if they reduce cost without making checkpoints stale at handoff boundaries.

Prefer native edit mechanics over custom whole-file replacement tools.

Do not ship successful-edit redaction unless measured cost improves after cache effects.

Do not ship terminal edit tools unless request-count savings justify the added tool surface.

Do not let health prune block interactive work.

Do not trade away checkpoint quality for small savings.

## Recommended implementation order

1. Add a red-capable large-checkpoint prune performance eval.
2. Verify current baseline metrics for update, prune, and session replay.
3. Add prompt gate updates if they are not already present.
4. Add or verify checkpoint cadence thresholds.
5. Make health prune defer, skip, or time out in interactive paths.
6. Only then test edit-history redaction or terminal edit variants.
