import {
	normalizeCheckpointCoverageAdvancedData,
	normalizeCheckpointRecordedData,
	normalizeObservationsRecordedData,
	OM_CHECKPOINT_COVERAGE_ADVANCED,
	OM_CHECKPOINT_RECORDED,
	OM_OBSERVATIONS_RECORDED,
	type Checkpoint,
	type Entry,
	type Observation,
} from "./types.js";

export type FoldLedgerOptions = {
	upToEntryId?: string;
};

export type FoldedLedger = {
	observations: Observation[];
	lastObservationCoverageIndex: number;
	lastObservationCoverageId?: string;
	checkpoint?: Checkpoint;
	checkpoints: Checkpoint[];
	lastCheckpointCoverageObservationId?: string;
	uncheckpointedObservations: Observation[];
};

const SOURCE_ENTRY_TYPES = new Set(["message", "custom_message", "branch_summary", "compaction"]);

export function isSourceEntry(entry: Entry): boolean {
	return SOURCE_ENTRY_TYPES.has(entry.type);
}

export function entryIndexById(entries: Entry[]): Map<string, number> {
	const idToIndex = new Map<string, number>();
	for (let i = 0; i < entries.length; i++) idToIndex.set(entries[i].id, i);
	return idToIndex;
}

function foldEndIndex(entries: Entry[], upToEntryId: string | undefined): number {
	if (!upToEntryId) return entries.length - 1;
	const idx = entries.findIndex((entry) => entry.id === upToEntryId);
	return idx === -1 ? entries.length - 1 : idx;
}

function isCustomEntry(entry: Entry, customType: string): boolean {
	return entry.type === "custom" && entry.customType === customType;
}

function updateCoverage(coverage: { index: number; id?: string }, coversUpToId: string, idToIndex: Map<string, number>): void {
	const coveredIndex = idToIndex.get(coversUpToId);
	if (coveredIndex === undefined || coveredIndex <= coverage.index) return;
	coverage.index = coveredIndex;
	coverage.id = coversUpToId;
}

export function sourceEntriesAfterIndex(entries: Entry[], index: number, beforeIndex?: number): Entry[] {
	const end = beforeIndex === undefined ? entries.length : Math.max(index + 1, beforeIndex);
	return entries.slice(index + 1, end).filter(isSourceEntry);
}

export function foldLedger(entries: Entry[], options: FoldLedgerOptions = {}): FoldedLedger {
	const observationsById = new Map<string, Observation>();
	const checkpoints: Checkpoint[] = [];
	let lastCheckpointCoverageObservationId: string | undefined;
	const endIdx = foldEndIndex(entries, options.upToEntryId);
	const idToIndex = entryIndexById(entries);
	const observationCoverage: { index: number; id?: string } = { index: -1 };

	for (let i = 0; i <= endIdx; i++) {
		const entry = entries[i];
		if (!entry) continue;

		if (isCustomEntry(entry, OM_OBSERVATIONS_RECORDED)) {
			const data = normalizeObservationsRecordedData(entry.data);
			if (!data) continue;
			for (const observation of data.observations) {
				if (!observationsById.has(observation.id)) observationsById.set(observation.id, observation);
			}
			updateCoverage(observationCoverage, data.coversUpToId, idToIndex);
			continue;
		}

		if (isCustomEntry(entry, OM_CHECKPOINT_RECORDED)) {
			const data = normalizeCheckpointRecordedData(entry.data);
			if (!data) continue;
			checkpoints.push(data.checkpoint);
			lastCheckpointCoverageObservationId = data.coversUpToObservationId;
			continue;
		}

		if (isCustomEntry(entry, OM_CHECKPOINT_COVERAGE_ADVANCED)) {
			const data = normalizeCheckpointCoverageAdvancedData(entry.data);
			if (!data) continue;
			lastCheckpointCoverageObservationId = data.coversUpToObservationId;
		}
	}

	const observations = Array.from(observationsById.values());
	const checkpointCoverageIndex = lastCheckpointCoverageObservationId
		? observations.findIndex((observation) => observation.id === lastCheckpointCoverageObservationId)
		: -1;
	const uncheckpointedObservations = observations.filter((_, index) => index > checkpointCoverageIndex);

	return {
		observations,
		lastObservationCoverageIndex: observationCoverage.index,
		lastObservationCoverageId: observationCoverage.id,
		checkpoint: checkpoints.at(-1),
		checkpoints,
		lastCheckpointCoverageObservationId,
		uncheckpointedObservations,
	};
}
