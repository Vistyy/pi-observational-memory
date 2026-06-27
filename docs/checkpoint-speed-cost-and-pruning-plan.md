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

Add large-checkpoint prune evals before changing pruning behavior.

Add two diagnostic evals:

1. `checkpoint-prune-large-synthetic-diagnostic`
2. `checkpoint-prune-real-latest-diagnostic`

The synthetic eval should use a controlled 12k to 16k token checkpoint.

It should be mixed.

It should include duplicate junk, many similar but not identical facts, repeated stale bloat, and handoff-critical anchors that must survive.

The real-latest eval should load the latest checkpoint from the local session fixture:

```text
/home/syzom/.pi/agent/sessions/--home-syzom-.pi-agent--/2026-06-25T13-09-04-858Z_019efee5-f8da-7fe4-a4a8-91009462be14.jsonl
```

Do not commit the real checkpoint content as a fixture.

Load it from the local JSONL session file at eval runtime.

The referenced latest checkpoint is suitable because it is roughly 34k chars and above the default hard max by rough token estimate.

Both evals should include:

- a checkpoint above the normal prune target
- a checkpoint above the hard max target
- enough sections and repeated stale detail to resemble real bloat
- handoff-critical details that must survive
- stale details that must be removed
- duration metrics
- per-request duration metrics, using existing provider request usage where available
- request context size estimates, adding them to eval artifacts if they are only debug logs today
- CheckpointEditor read calls
- CheckpointEditor edit calls
- successful and failed edit calls
- edit failure reason counts, adding them if only aggregate failed edit calls exist today
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

The synthetic evals should fail if pruning destroys required handoff facts.

The real-latest evals should use light checks only, because they should not hardcode private session content into the eval.

The real-latest checks should require a valid checkpoint, required headings, clear shrinkage, and only safe structural anchors if needed.

The evals should require a clear checkpoint size reduction, but they should not initially require pruning below the normal target or hard max.

The first diagnostic run should compare several prompt guidance variants on both the synthetic fixture and the real-latest fixture:

1. no extra size guidance, using the current prune prompt as the baseline
2. soft shrink guidance, aiming for at least 25% smaller while making preservation of handoff-critical facts more important than hitting the target
3. soft budget guidance, aiming for the normal 4k token checkpoint target while making preservation of handoff-critical facts more important than hitting the budget

This produces six initial diagnostic cases.

Include these cases in the normal checkpoint eval set.

Run each case once at first.

Use the same model and thinking configuration as normal CheckpointEditor runs.

Repeat later only if the first results look noisy.

The guided variants must stay eval variants until they prove they improve shrink quality without losing important facts.

The evals should be diagnostic-only for latency at first.

They should report whether pruning exceeded the interactive latency budget, but they should not fail on latency until a baseline has been measured and an explicit budget has been chosen.

The eval report should include a compact diagnostic table with:

- case id
- fixture type
- prompt variant
- duration
- request count
- shrink percentage
- failed edit count
- total edit `oldText` chars
- total edit `newText` chars

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

## Codex compaction lessons

OpenAI Codex treats compaction as a durable history replacement, not as an edit to old history.

The important lesson is the shape:

```text
compaction = replacement snapshot + later tail replay
```

Codex creates a compacted history snapshot, installs it as live history, persists it, and later resume or fork rebuilds from the newest surviving snapshot plus later items.

Relevant Codex files at the time of analysis:

- `codex-rs/core/src/compact.rs`
- `codex-rs/core/src/compact_remote.rs`
- `codex-rs/core/src/compact_remote_v2.rs`
- `codex-rs/core/src/compact_token_budget.rs`
- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/src/session/mod.rs`
- `codex-rs/core/src/session/rollout_reconstruction.rs`
- `codex-rs/core/src/state/auto_compact_window.rs`
- `codex-rs/prompts/templates/compact/prompt.md`
- `codex-rs/prompts/templates/compact/summary_prefix.md`
- `codex-rs/protocol/src/protocol.rs`

Codex local compaction asks the model for a handoff summary, prefixes it, keeps a bounded set of recent user messages, and stores the summary as a user message in replacement history.

Codex remote compaction gets compacted history from the model or compact endpoint, filters unsafe or stale message kinds, then installs the filtered replacement history.

Codex persists a `CompactedItem` with `replacement_history`, `window_number`, `first_window_id`, `previous_window_id`, and `window_id`.

Codex resume and fork reconstruction scans the rollout newest to oldest, finds the newest surviving `replacement_history`, and replays only the later tail.

That is the fork-safety part worth copying conceptually.

For this project, compaction should not depend on slow CheckpointEditor pruning.

Checkpoint pruning should improve the future checkpoint, not gate compaction unless there is no safe alternative.

Pi already handles the ledger tail after compaction, so this project does not need to rebuild Codex tail replay itself.

The main thing to copy is the compaction handoff message shape.

Codex frames compaction as a handoff summary for another LLM that will resume the task.

Our compaction message should get closer to that framing while using the current checkpoint as the source.

The compaction handoff should say, in effect:

```text
This is a checkpoint handoff for the next LLM.
Use it to resume without repeating work.
It contains current progress, decisions, constraints, next steps, and critical references.
```

Do not generate a second summary from scratch when a checkpoint already exists.

Render the current checkpoint as the handoff message.

If the checkpoint is oversized, a stale or large checkpoint is still better than blocking compaction on a slow prune.

The likely long-term shape is:

1. use the current checkpoint as the compaction handoff snapshot
2. rely on Pi's existing compaction tail replay for later ledger entries
3. run checkpoint pruning separately in the background
4. use the smaller checkpoint later if pruning finishes safely

Do not copy Codex blindly.

Codex inline compaction can still block the turn.

Codex remote compaction depends on platform-specific response item types and endpoint behavior.

The useful idea is the durable replacement snapshot and tail replay model.

## Recommended implementation order

1. Add red-capable synthetic and real-latest large-checkpoint editor-prune diagnostic evals.
2. Add missing diagnostic metrics needed to explain editor-prune slowness.
3. Run those evals before adding compaction or fork lifecycle evals.
4. Verify current baseline metrics for update, prune, and session replay.
5. Add prompt gate updates if they are not already present.
6. Add or verify checkpoint cadence thresholds.
7. Make health prune run in the background instead of blocking interactive paths.
8. Only then test edit-history redaction, deterministic fallback, or terminal edit variants.
