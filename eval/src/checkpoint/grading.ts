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

export function requireAllTerms(content: string, terms: string[]): string[] {
	return includesAll(content, terms);
}

export function forbidTerms(content: string, terms: string[]): string[] {
	return forbidsAny(content, terms);
}

export function requireChanged(result: CheckpointEditorResult | undefined): string[] {
	return result?.changed ? [] : ["changed checkpoint"];
}

export function requireUnchanged(result: CheckpointEditorResult | undefined): string[] {
	return result && !result.changed ? [] : ["unchanged checkpoint"];
}

export function requireShorterThanInitial(result: CheckpointEditorResult | undefined, initialContent: string): string[] {
	if (!result) return ["shorter checkpoint"];
	return result.content.length < initialContent.length ? [] : ["shorter checkpoint"];
}

export function requireNoNewFacts(content: string, forbiddenTerms: string[]): string[] {
	return forbidTerms(content, forbiddenTerms);
}

export function requireSectionPreserved(content: string, terms: string[]): string[] {
	return requireAllTerms(content, terms);
}

export function gradeContent(result: CheckpointEditorResult | undefined, args: { requireChanged?: boolean; requireUnchanged?: boolean; requireAll?: string[]; forbidAny?: string[]; shorterThan?: string }): Grade {
	if (!result) return { passed: false, reason: "checkpoint editor did not finish", missing: ["finish_checkpoint_edit"] };
	const missing = includesAll(result.content, args.requireAll ?? []);
	const incorrect = forbidsAny(result.content, args.forbidAny ?? []);
	if (args.requireChanged === true) missing.push(...requireChanged(result));
	if (args.requireUnchanged === true) incorrect.push(...requireUnchanged(result));
	if (args.shorterThan !== undefined) missing.push(...requireShorterThanInitial(result, args.shorterThan));
	return {
		passed: missing.length === 0 && incorrect.length === 0,
		reason: missing.length === 0 && incorrect.length === 0 ? "mechanical checks passed" : "mechanical checks failed",
		missing,
		incorrect,
	};
}
