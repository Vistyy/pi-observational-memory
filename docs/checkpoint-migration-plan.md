# Checkpoint migration plan

## Goal

Replace OM's active reflection pool with rolling checkpoints as the primary model-visible memory system.

The target pipeline is:

```text
session records -> observations -> checkpoint
```

The old pipeline is removed:

```text
session records -> observations -> reflections -> maintainer/rewrite
```

The checkpoint must support both forks and main-thread compaction.

## Core artifact

### Checkpoint

A checkpoint is the model-visible handoff core.

It is Markdown.

It is self-contained enough for a future agent or compacted main thread to continue correctly without recall.

It is current-state oriented.

It is not a complete chronology.

It is not a claim graph.

It is not backed by model-facing evidence handles in v1.

Checkpoint ids use `check_<12 hex>`.

Checkpoint ids are metadata for commands, logs, and debug tooling.

Checkpoint ids are not included in the checkpoint Markdown body.

## Checkpoint Markdown template

The required v1 template is:

```md
# Checkpoint

## Current objective

## Progress and decisions

## Important context

## Remaining work

## References and anchors
```

Every required section is always present.

A truly empty section may say `None known.`.

`Progress and decisions` contains completed outcomes, current decisions, and superseded decisions only when needed to prevent confusion.

It must not become a chronology of every attempt, edit, or intermediate failure.

`Important context` contains meaning, constraints, user preferences, and boundaries.

`Remaining work` contains active next work and blockers when they affect next action.

`References and anchors` contains exact handles needed to act.

Examples include paths, files, URLs, commits, ADRs, commands, config keys, versions, package names, validation, release, install, deployment, and exact blocker details.

Optional appendices appear only when `References and anchors` becomes too dense.

A blocker appendix appears only when blockers dominate the handoff.

## Checkpoint update mechanism

Checkpoint updates use a disposable session-scoped Markdown draft file.

The draft can live under `/tmp` or another session-scoped scratch directory.

The draft file is never the durable source of truth.

The session ledger is the durable source of truth.

A single role updates checkpoints:

```text
CheckpointEditor
```

CheckpointEditor always edits an existing `checkpoint.md` draft.

CheckpointEditor receives only these tools:

```text
restricted read
restricted edit
finish_checkpoint_edit
```

The `read` and `edit` tools are restricted to the draft file with guarded operations.

CheckpointEditor must read `checkpoint.md`, edit only that file, and finish by calling `finish_checkpoint_edit` with a short free-text reason.

Normal final prose is not completion.

If the model leaves a valid draft but does not call `finish_checkpoint_edit`, OM runs a finish-only retry that asks it to read the draft and call `finish_checkpoint_edit`.

If `finish_checkpoint_edit` is still not called, OM discards the draft and does not advance coverage.

OM reads the draft after `finish_checkpoint_edit`.

OM compares it to the pre-run draft.

If changed, OM validates the draft and records a full checkpoint snapshot event.

If unchanged during an update run, OM records a coverage advancement event with the finish reason.

The draft is discarded after commit or failure.

## CheckpointEditor purposes

CheckpointEditor has two run purposes:

```ts
purpose: "update" | "prune"
```

### Update

An update run starts from the latest checkpoint or an empty required template.

The prompt includes pending observations since checkpoint coverage.

The editor incorporates the observations into the checkpoint and prunes stale or low-value content as needed.

A changed update records:

```text
om.checkpoint.recorded { mode: "update" }
```

An unchanged update records:

```text
om.checkpoint.coverage_advanced
```

### Prune

A prune run starts from the current checkpoint.

The prompt includes no new observations.

The editor shrinks or repairs the checkpoint without changing its meaning.

A prune records:

```text
om.checkpoint.recorded { mode: "prune" }
```

Prune does not advance checkpoint coverage.

## Checkpoint events

Use two checkpoint event types:

```text
om.checkpoint.recorded
om.checkpoint.coverage_advanced
```

A checkpoint snapshot event conceptually contains:

```ts
{
  type: "om.checkpoint.recorded",
  mode: "update" | "prune",
  checkpoint: Checkpoint,
  coversUpToObservationId: ObservationId,
  observationIds: ObservationId[]
}
```

A coverage-only event conceptually contains:

```ts
{
  type: "om.checkpoint.coverage_advanced",
  coversUpToObservationId: ObservationId,
  observationIds: ObservationId[],
  reason: string
}
```

`observationIds` records the observations consumed by the event.

Observation provenance belongs on checkpoint events, not inside the `Checkpoint` record.

`Checkpoint` contains id, Markdown content, creation time, and content format.

## Coverage model

Coverage cursors are layered.

Observer coverage tracks source entries:

```text
coversUpToSourceEntryId
```

Checkpoint coverage tracks observations:

