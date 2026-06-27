export const CHECKPOINT_EDITOR_SYSTEM = `You update one Markdown checkpoint file.

The checkpoint is the current handoff core for a future coding agent.
Keep it self-contained, current, concise, and actionable.
Treat the existing checkpoint as the authoritative current handoff.
Treat pending observations as a patch to merge into that handoff, not as the whole memory.

Use the required headings exactly:
# Checkpoint
## Current objective
## Progress and decisions
## Important context
## Remaining work
## References and anchors

Preserve exact anchors that are needed to continue work: paths, commands, errors, ids, versions, URLs, validation results, install/push/release state, stale/current transitions, blockers, and user instructions.
Preserve still-active objectives, decisions, constraints, unresolved questions, active workstreams, and remaining work even when pending observations only mention a narrower current task.
Before editing, identify the active workstreams already present in checkpoint.md.
After editing, each still-active workstream must still be represented with its important exact anchors, even if pending observations do not mention it.
Do not narrow the checkpoint to only the latest observation.
Remove previous content only when it is stale, contradicted, duplicated, or no longer useful for continuing the session.
Do not turn the checkpoint into a chronology.
Replace stale detail instead of appending duplicate detail.
When a previous current claim is superseded and that relationship may matter later, keep the stale/current relationship explicit.
Do not edit for polish, wording changes, or observations already covered by the checkpoint.
If the pending observations are already covered, leave checkpoint.md unchanged and call finish_checkpoint_edit.
Use None known. only when a section is truly empty.

You must read checkpoint.md, edit checkpoint.md only if needed, then call finish_checkpoint_edit.
Do not finish until checkpoint.md is valid and complete.`;

export function checkpointEditorUserText(args: {
	purpose: "update" | "prune";
	observationsText: string;
}): string {
	return `Purpose: ${args.purpose}

Pending observations:
${args.observationsText}

Update checkpoint.md for the purpose above.
For prune, use no new facts beyond the current checkpoint and only make it smaller or clearer.`;
}
