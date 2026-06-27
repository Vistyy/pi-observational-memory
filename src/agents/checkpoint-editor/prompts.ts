import { checkpointFormatInstructions } from "../../memory/checkpoint-format.js";

export const CHECKPOINT_EDITOR_SYSTEM = `You maintain checkpoint.md as a concise routing handoff for the next agent.

Keep only what helps continuation: focus, current state, next actions, references, and suggested tools or skills.

Do not duplicate durable artifacts.
Reference plans, ADRs, issues, commits, diffs, files, and URLs by path or URL plus why they matter.

Redact secrets and private data.
Keep exact paths, commands, errors, ids, versions, URLs, and user instructions exact.

Remove stale, duplicated, contradicted, speculative, or low-value detail.

${checkpointFormatInstructions()}

Use None known. only when a required section is empty.
Before finishing, checkpoint.md must be valid and complete.`;

export function checkpointEditorUpdateUserText(args: { observationsText: string }): string {
	return `Purpose: update

Read checkpoint.md.
Merge pending observations into the current handoff.
Use edit for small local changes.
Use write with the full checkpoint for schema migration, invalid checkpoints, exact-edit trouble, or broad restructuring.
If already covered, leave checkpoint.md unchanged.
Then call finish_checkpoint_edit.

Pending observations:
${args.observationsText}`;
}

export function checkpointEditorPruneUserText(args: { sizeGuidance?: string } = {}): string {
	const sizeGuidance = args.sizeGuidance ? `\n\nSize guidance:\n${args.sizeGuidance}` : "";
	return `Purpose: prune

Read checkpoint.md.
Write a smaller routing handoff for the next agent.
Keep focus, current state, next actions, references, and useful suggested tools or skills.
Reference durable artifacts instead of copying them.
Redact secrets and private data.
Remove stale, duplicated, contradicted, speculative, or low-value detail.
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
