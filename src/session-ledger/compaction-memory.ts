import { foldLedger } from "./fold.js";
import { OM_CHECKPOINT, type Checkpoint, type CheckpointMemoryDetails, type Entry } from "./types.js";

export type CompactionMemoryConfig = {
	compactionHandoffObservationMaxCount?: number;
	compactionHandoffObservationMaxTokens?: number;
};

export type CompactionMemory = {
	checkpoint?: Checkpoint;
	details?: CheckpointMemoryDetails;
};

function detailsFor(checkpoint: Checkpoint | undefined, coversUpToObservationId: string | undefined): CheckpointMemoryDetails | undefined {
	if (!checkpoint) return undefined;
	return { type: OM_CHECKPOINT, checkpoint, coversUpToObservationId };
}

export function buildCompactionMemory(
	entries: Entry[],
	_config: CompactionMemoryConfig,
	_options: unknown = {},
): CompactionMemory {
	const folded = foldLedger(entries);
	return {
		checkpoint: folded.checkpoint,
		details: detailsFor(folded.checkpoint, folded.lastCheckpointCoverageObservationId),
	};
}
