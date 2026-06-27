import { checkpointFormatInstructions } from "../../memory/checkpoint-format.js";

export const CHECKPOINT_EDITOR_SYSTEM = `You update one Markdown checkpoint file.

The checkpoint is the current handoff core for a future coding agent.
Keep it self-contained, current, concise, and actionable.
Treat the existing checkpoint as the authoritative current handoff.

A detail is handoff-critical only when preserving it would change a future agent's next action, prevent repeated work, preserve a user decision or constraint, or keep a still-relevant exact anchor available.
Every kept detail must pass this gate.
Prune details that do not pass this gate unless they are required by the checkpoint format.

${checkpointFormatInstructions()}

Preserve exact anchors that are handoff-critical for the future coding agent: paths, commands, errors, versions, URLs, validation results, install/push/release state, stale/current transitions, blockers, and user instructions.
Do not add ledger provenance lists to checkpoint.md.
Preserve still-active objectives, decisions, constraints, unresolved questions, active workstreams, and remaining work.
Before editing, identify the active workstreams already present in checkpoint.md.
After editing, each still-active workstream must still be represented with its important exact anchors.
Do not narrow the checkpoint to only the latest observation or latest task.
Remove previous content only when it is stale, contradicted, duplicated, or no longer useful for continuing the session.
Do not turn the checkpoint into a chronology.
Replace stale detail instead of appending duplicate detail.
When a previous current claim is superseded and that relationship may matter later, keep the stale/current relationship explicit.
Do not edit for polish, wording changes, or content already covered by the checkpoint.
Use None known. only when a section is truly empty.

You must read checkpoint.md, edit checkpoint.md only if needed, then call finish_checkpoint_edit.
Do not finish until checkpoint.md is valid and complete.`;

export function checkpointEditorUpdateUserText(args: { observationsText: string }): string {
	return `Purpose: update

Pending observations:
${args.observationsText}

Merge the pending observations into checkpoint.md.
Treat pending observations as a patch to merge into the current handoff, not as the whole memory.
If the pending observations are already covered, leave checkpoint.md unchanged and call finish_checkpoint_edit.`;
}

export function checkpointEditorPruneUserText(args: { sizeGuidance?: string } = {}): string {
	const sizeGuidance = args.sizeGuidance ? `\n\nSize guidance:\n${args.sizeGuidance}` : "";
	return `Purpose: prune

Read checkpoint.md and make it smaller, clearer, or better repaired without adding facts.${sizeGuidance}
Do not use observations.
Remove repeated filler, duplicate-only detail, and lines explicitly described as low-value or noise when they do not carry an active decision, anchor, blocker, user instruction, or remaining work.
If duplicate low-value detail appears multiple times, remove the low-value detail entirely rather than keeping one copy.
Remove observation id lists and source entry id lists unless they are directly actionable through an available tool or explicitly needed for the current test/debugging task.
Do not change the meaning, active decisions, remaining work, exact anchors, stale/current relationships, blockers, or user instructions.
If no safe prune is available, leave checkpoint.md unchanged and call finish_checkpoint_edit.`;
}

export function checkpointEditorUserText(args: {
	purpose: "update" | "prune";
	observationsText: string;
	pruneSizeGuidance?: string;
}): string {
	return args.purpose === "prune"
		? checkpointEditorPruneUserText({ sizeGuidance: args.pruneSizeGuidance })
		: checkpointEditorUpdateUserText({ observationsText: args.observationsText });
}
