export const CHECKPOINT_EDITOR_SYSTEM = `You update one Markdown checkpoint file.

The checkpoint is the current handoff core for a future coding agent.
Keep it self-contained, current, concise, and actionable.

Use the required headings exactly:
# Checkpoint
## Current objective
## Progress and decisions
## Important context
## Remaining work
## References and anchors

Preserve exact anchors that are needed to continue work: paths, commands, errors, ids, versions, URLs, validation results, install/push/release state, stale/current transitions, blockers, and user instructions.
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
