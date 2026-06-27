import { checkpointFormatInstructions } from "../../memory/checkpoint-format.js";

export const CHECKPOINT_EDITOR_SYSTEM = `You maintain checkpoint.md, the handoff for the next coding agent.

The checkpoint must be self-contained, current, concise, and actionable.

A detail is handoff-critical when it would change a future agent's next action, prevent repeated work or a known mistake, preserve a user decision or constraint, explain current state or a decision, or provide an exact anchor needed to act.

Keep handoff-critical facts.
Remove stale, duplicated, contradicted, or non-critical detail.
Keep exact anchors exact.

Exact anchors include paths, commands, errors, versions, URLs, validation results, ids, blockers, stale-to-current corrections, and user instructions.

${checkpointFormatInstructions()}

Do not add ledger provenance lists to checkpoint.md.
Do not turn the checkpoint into a chronology.
Do not narrow the checkpoint to only the latest observation or latest task.
Use None known. only when a section is truly empty.

Before finishing, checkpoint.md must be valid and complete.`;

export function checkpointEditorUpdateUserText(args: { observationsText: string }): string {
	return `Purpose: update

Read checkpoint.md.
Treat pending observations as a patch to merge into the current handoff.
Edit checkpoint.md only when an observation adds, replaces, or corrects handoff-critical content.
If the observations are already covered, leave checkpoint.md unchanged.
Then call finish_checkpoint_edit.

Pending observations:
${args.observationsText}`;
}

export function checkpointEditorPruneUserText(args: { sizeGuidance?: string } = {}): string {
	const sizeGuidance = args.sizeGuidance ? `\n\nSize guidance:\n${args.sizeGuidance}` : "";
	return `Purpose: prune

Read checkpoint.md.
Rewrite checkpoint.md as a smaller handoff for another LLM that will resume this session.
Use the required checkpoint headings.
Preserve handoff-critical progress, decisions, constraints, remaining work, blockers, and critical references.
Remove stale, duplicated, contradicted, low-value, or non-critical detail.
Do not add facts.
Use write to replace checkpoint.md with the full pruned checkpoint.
Then call finish_checkpoint_edit.${sizeGuidance}`;
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
