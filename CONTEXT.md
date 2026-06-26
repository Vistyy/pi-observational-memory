# Observational Memory Context

## Glossary

### Observe

The normal memory pipeline step that extracts noticed facts from noisy session evidence.
It stays close to source evidence and does not decide the checkpoint lifecycle.

### Observation

A noticed fact extracted from source evidence.
Observations are the input to checkpoint updates, not the active handoff memory shown to future agents.
Observations should preserve exact anchors and state transitions when those are future-useful, including commands, paths, config keys, package or API names, commit SHAs, tags, versions, URLs, error messages, validation outputs, install, push, release state, stale/current transitions, and user instruction wording.
The default checkpoint updater input should include observations and source ids, not raw source excerpts.
Source excerpts are fallback material for audits, debugging, and eval failure analysis.

### Source entry

A raw session-ledger entry that provides provenance for observations.

### Observer record

A record is one coverage-advanceable item for observer batching.
Records include user messages, assistant text messages, complete tool interactions, and abandoned incomplete tool interactions.
A complete tool interaction joins an assistant tool call with its matching tool result and counts as one record.
Non-message source entries such as `custom_message`, `branch_summary`, and `compaction` are excluded from v1 observer records.
Excluded non-message entries are not rendered and do not count toward observer triggers, but the source cursor may pass them when advancing to later covered messages.

### Tool interaction rendering

Observer serialization should join assistant tool calls with matching tool results before rendering.
The joined interaction contains tool name, status, arguments, and result.
Do not process half of an in-flight tool interaction.
If an assistant message has any in-flight unmatched tool call, observer coverage stops before that assistant message.
If an unmatched tool call is structurally abandoned, render it as an incomplete interaction record and allow coverage to advance.
A tool call is structurally abandoned when a later user message exists, an assistant abort/error marker exists, or the turn ended without a result.
Incomplete interactions render tool/status plus bounded arguments and no result.
Completed error interactions always render as `bounded`, regardless of configured policy.
Successful tool interactions use the configured policy when present.
If no policy is configured, successful `bash` uses `bounded`.
If no policy is configured, all other successful tools use `omit`.
OM should ship with no built-in successful-tool special cases besides `bash`.

### Tool output policies

Tool output policies are `omit`, `bounded`, and `full`.
Legacy policy names such as `metadata-only`, `bounded-excerpt`, and `full-excerpt` should be removed rather than kept as aliases.
`omit` renders nothing to the observer while still allowing coverage over the completed record.
`bounded` renders tool/status plus bounded arguments and bounded result.
`full` renders tool/status plus full arguments and full result with no OM serializer truncation.
Bounded result rendering uses all lines when the result has 30 lines or fewer.
For longer results, render the first 10 lines, an omitted-line marker, and the last 20 lines.
Bounded argument rendering uses all lines when the argument summary has 10 lines or fewer.
For longer arguments, render the first 5 lines, an omitted-line marker, and the last 5 lines.
Use the per-line truncation suffix `…[trunc]`, and only add it when it actually saves space.
The observer prompt should say not to infer facts from omitted output.
Only facts supported by visible lines and command/status metadata should be recorded.
Local config may opt tools such as `fork` or `subagent` into `full`.
The local settings file should migrate `fork` and `subagent` from `full-excerpt` to `full` when the code change lands.

### Observer scheduling

Observer batching is turn-first.
At `turn_end`, run the observer when at least 8 ready records are pending.
At `message_end`, only check the hard cap.
Run the observer mid-turn only when at least 32 ready records are pending.
A mid-turn hard-cap flush must stop at the last safe ready record.
Do not advance through an in-flight unmatched tool call.
Checkpoint updates run after non-empty observer output.
Do not run checkpoint updates after empty observer output.

### Checkpoint

The primary model-visible session memory artifact.
It is the handoff core needed by a future agent, fork, or compacted main thread.
It must be self-contained enough for a future agent or compacted main thread to continue correctly without recall.
It should be current-state oriented and structured enough to make omissions visible.
A `Checkpoint` record is the portable handoff artifact: id, Markdown content, creation time, and content format.
Checkpoint ids use `check_<12 hex>` and are separate from ledger entry ids.
Checkpoint ids are metadata for `/om:view`, `/om:status`, logs, and debug tooling, not part of the checkpoint Markdown body.

