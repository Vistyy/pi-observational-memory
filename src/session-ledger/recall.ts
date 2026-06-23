import {
	normalizeObservationsRecordedData,
	normalizeReflectionsRecordedData,
	type Entry,
	type Observation,
	type Reflection,
} from "./types.js";
import { isLegacyMemoryId, observationId, reflectionId } from "../memory/ids.js";

const SOURCE_TYPES = new Set(["message", "custom_message", "branch_summary"]);

export type { Entry, Observation, Reflection };

type ObservationLedgerLocation = {
	entryId: string;
	entryIndex: number;
	recordIndex: number;
};

type ReflectionLedgerLocation = {
	entryId: string;
	entryIndex: number;
	recordIndex: number;
};

export type RecalledObservation = {
	observation: Observation;
	observationEntryId: string;
	observationRecordIndex: number;
	status: "active";
	sourceEntryIds: string[];
	sourceEntries: Entry[];
	missingSourceEntryIds: string[];
	nonSourceEntryIds: string[];
};

export type RecalledReflection = {
	reflection: Reflection;
	reflectionEntryId: string;
	reflectionRecordIndex: number;
};

export type RecallProvenanceEdge = {
	fromId: string;
	toId: string;
};

export type RecallOptions = {
	depth?: number;
};

export type RecallResult =
	| {
			status: "not_found";
			memoryId: string;
			kind: undefined;
			reflections: [];
			observations: [];
			sourceEntries: [];
			missingSourceEntryIds: [];
			nonSourceEntryIds: [];
			missingSupportingObservationIds: [];
			missingSupportingReflectionIds: [];
			depthLimitedReflectionIds: [];
			supportingReflections: [];
			provenanceEdges: [];
			collision: false;
			partial: false;
	  }
	| {
			status: "found";
			memoryId: string;
			kind: "observation" | "reflection" | "mixed";
			reflections: RecalledReflection[];
			observations: RecalledObservation[];
			sourceEntries: Entry[];
			missingSourceEntryIds: string[];
			nonSourceEntryIds: string[];
			missingSupportingObservationIds: string[];
			missingSupportingReflectionIds: string[];
			depthLimitedReflectionIds: string[];
			supportingReflections: RecalledReflection[];
			provenanceEdges: RecallProvenanceEdge[];
			collision: boolean;
			partial: boolean;
	  };

type IndexedObservation = ObservationLedgerLocation & { observation: Observation };
type IndexedReflection = ReflectionLedgerLocation & { reflection: Reflection };

function isSourceEntry(entry: Entry): boolean {
	return SOURCE_TYPES.has(entry.type);
}

function uniqueById(entries: Entry[]): Entry[] {
	const seen = new Set<string>();
	const result: Entry[] = [];
	for (const entry of entries) {
		if (seen.has(entry.id)) continue;
		seen.add(entry.id);
		result.push(entry);
	}
	return result;
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values));
}

function recallDepth(options?: RecallOptions): number | undefined {
	const raw = options?.depth;
	if (raw === undefined) return undefined;
	if (!Number.isFinite(raw)) return undefined;
	return Math.max(0, Math.floor(raw));
}

function indexLedger(entries: Entry[]): {
	observations: IndexedObservation[];
	reflections: IndexedReflection[];
} {
	const observations: IndexedObservation[] = [];
	const reflections: IndexedReflection[] = [];

	for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
		const entry = entries[entryIndex];
		const observationsData = entry.type === "custom" && entry.customType === "om.observations.recorded" ? normalizeObservationsRecordedData(entry.data) : undefined;
		if (observationsData) {
			observationsData.observations.forEach((observation, recordIndex) => {
				observations.push({ observation, entryId: entry.id, entryIndex, recordIndex });
			});
			continue;
		}
		const reflectionsData = entry.type === "custom" && entry.customType === "om.reflections.recorded" ? normalizeReflectionsRecordedData(entry.data, entry.timestamp ?? "") : undefined;
		if (reflectionsData) {
			reflectionsData.reflections.forEach((reflection, recordIndex) => {
				reflections.push({ reflection, entryId: entry.id, entryIndex, recordIndex });
			});
			continue;
		}
	}

	return { observations, reflections };}

function resolveObservationSources(entries: Entry[], observation: Observation, location: ObservationLedgerLocation): RecalledObservation {
	const sourceEntryIds = uniqueStrings(observation.sourceEntryIds);
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const sourceEntries: Entry[] = [];
	const missingSourceEntryIds: string[] = [];
	const nonSourceEntryIds: string[] = [];

	for (const sourceEntryId of sourceEntryIds) {
		const sourceEntry = byId.get(sourceEntryId);
		if (!sourceEntry) {
			missingSourceEntryIds.push(sourceEntryId);
			continue;
		}
		if (!isSourceEntry(sourceEntry)) {
			nonSourceEntryIds.push(sourceEntryId);
			continue;
		}
		sourceEntries.push(sourceEntry);
	}

	return {
		observation,
		observationEntryId: location.entryId,
		observationRecordIndex: location.recordIndex,
		status: "active",
		sourceEntryIds,
		sourceEntries,
		missingSourceEntryIds,
		nonSourceEntryIds,
	};
}

function notFound(memoryId: string): RecallResult {
	return {
		status: "not_found",
		memoryId,
		kind: undefined,
		reflections: [],
		observations: [],
		sourceEntries: [],
		missingSourceEntryIds: [],
		nonSourceEntryIds: [],
		missingSupportingObservationIds: [],
		missingSupportingReflectionIds: [],
		depthLimitedReflectionIds: [],
		supportingReflections: [],
		provenanceEdges: [],
		collision: false,
		partial: false,
	};
}

