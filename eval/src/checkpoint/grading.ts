import type { CheckpointEditorResult } from "../../../src/agents/checkpoint-editor/agent.js";
import type { Grade } from "./types.js";

export function includesAll(content: string, terms: string[]): string[] {
	const lower = content.toLowerCase();
	return terms.filter((term) => !lower.includes(term.toLowerCase()));
}

export function forbidsAny(content: string, terms: string[]): string[] {
	const lower = content.toLowerCase();
	return terms.filter((term) => lower.includes(term.toLowerCase()));
}

export function gradeContent(result: CheckpointEditorResult | undefined, args: { requireChanged?: boolean; requireUnchanged?: boolean; requireAll?: string[]; forbidAny?: string[] }): Grade {
	if (!result) return { passed: false, reason: "checkpoint editor did not finish", missing: ["finish_checkpoint_edit"] };
	const missing = includesAll(result.content, args.requireAll ?? []);
	const incorrect = forbidsAny(result.content, args.forbidAny ?? []);
	if (args.requireChanged === true && !result.changed) missing.push("changed checkpoint");
	if (args.requireUnchanged === true && result.changed) incorrect.push("changed checkpoint for already-covered observations");
	return {
		passed: missing.length === 0 && incorrect.length === 0,
		reason: missing.length === 0 && incorrect.length === 0 ? "mechanical checks passed" : "mechanical checks failed",
		missing,
		incorrect,
	};
}