### Checkpoint template

Checkpoint content is stored as Markdown for human/model handoff readability.
The required v1 template is:

```md
# Checkpoint

## Current objective

## Progress and decisions

## Important context

## Remaining work

## References and anchors
```

Required checkpoint sections should always be present, with `None known.` allowed when a section is truly empty.
Progress and decisions should contain current-state progress: completed outcomes, current decisions, and superseded decisions only when needed to prevent confusion.
Progress and decisions should not become a chronology of every attempt, edit, or intermediate failure.
Important context contains meaning, constraints, user preferences, and boundaries.
Remaining work contains active next work, including blockers when they affect next action.
References and anchors contain exact handles needed to act, such as paths, files, URLs, commits, ADRs, commands, config keys, versions, package names, validation, release, install, deployment, and exact blocker details.
Optional appendices should appear only when references and anchors becomes too dense.
A blocker appendix should appear only when blockers dominate the handoff.
Model-facing checkpoint rendering should use the plain checkpoint Markdown content and Pi's existing compaction summary wrapper when applicable, rather than introducing a checkpoint-specific XML wrapper in v1.
Structured metadata such as id, coverage, event provenance, and content format belongs outside the Markdown content.
TOON or other compact structured formats may be considered later for metadata or token experiments, but not as the v1 checkpoint content format.

### Update checkpoint

The normal memory pipeline step that produces the next checkpoint from observations.
It replaces the active reflection-pool path as the primary memory update mechanism.
Checkpoint updates are ordered rolling updates: previous checkpoint plus new observations produces the next full checkpoint snapshot.
Each checkpoint event stores a full snapshot, but the updater derives that snapshot from the previous checkpoint plus new observations, not from the full raw session.
No-change checkpoint updates persist coverage advancement with a separate coverage event rather than a null checkpoint snapshot.
No-change coverage events include a short free-text reason for status/debug use, such as transient implementation detail, user acknowledgement with no state change, or observations confirming already-captured state.

### CheckpointEditor

The single agent role that updates checkpoint Markdown.
CheckpointEditor always edits an existing session-scoped draft file with Pi's real `read` and `edit` tools plus a terminal `finish_checkpoint_edit` tool.
The `read` and `edit` tools should be restricted to the draft file with guarded operations.
The draft file is disposable and is never the durable source of truth.
The session ledger remains the durable source of truth.
For update runs, the draft starts as the latest checkpoint or an empty required template, and the prompt includes pending observations.
For prune runs, the draft starts as the current checkpoint, and the prompt includes no new observations.
CheckpointEditor should read `checkpoint.md`, edit only that draft file, and change only the spans needed to keep the checkpoint self-contained, current, concise, and valid.
CheckpointEditor must finish by calling a terminal `finish_checkpoint_edit` tool with a short free-text reason.
OM should ignore normal final prose as completion; if the model edits the draft but does not call the finish tool, the agent loop should prompt it to finish or fail after bounded retries.
After CheckpointEditor finishes, OM reads the draft, compares it to the pre-run draft, validates it when changed, and commits a full checkpoint snapshot event or a coverage advancement event.
The draft is discarded after commit or failure.

### Checkpoint pruning

Checkpoint pruning is a CheckpointEditor run with purpose `prune`.
Pruning input is strictly the current checkpoint only, with no new observations.
Pruning output is a smaller checkpoint using the same template.
Pruning may remove stale or duplicative prose, merge redundant lines, shorten references, and move dense detail into concise anchors.
Pruning must preserve the current objective, remaining work, current decisions, current constraints or preferences, and actionable references or anchors.
Checkpoint pruning may run asynchronously for health when a checkpoint exceeds the target budget.
Under compaction pressure, if the checkpoint is invalid or over the hard max and the gap cannot fit in retained tail, pruning may run synchronously before normal checkpoint catch-up.
Pruning records a normal `om.checkpoint.recorded` snapshot event with `mode: "prune"`, unchanged checkpoint coverage, and empty `observationIds`.

### Checkpoint size

