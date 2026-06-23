import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runObserver } from "../agents/observer/agent.js";
import { debugLog } from "../debug-log.js";
import { estimateEntryTokens } from "../memory/token-estimate.js";
import { serializeObserverSourceEntries } from "../memory/serialization/observer.js";
import type { Runtime } from "../runtime.js";
import {
	OM_OBSERVATIONS_RECORDED,
	buildObservationsRecordedData,
	foldLedger,
	observationTokenSum,
	sourceEntriesAfterIndex,
	type Entry,
} from "../session-ledger/index.js";
import { commonAgentArgs } from "./agent-args.js";
import type { MemoryUpdateCtx, ResolveMemoryModel, StageOutcome } from "./types.js";

export async function runObserverStage(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: MemoryUpdateCtx,
	resolveModel: ResolveMemoryModel,
	workEntries?: Entry[],
): Promise<StageOutcome> {
	const entries = ctx.sessionManager.getBranch() as Entry[];
	const folded = foldLedger(entries);
	const chunkEntries = workEntries ?? sourceEntriesAfterIndex(entries, folded.lastObservationCoverageIndex);
	const sourceEntryCount = chunkEntries.length;
	if (sourceEntryCount === 0) return "continue";
	if (!workEntries && sourceEntryCount < runtime.config.observeEveryMessages) return "continue";

	const coversUpToId = chunkEntries.at(-1)?.id;
	if (!coversUpToId) return "continue";
	const tokens = chunkEntries.reduce((sum, entry) => sum + estimateEntryTokens(entry), 0);
	if (folded.lastObservationCoverageIndex === -1 && tokens > runtime.config.maxInitialObserveTokens) {
		const data = buildObservationsRecordedData([], coversUpToId);
		if (data) pi.appendEntry(OM_OBSERVATIONS_RECORDED, data);
		debugLog("observer.initial_backfill_skipped", { tokens, coversUpToId });
		if (ctx.hasUI) ctx.ui?.notify(
			`Observational memory: skipped initial backfill for large existing session (~${tokens.toLocaleString()} tokens); observing future turns`,
			"warning",
		);
		return "continue";
	}

	const { text: chunk, sourceEntryIds } = serializeObserverSourceEntries(chunkEntries, {
		toolResultSummaryMaxLines: runtime.config.observerToolResultSummaryMaxLines,
		toolResultErrorMaxLines: runtime.config.observerToolResultErrorMaxLines,
		toolResultLineMaxChars: runtime.config.observerToolResultLineMaxChars,
		toolOutputPolicies: runtime.config.observerToolOutputPolicies,
	});
	if (!chunk.trim() || sourceEntryIds.length === 0) {
		const data = buildObservationsRecordedData([], coversUpToId);
		if (data) pi.appendEntry(OM_OBSERVATIONS_RECORDED, data);
		debugLog("observer.skipped_unrenderable_chunk", { coversUpToId, sourceEntryCount });
		return "continue";
	}

	if (ctx.hasUI) ctx.ui?.notify(
		`Observational memory: observer running on ${sourceEntryCount.toLocaleString()} source entr${sourceEntryCount === 1 ? "y" : "ies"}`,
		"info",
	);
	debugLog("observer.start", {
		tokens,
		coversUpToId,
		sourceEntryIds,
		sourceEntryCount: sourceEntryIds.length,
	});

	const resolved = await resolveModel("observer");
	if (!resolved) return "abort";

	const observations = await runObserver({
		...commonAgentArgs(pi, runtime, resolved, runtime.config.observerThinking),
		chunk,
		allowedSourceEntryIds: sourceEntryIds,
	});
	if (!observations) {
		debugLog("observer.no_tool_output", { coversUpToId });
		if (ctx.hasUI) ctx.ui?.notify("Observational memory: observer returned no tool output", "warning");
		return "continue";
	}

	const data = buildObservationsRecordedData(observations, coversUpToId);
	if (!data) return "continue";
	debugLog(observations.length === 0 ? "observer.reviewed_empty" : "observer.records", {
		count: observations.length,
		observationTokens: observationTokenSum(observations),
		coversUpToId,
	});
	pi.appendEntry(OM_OBSERVATIONS_RECORDED, data);
	debugLog("observer.appended", { count: observations.length, coversUpToId });
	if (ctx.hasUI) ctx.ui?.notify(
		observations.length === 0
			? "Observational memory: observer marked chunk observed with no observations"
			: `Observational memory: ${observations.length} observation${observations.length === 1 ? "" : "s"} recorded`,
		"info",
	);
	return "continue";
}
