import { activeReflections } from "./active-memory.js";
import { OM_FOLDED, type Entry, type MemoryDetails, type Observation, type Reflection } from "./types.js";

export type CompactionMemoryConfig = {
	compactionHandoffObservationMaxCount?: number;
	compactionHandoffObservationMaxTokens?: number;
};

export type CompactionMemory = {
	reflections: Reflection[];
	handoffObservations: Observation[];
	details: MemoryDetails;
};

function capCompactionHandoffObservations(observations: Observation[], config: CompactionMemoryConfig): Observation[] {
	const maxCount = config.compactionHandoffObservationMaxCount ?? 8;
	const maxTokens = config.compactionHandoffObservationMaxTokens ?? 1_000;
	const handoff: Observation[] = [];
	let tokens = 0;
	for (const observation of observations.slice(0, maxCount)) {
		const nextTokens = Math.ceil(observation.content.length / 4);
		if (handoff.length > 0 && tokens + nextTokens > maxTokens) break;
		handoff.push(observation);
		tokens += nextTokens;
	}
	return handoff;
}

function detailsFor(reflections: Reflection[]): MemoryDetails {
	return { type: OM_FOLDED, reflections };
}

export function buildCompactionMemory(
	entries: Entry[],
	config: CompactionMemoryConfig,
	options: { compactionHandoffObservations?: Observation[] } = {},
): CompactionMemory {
	const reflections = activeReflections(entries);
	const handoffObservations = capCompactionHandoffObservations(options.compactionHandoffObservations ?? [], config);
	return {
		reflections,
		handoffObservations,
		details: detailsFor(reflections),
	};
}
