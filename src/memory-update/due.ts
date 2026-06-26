import type { Runtime } from "../runtime.js";
import { planObserverRecordBatch } from "../memory/serialization/observer.js";
import {
	foldLedger,
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_REWRITTEN,
	reflectionTokenSum,
	normalizeReflectionsRecordedData,
	type Entry,
	type Observation,
	type Reflection,
} from "../session-ledger/index.js";

export type MemoryUpdateTrigger = "agent_start" | "message_end" | "turn_end";

export type MemoryStageWork = {
	observerWork: Entry[];
	checkpointWork: Observation[];
	reflectorWork: Observation[];
	maintainerWork: Reflection[];
	rewriteWork: Reflection[];
};

export function reflectionsRecordedSinceLastRetirement(entries: Entry[]): number {
	let count = 0;
	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		if (entry.customType === OM_REFLECTIONS_REWRITTEN) {
			count = 0;
			continue;
		}
		if (entry.customType !== OM_REFLECTIONS_RECORDED) continue;
		count += normalizeReflectionsRecordedData(entry.data, entry.timestamp ?? "")?.reflections.length ?? 0;
	}
	return count;
}

function observerEntriesAfterCoverage(entries: Entry[], lastObservationCoverageIndex: number): Entry[] {
	return entries.slice(lastObservationCoverageIndex + 1);
}

function observerWorkForTrigger(entries: Entry[], runtime: Runtime, trigger: MemoryUpdateTrigger): Entry[] {
	const folded = foldLedger(entries);
	const pendingEntries = observerEntriesAfterCoverage(entries, folded.lastObservationCoverageIndex);
	if (pendingEntries.length === 0) return [];
	const isTurnEnd = trigger === "turn_end";
	const threshold = isTurnEnd ? runtime.config.observeEveryMessages : runtime.config.observeHardCapRecords;
	const maxRecords = isTurnEnd ? Number.MAX_SAFE_INTEGER : runtime.config.observeHardCapRecords;
	const plan = planObserverRecordBatch(pendingEntries, {
		toolResultSummaryMaxLines: runtime.config.observerToolResultSummaryMaxLines,
		toolResultErrorMaxLines: runtime.config.observerToolResultErrorMaxLines,
		toolResultLineMaxChars: runtime.config.observerToolResultLineMaxChars,
		toolOutputPolicies: runtime.config.observerToolOutputPolicies,
		allowTailIncompleteToolCalls: isTurnEnd,
	}, maxRecords);
	return plan.recordCount >= threshold ? plan.entries as Entry[] : [];
}

export function computeMemoryStageWork(entries: Entry[], runtime: Runtime, trigger: MemoryUpdateTrigger = "turn_end"): MemoryStageWork {
	const folded = foldLedger(entries);
	const observerWork = observerWorkForTrigger(entries, runtime, trigger);
	const newReflectionsSinceMaintenance = reflectionsRecordedSinceLastRetirement(entries);
	return {
		observerWork,
		checkpointWork: folded.uncheckpointedObservations,
		reflectorWork: folded.unreflectedObservations.length >= runtime.config.reflectEveryObservations ? folded.unreflectedObservations : [],
		maintainerWork: newReflectionsSinceMaintenance >= runtime.config.maintainEveryNewReflections ? folded.reflections.slice(-runtime.config.maintainerMaxInputReflections) : [],
		rewriteWork: reflectionTokenSum(folded.reflections) >= runtime.config.reflectionsPoolMaxTokens ? folded.reflections : [],
	};
}
