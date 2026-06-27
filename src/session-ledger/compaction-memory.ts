import { buildSessionMemoryState, currentCheckpointMemoryDetails } from "./memory-state.js";
import type { Checkpoint, CheckpointMemoryDetails, Entry } from "./types.js";

export type CompactionMemoryConfig = {
	compactionHandoffObservationMaxCount?: number;
	compactionHandoffObservationMaxTokens?: number;
};

export type CompactionMemory = {
	checkpoint?: Checkpoint;
	details?: CheckpointMemoryDetails;
};

export function buildCompactionMemory(
	entries: Entry[],
	_config: CompactionMemoryConfig,
	_options: unknown = {},
): CompactionMemory {
	const state = buildSessionMemoryState(entries);
	return {
		checkpoint: state.folded.checkpoint,
		details: currentCheckpointMemoryDetails(state),
	};
}
