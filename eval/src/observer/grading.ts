import type { Observation } from "../../../src/session-ledger/index.js";
import type { ObserverEvalRecord, ObserverGrader, ObserverScoreDimension } from "./types.js";

const MIN_SCORED_PASS_RATIO = 0.5;

export function optional(grader: ObserverGrader): ObserverGrader {
	return { ...grader, required: false };
}

export function observerText(output: Observation[] | undefined): string {
	return (output ?? []).map((observation) => observation.content).join("\n");
}

export function observerSourceIds(output: Observation[] | undefined): string[] {
	return (output ?? []).flatMap((observation) => observation.sourceEntryIds);
}

export function observerRequiresAll(...needles: string[]): ObserverGrader {
	return {
		label: `requires ${needles.join(", ")}`,
		pass: (output) => needles.every((needle) => observerText(output).includes(needle)),
		detail: observerText,
	};
}

export function observerForbidsAny(...needles: string[]): ObserverGrader {
	return {
		label: `forbids ${needles.join(", ")}`,
		pass: (output) => needles.every((needle) => !observerText(output).includes(needle)),
		detail: observerText,
	};
}

export function observerMaxCount(max: number): ObserverGrader {
	return {
		label: `at most ${max} observations`,
		pass: (output) => (output ?? []).length <= max,
		detail: (output) => ({ count: (output ?? []).length }),
	};
}

export function observerForbidsSourceIds(...ids: string[]): ObserverGrader {
	return {
		label: `forbids source ids ${ids.join(", ")}`,
		pass: (output) => ids.every((id) => !observerSourceIds(output).includes(id)),
		detail: observerSourceIds,
	};
}

export function observerSourceIdsAllowed(allowedIds: string[]): ObserverGrader {
	const allowed = new Set(allowedIds);
	return {
		label: `source ids limited to ${allowedIds.join(", ")}`,
		pass: (output) => observerSourceIds(output).every((id) => allowed.has(id)),
		detail: observerSourceIds,
	};
}

export function gradeObserverOutput(args: {
	id: string;
	iteration: number;
	output: Observation[] | undefined;
	started: number;
	agentDurationMs?: number;
	usage: ObserverEvalRecord["usage"];
	graders: ObserverGrader[];
	diagnostics?: Record<string, unknown>;
	error?: string;
}): ObserverEvalRecord {
	const outputFailureLabel = args.error ? `Provider error: ${args.error}` : "No record_observations tool call";
	const graders = args.output === undefined
		? [{ label: outputFailureLabel, required: true, pass: () => false }, ...args.graders]
		: args.graders;
	const dimensions: ObserverScoreDimension[] = graders.map((grader) => {
		const passed = grader.pass(args.output);
		const required = grader.required !== false;
		return { label: grader.label, required, passed, detail: grader.detail?.(args.output) ?? args.output };
	});
	const failedRequired = dimensions.filter((dimension) => dimension.required && !dimension.passed);
	const optionalDimensions = dimensions.filter((dimension) => !dimension.required);
	const score = optionalDimensions.filter((dimension) => dimension.passed).length;
	const maxScore = optionalDimensions.length;
	const scoreFailure = failedRequired.length === 0 && maxScore > 0 && score / maxScore < MIN_SCORED_PASS_RATIO;
	const missing = failedRequired.map((dimension) => dimension.label);
	const incorrect = scoreFailure ? [`optional grader score below threshold: ${score}/${maxScore}`] : [];
	const passed = failedRequired.length === 0 && !scoreFailure;
	return {
		id: args.id,
		iteration: args.iteration,
		passed,
		reason: passed ? "observer checks passed" : "observer checks failed",
		output: args.output ?? [],
		missing,
		incorrect,
		durationMs: Date.now() - args.started,
		agentDurationMs: args.agentDurationMs,
		usage: args.usage,
		score: { hardFailed: failedRequired.length > 0, score, maxScore, dimensions },
		diagnostics: args.diagnostics,
		error: args.error,
	};
}
