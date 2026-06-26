import type { Runtime } from "../runtime.js";
import { planObserverRecordBatch } from "../memory/serialization/observer.js";
import { foldLedger, type Entry, type Observation } from "../session-ledger/index.js";

export type MemoryUpdateTrigger = "agent_start" | "message_end" | "turn_end";

export type MemoryStageWork = {
	observerWork: Entry[];
	checkpointWork: Observation[];
};

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
	return {
		observerWork: observerWorkForTrigger(entries, runtime, trigger),
		checkpointWork: folded.uncheckpointedObservations,
	};
}