```text
coversUpToObservationId
```

Failed checkpoint updates do not advance coverage.

Pending observations remain pending after a failed update.

The next update includes old pending observations plus new observations.

## Scheduling

Observer batching is turn-first.

The observer operates on records.

A record is one coverage-advanceable item.

Records include user messages, assistant text messages, complete tool interactions, and abandoned incomplete tool interactions.

A complete tool interaction counts as one record even though it spans a tool call and a tool result.

Non-message source entries such as `custom_message`, `branch_summary`, and `compaction` are excluded from v1 observer records.

They do not count toward observer triggers and are not rendered.

The source cursor may still pass over excluded non-message entries when advancing to later covered messages.

At `turn_end`, run the observer when at least 8 ready records are pending.

At `message_end`, only check the hard cap.

Run the observer mid-turn only when at least 32 ready records are pending.

A mid-turn hard-cap flush must stop at the last safe ready record.

Do not advance through an in-flight unmatched tool call.

If an assistant message has any in-flight unmatched tool call, stop before that assistant message.

If an unmatched tool call is structurally abandoned, treat it as an incomplete interaction record and allow coverage to advance.

A tool call is structurally abandoned when a later user message exists, an assistant abort/error marker exists, or the turn ended without a result.

Checkpoint updates run after non-empty observer output.

Do not run checkpoint update after empty observer output.

Use single-flight checkpoint updates per session.

If an update is in flight and new work arrives, mark another update as requested.

When the current update finishes, immediately rerun if pending observations remain.

This avoids lost wakeups.

## Checkpoint size and pruning

Checkpoint size is controlled by configurable target and maximum token budgets.

A checkpoint over target may still be valid.

A checkpoint over target should schedule async prune for health.

A checkpoint over hard max is invalid for instant compaction.

The updater should prefer replacing stale detail over appending.

The updater should compress within the required template without dropping current actionable anchors.

Prune may run asynchronously for health.

Under compaction pressure, prune may run synchronously before catch-up when the checkpoint is invalid or over hard max and the gap cannot fit in retained tail.

## Compacted context

The checkpoint is the handoff core, not the whole compacted context.

The whole compacted context includes:

```text
stable context
+ checkpoint Markdown
+ Pi-selected recent tail
+ current user request
```

Use Pi's existing compaction summary wrapper.

Do not introduce a checkpoint-specific XML wrapper in v1.

Structured metadata belongs outside the Markdown content.

## Compaction safety

Any handoff core installed by compaction must also be recorded as the current checkpoint.

Generic synchronous compaction outside the checkpoint contract is rejected.

Instant checkpoint compaction is safe only when checkpoint coverage plus retained tail covers the compaction boundary.

If instant checkpoint compaction is unsafe:

```text
1. run synchronous observe catch-up if needed
2. run synchronous checkpoint catch-up from pending observations
3. if checkpoint is bloated or invalid, prune and rerun catch-up
4. if still unsafe, fail visibly
```

Do not return a stale checkpoint as compaction summary.

Do not install a separate generic summary that OM does not record as the current checkpoint.

## Commands

`/om:status` becomes checkpoint health.

It should show checkpoint id, age, coverage, uncheckpointed gap, update-in-flight state, last result or failure, budget state, fallback need, and whether the latest event changed content or only advanced coverage.

`/om:view` shows current checkpoint Markdown with minimal metadata.

A future `/om:diff` or status detail view can show the diff between previous and latest checkpoint snapshots.

## pi-fork integration

Compaction details switch from:

```text
om.folded
```

to:

```text
om.checkpoint
```

pi-fork should be updated to consume `om.checkpoint` rather than preserving `om.folded` compatibility.

pi-fork should stay mostly opaque to OM internals.

## Observer workstream

Observer stays.

Because the checkpoint updater normally receives observations rather than raw source excerpts, observation quality is critical.

Audit the observer source-entry serializer.

Measure what is hidden, especially successful tool output.

Harden observer evals for exact anchors and state transitions.

Known target facts include paths, commands, commit SHAs, tags, versions, URLs, validation output, install/push/release state, stale/current transitions, and user instruction wording.

Observer serialization should join assistant tool calls with matching tool results before rendering.

The joined interaction contains the tool name, status, arguments, and result.

Tool results that cannot be joined may be rendered as degraded standalone results only when needed for migration or corrupted history.

Do not process half of an in-flight tool interaction.

Tool output policies are `omit`, `bounded`, and `full`.

Do not keep legacy policy names such as `metadata-only`, `bounded-excerpt`, or `full-excerpt`.

`omit` renders nothing to the observer while still allowing coverage over the completed record.

`bounded` renders tool/status plus bounded arguments and bounded result.

`full` renders tool/status plus full arguments and full result with no OM serializer truncation.

