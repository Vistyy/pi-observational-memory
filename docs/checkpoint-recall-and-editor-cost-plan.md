# Checkpoint recall and editor cost plan

## Purpose

Keep the checkpoint system focused on fork-ready handoff quality while adding truthful session recall and measuring CheckpointEditor cost before optimizing it.

## Design values

Checkpoint Markdown is the current curated handoff.

Recall is evidence retrieval for prior session context.

Observer is the source-backed compression boundary.

CheckpointEditor is the whole-file handoff editor.

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

CheckpointEditor prompt should keep every checkpoint detail handoff-critical and remove details that do not pass the gate.

The default agent prompt should include an anti-guessing contract:

```text
If an answer depends on prior session context, project state, file contents, tool output, or previous user decisions, and that evidence is not visible, retrieve or verify it before answering.
If retrieval is unavailable or inconclusive, say what is unknown.
Do not fill session-specific gaps from plausibility.
```

## Recall design

Add an explicit v1 tool:

```ts
recall_session({ question: string })
```

The tool searches only the current session.

The tool is read-only.

The tool spawns a Recall agent with private deterministic search and read tools.

The Recall agent searches in this order:

1. current checkpoint
2. checkpoint provenance or observation snapshots when available
3. observations
4. bounded raw session transcript fallback

The Recall agent must end with a typed `finish_recall(...)` tool call.

The runtime validates the typed arguments and constructs the tool result.

No agent should print JSON manually.

V1 result:

```ts
type RecallSessionResult = {
  status: "answered" | "partial" | "uncertain" | "not_found";
  answer: string;
  evidence: Array<{
    source: "checkpoint" | "observation" | "session_entry";
    ref: string;
    quote: string;
  }>;
};
```

Evidence should be compact.

Use at most 3 to 5 evidence items.

Use short quotes only.

Do not dump raw transcript text.

## Observation-based checkpointing

Keep CheckpointEditor input based on observations, not raw source, for normal updates.

The Observer is the compression boundary.

The risk is that CheckpointEditor cannot recover facts the Observer missed.

Mitigate that risk with Observer prompt quality, session-replay evals, and recall raw-transcript fallback.

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

Add eval artifacts for:

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

Compare each variant against baseline on the same eval cases.

Primary metrics:

- total cost
- request count
- input tokens
- output tokens
- cache read tokens
- cache write tokens
- finish retry count
- checkpoint quality pass rate

## Experiment decision criteria

Prefer cadence changes if they reduce cost without making checkpoints stale at handoff boundaries.

Prefer native edit mechanics over custom whole-file replacement tools.

Do not ship successful-edit redaction unless measured cost improves after cache effects.

Do not ship terminal edit tools unless request-count savings justify the added tool surface.

Do not trade away checkpoint quality for small savings.
