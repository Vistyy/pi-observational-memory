import type { Runtime } from "../runtime.js";
import { estimateStringTokens } from "../memory/token-estimate.js";
import { planObserverRecordBatch } from "../memory/serialization/observer.js";
import { buildSessionMemoryState, checkpointGap, observerSourceEntriesAfterCoverage, type Entry, type Observation } from "../session-ledger/index.js";

export type MemoryUpdateTrigger = "agent_start" | "message_end" | "turn_end";

export type MemoryStageWork = {
	observerWork: Entry[];
	checkpointWork: Observation[];
	checkpointPruneDue: boolean;
};

function observerWorkForTrigger(stateEntries: Entry[], runtime: Runtime, trigger: MemoryUpdateTrigger): Entry[] {
	const state = buildSessionMemoryState(stateEntries);
	const pendingEntries = observerSourceEntriesAfterCoverage(state);
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

function checkpointPruneDueForTrigger(entries: Entry[], runtime: Runtime, trigger: MemoryUpdateTrigger, checkpointWork: Observation[]): boolean {
	if (trigger !== "turn_end") return false;
	if (checkpointWork.length > 0) return false;
	const state = buildSessionMemoryState(entries);
	const checkpoint = state.folded.checkpoint;
	if (!checkpoint) return false;
	return estimateStringTokens(checkpoint.content) > runtime.config.checkpointPruneTargetTokens;
}

export function computeMemoryStageWork(entries: Entry[], runtime: Runtime, trigger: MemoryUpdateTrigger = "turn_end"): MemoryStageWork {
	const state = buildSessionMemoryState(entries);
	const work = checkpointGap(state);
	return {
		observerWork: observerWorkForTrigger(entries, runtime, trigger),
		checkpointWork: work,
		checkpointPruneDue: checkpointPruneDueForTrigger(entries, runtime, trigger, work),
	};
}