Completed error interactions always render as `bounded`, regardless of configured policy.

Incomplete interactions render tool/status plus bounded arguments and no result.

Successful tool interactions use the configured policy when present.

If no policy is configured, successful `bash` uses `bounded`.

If no policy is configured, all other successful tools use `omit`.

OM should ship with no built-in successful-tool special cases besides `bash`.

Local config may still opt tools such as `fork` or `subagent` into `full`.

The local settings file should migrate `fork` and `subagent` from `full-excerpt` to `full` when the code change lands.

Bounded result rendering uses all lines when the result has 30 lines or fewer.

For longer results, render the first 10 lines, an omitted-line marker, and the last 20 lines.

Bounded argument rendering uses all lines when the argument summary has 10 lines or fewer.

For longer arguments, render the first 5 lines, an omitted-line marker, and the last 5 lines.

Use the per-line truncation suffix `…[trunc]`, and only add it when it actually saves space.

The observer prompt should say not to infer facts from truncated or omitted portions of rendered tool output.

Only facts supported by visible lines and command/status metadata should be recorded.

The goal is to keep observer cost low while preserving durable signal.

## Eval plan

### Model evals

Keep and harden observer evals.

Add CheckpointEditor evals.

Remove reflector, maintainer, rewrite, and recall evals.

CheckpointEditor eval cases include first checkpoint, rolling update, no-change update, prune, stale/current transition, exact anchor preservation, and remaining-work update without chronology.

### E2E evals

Replay ledger fixtures:

```text
session records -> observations -> checkpoint updates -> final checkpoint
```

Use the audited real failure session and synthetic unrelated domains.

Assert the final checkpoint preserves current objective, current decisions, remaining work, exact anchors, stale/current corrections, and avoids low-value chronology.

### Throughput and pressure evals

Measure operational pressure, not just quality.

Metrics include checkpoint lag in observations, lag in source entries, lag in records, lag in approximate tokens, CheckpointEditor wall time, observer wall time, model tokens, tool calls, rendered record count, omitted record count, update failure rate, prune frequency, backlog growth, and compaction readiness percentage.

Scenarios include normal coding sessions, tool-heavy sessions, burst sessions, long-turn hard-cap pressure, failure pressure, and compaction pressure.

### Serializer evals

Add snapshot tests for observer record construction and rendering.

Cover joined tool calls and tool results, omitted successful tools, bounded successful bash, configured full tools, tool errors, incomplete abandoned tool calls, excluded non-message entries, `turn_end` flushing at 8 records, and `message_end` hard-cap flushing at 32 records.

Use real-session fixtures for release/tag output, repo status output, validation output, fork/subagent reports, and Lavish output omission.

## Removal audit

Migration is not complete until a removal audit eliminates or explicitly justifies all old architecture paths.

Remove active reflections, reflector, maintainer, rewrite, recall, `om.folded`, reflection-oriented commands, reflection-oriented tests, reflection-oriented docs, and reflection-oriented evals.

Do not leave deprecated or dead compatibility paths after the checkpoint path replaces them.

## Main risks and accepted mitigations

### Lost wakeups

Use a requested rerun flag so work that arrives during an in-flight update is processed immediately after the current update finishes.

### CheckpointEditor termination

Require `finish_checkpoint_edit`.

Run a finish-only retry for valid drafts that did not finish.

Discard edited drafts that still never call the finish tool.

### Coverage confusion

Use explicit layered cursor names.

Do not reuse ambiguous `coversUpToId` for checkpoint coverage.

### Compaction safety

Gate compaction on checkpoint coverage plus retained tail.

Catch up synchronously or fail visibly.

### Removal completeness

Use a grep-based removal audit as a final completion gate.

Search terms include reflections, `Reflection`, `ref_`, maintainer, rewrite, recall, `om.folded`, reflector, and active-memory.

## Initial implementation order

1. Add checkpoint data model, ids, validation, and folding.
2. Add observer record construction with tool-call/tool-result joining.
3. Replace tool output policy names with `omit`, `bounded`, and `full`.
4. Implement bounded rendering, omitted successful-tool coverage, error rendering, and incomplete interaction rendering.
5. Change observer triggers to `turn_end` flush at 8 records and `message_end` hard-cap flush at 32 records.
6. Add serializer snapshot tests and observer anchor/state-transition evals.
7. Migrate local settings from `full-excerpt` to `full` for configured high-signal tools.
8. Implement CheckpointEditor with restricted read/edit and finish tool.
9. Replace the memory update pipeline.
10. Replace compaction output with `om.checkpoint`.
11. Redefine `/om:status` and `/om:view`.
12. Update pi-fork.
13. Replace evals.
14. Run removal audit and delete stale code.
