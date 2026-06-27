import { entryIndexById, foldLedger, sourceEntriesAfterIndex, type FoldedLedger } from "./fold.js";
import { OM_CHECKPOINT, type CheckpointMemoryDetails, type Entry, type Observation } from "./types.js";

export type SessionMemoryState = {
	entries: Entry[];
	folded: FoldedLedger;
	idToIndex: Map<string, number>;
};

export function buildSessionMemoryState(entries: Entry[]): SessionMemoryState {
	return {
		entries,
		folded: foldLedger(entries),
		idToIndex: entryIndexById(entries),
	};
}

export function observerSourceEntriesAfterCoverage(state: SessionMemoryState, beforeEntryId?: string): Entry[] {
	const beforeIndex = beforeEntryId ? state.idToIndex.get(beforeEntryId) : undefined;
	if (beforeEntryId && beforeIndex === undefined) return [];
	return sourceEntriesAfterIndex(state.entries, state.folded.lastObservationCoverageIndex, beforeIndex);
}

export function checkpointGap(state: SessionMemoryState): Observation[] {
	return state.folded.uncheckpointedObservations;
}

export function uncheckpointedObservationsBeforeEntry(state: SessionMemoryState, firstKeptEntryId?: string): Observation[] {
	if (!firstKeptEntryId) return [];
	const firstKeptIndex = state.idToIndex.get(firstKeptEntryId);
	if (firstKeptIndex === undefined) return [];
	return state.folded.uncheckpointedObservations.filter((observation) => observation.sourceEntryIds.some((sourceEntryId) => {
		const sourceIndex = state.idToIndex.get(sourceEntryId);
		return sourceIndex === undefined || sourceIndex < firstKeptIndex;
	}));
}

export function currentCheckpointMemoryDetails(state: SessionMemoryState): CheckpointMemoryDetails | undefined {
	if (!state.folded.checkpoint) return undefined;
	return {
		type: OM_CHECKPOINT,
		checkpoint: state.folded.checkpoint,
		coversUpToObservationId: state.folded.lastCheckpointCoverageObservationId,
	};
}
