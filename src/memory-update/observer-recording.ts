import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runObserver } from "../agents/observer/agent.js";
import { thinkingForAgent } from "../config.js";
import { debugLog } from "../debug-log.js";
import { serializeObserverSourceEntries } from "../memory/serialization/observer.js";
import { estimateEntryTokens } from "../memory/token-estimate.js";
import type { Runtime } from "../runtime.js";
import {
	OM_OBSERVATIONS_RECORDED,
	buildObservationsRecordedData,
	buildSessionMemoryState,
	observationTokenSum,
	type Entry,
	type Observation,
} from "../session-ledger/index.js";
import { commonAgentArgs } from "./agent-args.js";
import type { MemoryUpdateCtx, ResolveMemoryModel, StageOutcome } from "./types.js";

export type ObserverRecordingPurpose = "normal" | "compaction-flush";

export type ObserverRecordingResult = {
	outcome: StageOutcome;
	observations: Observation[];
};

function emptyResult(outcome: StageOutcome = "continue"): ObserverRecordingResult {
	return { outcome, observations: [] };
}

export async function recordObserverObservations(args: {
	pi: ExtensionAPI;
	runtime: Runtime;
	ctx: MemoryUpdateCtx;
	resolveModel: ResolveMemoryModel;
	sourceEntries: Entry[];
	purpose: ObserverRecordingPurpose;
	skipInitialBackfillIfTooLarge?: boolean;
}): Promise<ObserverRecordingResult> {
	const sourceEntryCount = args.sourceEntries.length;
	if (sourceEntryCount === 0) return emptyResult();
	const coversUpToId = args.sourceEntries.at(-1)?.id;
	if (!coversUpToId) return emptyResult();
	const tokens = args.sourceEntries.reduce((sum, entry) => sum + estimateEntryTokens(entry), 0);
	const state = buildSessionMemoryState(args.ctx.sessionManager.getBranch() as Entry[]);

	if (args.skipInitialBackfillIfTooLarge && state.folded.lastObservationCoverageIndex === -1 && tokens > args.runtime.config.maxInitialObserveTokens) {
		const data = buildObservationsRecordedData([], coversUpToId);
		if (data) args.pi.appendEntry(OM_OBSERVATIONS_RECORDED, data);
		debugLog("observer.initial_backfill_skipped", { tokens, coversUpToId });
		if (args.ctx.hasUI) args.ctx.ui?.notify(
			`Observational memory: skipped initial backfill for large existing session (~${tokens.toLocaleString()} tokens); observing future turns`,
			"warning",
		);
		return emptyResult();
	}

	const { text: chunk, sourceEntryIds } = serializeObserverSourceEntries(args.sourceEntries, {
		toolResultSummaryMaxLines: args.runtime.config.observerToolResultSummaryMaxLines,
		toolResultErrorMaxLines: args.runtime.config.observerToolResultErrorMaxLines,
		toolResultLineMaxChars: args.runtime.config.observerToolResultLineMaxChars,
		toolOutputPolicies: args.runtime.config.observerToolOutputPolicies,
	});
	if (!chunk.trim() || sourceEntryIds.length === 0) {
		const data = buildObservationsRecordedData([], coversUpToId);
		if (data) args.pi.appendEntry(OM_OBSERVATIONS_RECORDED, data);
		debugLog(args.purpose === "compaction-flush" ? "observer.compaction_flush_unrenderable" : "observer.skipped_unrenderable_chunk", { coversUpToId, sourceEntryCount });
		return emptyResult();
	}

	if (args.ctx.hasUI && args.purpose === "normal") args.ctx.ui?.notify(
		`Observational memory: observer running on ${sourceEntryCount.toLocaleString()} source entr${sourceEntryCount === 1 ? "y" : "ies"}`,
		"info",
	);
	debugLog(args.purpose === "compaction-flush" ? "observer.compaction_flush_start" : "observer.start", {
		tokens,
		coversUpToId,
		sourceEntryIds,
		sourceEntryCount: sourceEntryIds.length,
	});

	const resolved = await args.resolveModel("observer");
	if (!resolved) return emptyResult("abort");

	const observations = await runObserver({
		...commonAgentArgs(args.pi, args.runtime, resolved, thinkingForAgent(args.runtime.config, "observer"), args.purpose === "compaction-flush" ? "compaction-flush" : undefined),
		chunk,
		allowedSourceEntryIds: sourceEntryIds,
	});
	if (!observations) {
		debugLog("observer.no_tool_output", { coversUpToId });
		if (args.ctx.hasUI) args.ctx.ui?.notify("Observational memory: observer returned no tool output", "warning");
		return emptyResult();
	}

	const data = buildObservationsRecordedData(observations, coversUpToId);
	if (!data) return emptyResult();
	debugLog(observations.length === 0 ? "observer.reviewed_empty" : "observer.records", {
		count: observations.length,
		observationTokens: observationTokenSum(observations),
		coversUpToId,
	});
	args.pi.appendEntry(OM_OBSERVATIONS_RECORDED, data);
	debugLog("observer.appended", { count: observations.length, coversUpToId });
	if (args.ctx.hasUI && args.purpose === "normal") args.ctx.ui?.notify(
		observations.length === 0
			? "Observational memory: observer marked chunk observed with no observations"
			: `Observational memory: ${observations.length} observation${observations.length === 1 ? "" : "s"} recorded`,
		"info",
	);
	return { outcome: "continue", observations: data.observations };
}