Because rolling checkpoints update from the previous checkpoint rather than from the full raw session, the updater is responsible for pruning stale or low-value content during each update.
Checkpoint size should be controlled by configurable target and maximum token budgets.
The updater should prefer replacing stale detail over appending.
The updater should compress within the required template without dropping current actionable anchors.

### Checkpoint events

Checkpoint snapshot events use `mode: "update" | "prune"`.
`update` covers both initial checkpoint creation and normal rolling updates from observations.
Checkpoint coverage advancement events do not need a mode because the event type is already specific.
Observation provenance belongs on checkpoint events as `observationIds`, not inside the `Checkpoint` record.
`observationIds` records the observations consumed by the event.
`om.checkpoint.recorded` stores a full checkpoint snapshot plus `coversUpToObservationId`.
`om.checkpoint.coverage_advanced` stores `coversUpToObservationId`, `observationIds`, and a short free-text reason.

### Compacted context

The whole model context installed for a fork or compacted main thread.
The checkpoint is the handoff core, not the whole compacted context.
The whole compacted context also includes stable context and Pi-selected recent tail.

### Coverage

Coverage records which lower-level inputs have already been processed by the next memory layer.
Coverage cursors are layered: observer coverage tracks source entries with `coversUpToSourceEntryId`, while checkpoint coverage tracks observations with `coversUpToObservationId`.
OM can expose source-entry gap metadata for Pi context packing, but the primary checkpoint coverage cursor is observation coverage because the checkpoint updater processes observations.
Derived checkpoint coverage comes from the latest checkpoint snapshot event or latest coverage-advanced event.
Freshness is coverage-gap fit: OM exposes checkpoint coverage and gap metadata, while Pi's context packer decides whether checkpoint plus recent tail or uncheckpointed context covers the gap.
Instant checkpoint compaction is safe only when all uncheckpointed observations are still inside the retained tail, or when checkpoint coverage plus retained tail covers the compaction boundary.
If instant checkpoint compaction is unsafe, compaction must first run synchronous observe catch-up if needed, then synchronous checkpoint catch-up from pending observations.
If rolling checkpoint catch-up cannot produce a valid checkpoint because the previous checkpoint is bloated or invalid, recovery should prune the previous checkpoint into a smaller valid checkpoint and then rerun normal checkpoint catch-up with pending observations.
The normal checkpoint updater remains the path that incorporates observations.
Generic synchronous compaction outside the checkpoint contract should not be used as an automatic fallback because it would split main-thread memory from OM checkpoint state.
Any handoff core installed into the main thread by compaction must also be recorded as the current checkpoint, or compaction must fail visibly.
OM should avoid semantic freshness judgments such as model confidence or required-observation checks.

### Checkpoint provenance

Checkpoint event provenance is for debugging and auditing why a checkpoint version changed.
It is not a model-facing navigation path.
Source ids, checkpoint event `observationIds`, checkpoint versions, and the session ledger remain available for offline/debug provenance.
V1 should not include model-visible evidence handles or model-facing recall in checkpoint Markdown.
Recall should be removed when the checkpoint architecture replaces active reflections, rather than kept as deprecated or dead code.

### Checkpoint commands

`/om:status` should report checkpoint health, including checkpoint id, age, coverage, uncheckpointed gap, update-in-flight state, last update result, fallback need, and whether the latest checkpoint changed content or only advanced coverage.
`/om:view` should show the current model-visible checkpoint content with minimal metadata.
Checkpoint snapshot events should retain at least the previous checkpoint snapshot so the last content diff can be computed as previous checkpoint content versus latest checkpoint content.
A future `/om:diff` or status detail view can expose that diff without adding another checkpoint data model.

### Migration boundary

The checkpoint architecture replaces active reflections as the primary OM memory model.
Checkpoint migration is not complete until a removal audit eliminates or explicitly justifies all active-reflection, maintainer/rewrite, recall, reflection-oriented command, test, and documentation code.
Deprecated or dead compatibility paths should not remain after the new checkpoint path replaces them.
Compaction details should switch cleanly to `type: "om.checkpoint"` with checkpoint and checkpoint coverage payloads.
Pi-fork should be updated to consume `om.checkpoint` rather than preserving `om.folded` compatibility.
