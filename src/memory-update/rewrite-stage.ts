import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runRewrite } from "../agents/rewrite/agent.js";
import { debugLog } from "../debug-log.js";
import type { Runtime } from "../runtime.js";
import {
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_REWRITTEN,
	buildReflectionsRecordedData,
	buildReflectionsRewrittenData,
	foldLedger,
	reflectionTokenSum,
	type Entry,
	type Reflection,
} from "../session-ledger/index.js";
import { commonAgentArgs } from "./agent-args.js";
import type { MemoryUpdateCtx, ResolveMemoryModel, StageOutcome } from "./types.js";

const MIN_REWRITE_REFLECTIONS = 5;

function sameIds(a: Set<string> | undefined, b: string[]): boolean {
	return !!a && a.size === b.length && b.every((id) => a.has(id));
}

function isUsefulEmergencyRewrite(resultReflections: Reflection[], activeReflectionIds: string[], activeTokens: number, maxTokens: number): boolean {
	const activeIds = new Set(activeReflectionIds);
	const resultTokens = reflectionTokenSum(resultReflections);
	return (
		resultReflections.length > 0 &&
		resultTokens < activeTokens &&
		resultTokens < maxTokens &&
		resultReflections.every((reflection) => (
			!activeIds.has(reflection.id) &&
			reflection.sources.length > 0 &&
			reflection.sources.every((source) => activeIds.has(source))
		))
	);
}

export async function runRewriteStage(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: MemoryUpdateCtx,
	resolveModel: ResolveMemoryModel,
): Promise<StageOutcome> {
	const entries = ctx.sessionManager.getBranch() as Entry[];
	const folded = foldLedger(entries);
	const activeTokens = reflectionTokenSum(folded.reflections);
	if (folded.reflections.length < MIN_REWRITE_REFLECTIONS || activeTokens < runtime.config.reflectionsPoolMaxTokens) {
		runtime.lastRewriteSkip = { reason: "below_threshold", reflectionCount: folded.reflections.length, activeTokens, maxTokens: runtime.config.reflectionsPoolMaxTokens };
		debugLog("rewrite.skip", { reason: "below_threshold", reflectionCount: folded.reflections.length, activeTokens, reflectionsPoolMaxTokens: runtime.config.reflectionsPoolMaxTokens });
		return "continue";
	}

	const activeReflectionIds = folded.reflections.map((reflection) => reflection.id);
	if (sameIds(runtime.rewriteSkippedActiveIds, activeReflectionIds)) {
		runtime.lastRewriteSkip = { reason: "unchanged_after_noop", reflectionCount: folded.reflections.length, activeTokens, maxTokens: runtime.config.reflectionsPoolMaxTokens };
		debugLog("rewrite.skip", { reason: "unchanged_after_noop", reflectionCount: folded.reflections.length, activeTokens });
		return "continue";
	}

	if (ctx.hasUI) ctx.ui?.notify(`Observational memory: rewrite running (${folded.reflections.length.toLocaleString()} reflections, ~${activeTokens.toLocaleString()} tokens)`, "info");
	const resolved = await resolveModel("rewrite");
	if (!resolved) return "abort";

	let result;
	try {
		result = await runRewrite({
			...commonAgentArgs(pi, runtime, resolved, runtime.config.rewriteThinking),
			reflections: folded.reflections,
		});
	} catch (error) {
		runtime.rewriteSkippedActiveIds = new Set(activeReflectionIds);
		throw error;
	}
	if (!result || !isUsefulEmergencyRewrite(result.reflections, activeReflectionIds, activeTokens, runtime.config.reflectionsPoolMaxTokens)) {
		runtime.rewriteSkippedActiveIds = new Set(activeReflectionIds);
		const reason = result ? "not_useful_emergency_rewrite" : "no_result";
		const resultReflectionCount = result?.reflections.length ?? 0;
		const resultTokens = result ? reflectionTokenSum(result.reflections) : 0;
		runtime.lastRewriteSkip = { reason, reflectionCount: folded.reflections.length, activeTokens, maxTokens: runtime.config.reflectionsPoolMaxTokens, resultReflectionCount, resultTokens };
		debugLog("rewrite.skip", {
			reason,
			reflectionCount: folded.reflections.length,
			activeTokens,
			resultReflectionCount,
			resultTokens,
		});
		return "continue";
	}

	const recordedData = buildReflectionsRecordedData(result.reflections, entries.at(-1)?.id ?? "rewrite");
	const rewrittenData = buildReflectionsRewrittenData({
		retiredReflectionIds: activeReflectionIds,
		summary: result.summary,
	});
	if (!recordedData || !rewrittenData) return "continue";
	runtime.rewriteSkippedActiveIds = undefined;
	runtime.lastRewriteSkip = undefined;
	pi.appendEntry(OM_REFLECTIONS_RECORDED, recordedData);
	pi.appendEntry(OM_REFLECTIONS_REWRITTEN, rewrittenData);
	return "continue";
}
