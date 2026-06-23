import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runObserver } from "../agents/observer/agent.js";
import { STRATEGY } from "../config.js";
import { debugLog, debugSessionMetadata, withDebugLogContext } from "../debug-log.js";
import { serializeObserverSourceEntries } from "../memory/serialization/observer.js";
import type { Runtime } from "../runtime.js";
import { OM_OBSERVATIONS_RECORDED, buildObservationsRecordedData, entryIndexById, foldLedger, sourceEntriesAfterIndex, type Entry, type Observation } from "../session-ledger/index.js";
import { commonAgentArgs } from "./agent-args.js";
import { makeModelResolver } from "./model-resolver.js";
import type { MemoryUpdateCtx } from "./types.js";

export async function ensureObservedBeforeCompaction(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: MemoryUpdateCtx,
	options: { firstKeptEntryId?: string } = {},
): Promise<Observation[]> {
	runtime.ensureConfig(ctx.cwd);
	if (runtime.config.strategy === STRATEGY.off) return [];
	if (runtime.inFlightObserverStagePromise) await runtime.inFlightObserverStagePromise;
	const entries = ctx.sessionManager.getBranch() as Entry[];
	const firstKeptIndex = entryIndexById(entries).get(options.firstKeptEntryId ?? "");
	if (firstKeptIndex === undefined) return [];
	const folded = foldLedger(entries);
	const sourceEntries = sourceEntriesAfterIndex(entries, folded.lastObservationCoverageIndex, firstKeptIndex);
	if (sourceEntries.length === 0) return [];
	const runId = `compaction-observer-flush-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
	const sessionMetadata = debugSessionMetadata(ctx);
	return withDebugLogContext({
		enabled: runtime.config.debugLog === true,
		cwd: ctx.cwd,
		...sessionMetadata,
		runId,
	}, async () => runCompactionObserverFlush(pi, runtime, ctx, sourceEntries));
}

async function runCompactionObserverFlush(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: MemoryUpdateCtx,
	sourceEntries: Entry[],
): Promise<Observation[]> {
	try {
		const coversUpToId = sourceEntries.at(-1)?.id;
		if (!coversUpToId) return [];
		const { text: chunk, sourceEntryIds } = serializeObserverSourceEntries(sourceEntries, {
			toolResultSummaryMaxLines: runtime.config.observerToolResultSummaryMaxLines,
			toolResultErrorMaxLines: runtime.config.observerToolResultErrorMaxLines,
			toolResultLineMaxChars: runtime.config.observerToolResultLineMaxChars,
			toolOutputPolicies: runtime.config.observerToolOutputPolicies,
		});
		if (!chunk.trim() || sourceEntryIds.length === 0) {
			const data = buildObservationsRecordedData([], coversUpToId);
			if (data) pi.appendEntry(OM_OBSERVATIONS_RECORDED, data);
			debugLog("observer.compaction_flush_unrenderable", { coversUpToId });
			return [];
		}

		const resolveModel = makeModelResolver(runtime, ctx);
		const resolved = await resolveModel("observer");
		if (!resolved) return [];
		const observations = await runObserver({
			...commonAgentArgs(pi, runtime, resolved, runtime.config.observerThinking, "compaction-flush"),
			chunk,
			allowedSourceEntryIds: sourceEntryIds,
		});
		if (!observations) return [];
		const data = buildObservationsRecordedData(observations, coversUpToId);
		if (!data) return [];
		pi.appendEntry(OM_OBSERVATIONS_RECORDED, data);
		return data.observations;
	} catch (error) {
		const reason = runtime.recordMemoryUpdateStageError(ctx, "observer", error);
		debugLog("observer.error", { errorMessage: reason });
		return [];
	}
}
