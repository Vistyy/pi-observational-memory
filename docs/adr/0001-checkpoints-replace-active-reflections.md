# Checkpoints replace active reflections

OM will replace the active reflection pool with ordered rolling checkpoints as the primary model-visible memory artifact.
A checkpoint is a self-contained handoff core derived from the previous checkpoint plus new observations, while Pi supplies stable context and recent tail when building compacted context.
This avoids the stale-reflection lifecycle, maintainer compression, model-facing recall, and compatibility paths that made the reflection-pool design brittle.

## Considered Options

- Keep active reflections and harden observer, reflector, maintainer, and rewrite.
- Use plain synchronous compaction only.
- Use ordered rolling checkpoints backed by observations and source-ledger provenance.

## Consequences

Checkpoint updates use a `CheckpointEditor` agent that edits a disposable session-scoped Markdown draft with restricted Pi `read` and `edit` tools, then OM validates the result and records a full checkpoint snapshot in the ledger.
The session ledger remains the durable source of truth; the draft file is only an editing surface.
Checkpoint migration must remove or explicitly justify active-reflection, maintainer/rewrite, recall, reflection-oriented command, test, and documentation code.
Compaction details should move to `type: "om.checkpoint"`, and pi-fork should be updated rather than preserving `om.folded` compatibility.
Any handoff core installed into the main thread by compaction must also be recorded as the current checkpoint, or compaction must fail visibly.