function recalledReflection(indexed: IndexedReflection): RecalledReflection {
	return {
		reflection: indexed.reflection,
		reflectionEntryId: indexed.entryId,
		reflectionRecordIndex: indexed.recordIndex,
	};
}

export function recallMemorySources(entries: Entry[], memoryId: string, options?: RecallOptions): RecallResult {
	const { observations: indexedObservations, reflections: indexedReflections } = indexLedger(entries);
	const observationLookupId = isLegacyMemoryId(memoryId) ? observationId(memoryId) : memoryId;
	const reflectionLookupId = isLegacyMemoryId(memoryId) ? reflectionId(memoryId) : memoryId;
	const directObservationMatches = indexedObservations.filter(({ observation }) => observation.id === observationLookupId);
	const reflectionMatches = indexedReflections.filter(({ reflection }) => reflection.id === reflectionLookupId);

	if (directObservationMatches.length === 0 && reflectionMatches.length === 0) return notFound(memoryId);

	const observationsById = new Map<string, IndexedObservation>();
	for (const indexed of indexedObservations) {
		if (!observationsById.has(indexed.observation.id)) observationsById.set(indexed.observation.id, indexed);
	}
	const reflectionsById = new Map<string, IndexedReflection>();
	for (const indexed of indexedReflections) {
		if (!reflectionsById.has(indexed.reflection.id)) reflectionsById.set(indexed.reflection.id, indexed);
	}

	const recalledByKey = new Map<string, RecalledObservation>();
	const supportingReflectionByKey = new Map<string, RecalledReflection>();
	const missingSupportingObservationIds: string[] = [];
	const missingSupportingReflectionIds: string[] = [];
	const depthLimitedReflectionIds: string[] = [];
	const provenanceEdges: RecallProvenanceEdge[] = [];
	const maxDepth = recallDepth(options);
	const directReflectionKeys = new Set(reflectionMatches.map((match) => `${match.entryId}:${match.recordIndex}`));

	function addObservation(indexed: IndexedObservation): void {
		const key = `${indexed.entryId}:${indexed.recordIndex}`;
		if (recalledByKey.has(key)) return;
		const recalled = resolveObservationSources(entries, indexed.observation, indexed);
		recalled.status = "active";
		recalledByKey.set(key, recalled);
	}

	function addSupportingReflection(indexed: IndexedReflection): void {
		const key = `${indexed.entryId}:${indexed.recordIndex}`;
		if (directReflectionKeys.has(key) || supportingReflectionByKey.has(key)) return;
		supportingReflectionByKey.set(key, recalledReflection(indexed));
	}

	for (const match of directObservationMatches) addObservation(match);

	const visitedReflectionIds = new Set<string>();
	function addReflectionSources(reflection: Reflection, currentDepth: number): void {
		if (visitedReflectionIds.has(reflection.id)) return;
		visitedReflectionIds.add(reflection.id);
		for (const source of uniqueStrings(reflection.sources)) {
			provenanceEdges.push({ fromId: reflection.id, toId: source });
			if (source.startsWith("obs_")) {
				const indexed = observationsById.get(source);
				if (!indexed) {
					missingSupportingObservationIds.push(source);
					continue;
				}
				addObservation(indexed);
				continue;
			}
			if (source.startsWith("ref_")) {
				if (maxDepth !== undefined && currentDepth >= maxDepth) {
					depthLimitedReflectionIds.push(source);
					continue;
				}
				const indexed = reflectionsById.get(source);
				if (!indexed) {
					missingSupportingReflectionIds.push(source);
					continue;
				}
				addSupportingReflection(indexed);
				addReflectionSources(indexed.reflection, currentDepth + 1);
			}
		}
	}

	for (const { reflection } of reflectionMatches) addReflectionSources(reflection, 0);

	const recalledObservations = Array.from(recalledByKey.values());
	const recalledReflections: RecalledReflection[] = reflectionMatches.map(recalledReflection);
	const supportingReflections = Array.from(supportingReflectionByKey.values());
	const sourceEntries = uniqueById(recalledObservations.flatMap((match) => match.sourceEntries));
	const missingSourceEntryIds = uniqueStrings(recalledObservations.flatMap((match) => match.missingSourceEntryIds));
	const nonSourceEntryIds = uniqueStrings(recalledObservations.flatMap((match) => match.nonSourceEntryIds));
	const uniqueMissingSupportingObservationIds = uniqueStrings(missingSupportingObservationIds);
	const uniqueMissingSupportingReflectionIds = uniqueStrings(missingSupportingReflectionIds);
	const uniqueDepthLimitedReflectionIds = uniqueStrings(depthLimitedReflectionIds);
	const matchCount = directObservationMatches.length + reflectionMatches.length;

	return {
		status: "found",
		memoryId,
		kind: directObservationMatches.length > 0 && reflectionMatches.length > 0
			? "mixed"
			: reflectionMatches.length > 0
				? "reflection"
				: "observation",
		reflections: recalledReflections,
		observations: recalledObservations,
		sourceEntries,
		missingSourceEntryIds,
		nonSourceEntryIds,
		missingSupportingObservationIds: uniqueMissingSupportingObservationIds,
		missingSupportingReflectionIds: uniqueMissingSupportingReflectionIds,
		depthLimitedReflectionIds: uniqueDepthLimitedReflectionIds,
		supportingReflections,
		provenanceEdges,
		collision: matchCount > 1,
		partial: missingSourceEntryIds.length > 0 || nonSourceEntryIds.length > 0 || uniqueMissingSupportingObservationIds.length > 0 || uniqueMissingSupportingReflectionIds.length > 0 || uniqueDepthLimitedReflectionIds.length > 0,
	};
}
