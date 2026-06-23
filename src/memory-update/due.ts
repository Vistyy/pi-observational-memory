import type { Runtime } from "../runtime.js";
import {
	foldLedger,
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_REWRITTEN,
	reflectionTokenSum,
	normalizeReflectionsRecordedData,
	sourceEntriesAfterIndex,
	type Entry,
	type Observation,
	type Reflection,
} from "../session-ledger/index.js";

export type MemoryStageWork = {
	observerWork: Entry[];
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

export function computeMemoryStageWork(entries: Entry[], runtime: Runtime): MemoryStageWork {
	const folded = foldLedger(entries);
	const observerWork = sourceEntriesAfterIndex(entries, folded.lastObservationCoverageIndex);
	const newReflectionsSinceMaintenance = reflectionsRecordedSinceLastRetirement(entries);
	return {
		observerWork: observerWork.length >= runtime.config.observeEveryMessages ? observerWork : [],
		reflectorWork: folded.unreflectedObservations.length >= runtime.config.reflectEveryObservations ? folded.unreflectedObservations : [],
		maintainerWork: newReflectionsSinceMaintenance >= runtime.config.maintainEveryNewReflections ? folded.reflections.slice(-runtime.config.maintainerMaxInputReflections) : [],
		rewriteWork: reflectionTokenSum(folded.reflections) >= runtime.config.reflectionsPoolMaxTokens ? folded.reflections : [],
	};
}
