import {
	isReflectionsRewrittenData,
	normalizeObservationsRecordedData,
	normalizeReflectionsRecordedData,
	OM_OBSERVATIONS_RECORDED,
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_REWRITTEN,
	type Entry,
	type Observation,
	type Reflection,
} from "./types.js";
import { reflectionId as typedReflectionId } from "../memory/ids.js";

export type FoldLedgerOptions = {
	/** Fold entries from branch root through this entry id, inclusive. Omit to fold through branch tip. */
	upToEntryId?: string;
};

export type FoldedLedger = {
	/** All first-valid observation records encountered through the fold boundary. */
	observations: Observation[];
	/** All first-valid reflection records encountered through the fold boundary that have not been retired by rewrite. */
	reflections: Reflection[];
	/** Reflection ids retired from active memory by rewrite events. */
	retiredReflectionIds: Set<string>;
	/** Source entry index covered by the latest observation record. */
	lastObservationCoverageIndex: number;
	/** Source entry index covered by the latest reflection record. */
	lastReflectionCoverageIndex: number;
	/** Source entry id covered by the latest observation record. */
	lastObservationCoverageId?: string;
	/** Source entry id covered by the latest reflection record. */
	lastReflectionCoverageId?: string;
	/** Observations whose source entries are newer than the latest reflection coverage. */
	unreflectedObservations: Observation[];
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
	const reflectionsById = new Map<string, Reflection>();
	const retiredReflectionIds = new Set<string>();
	const endIdx = foldEndIndex(entries, options.upToEntryId);
	const idToIndex = entryIndexById(entries);
	const observationCoverage: { index: number; id?: string } = { index: -1 };
	const reflectionCoverage: { index: number; id?: string } = { index: -1 };

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

		if (isCustomEntry(entry, OM_REFLECTIONS_RECORDED)) {
			const data = normalizeReflectionsRecordedData(entry.data, entry.timestamp ?? "");
			if (!data) continue;
			for (const reflection of data.reflections) {
				if (!reflectionsById.has(reflection.id)) reflectionsById.set(reflection.id, reflection);
			}
			updateCoverage(reflectionCoverage, data.coversUpToId, idToIndex);
			continue;
		}

		if (isCustomEntry(entry, OM_REFLECTIONS_REWRITTEN)) {
			if (!isReflectionsRewrittenData(entry.data)) continue;
			for (const id of entry.data.retiredReflectionIds) retiredReflectionIds.add(typedReflectionId(id));
		}
	}

	const observations = Array.from(observationsById.values());
	const reflections = Array.from(reflectionsById.values()).filter((reflection) => !retiredReflectionIds.has(reflection.id));
	const unreflectedObservations = observations.filter((observation) =>
		observation.sourceEntryIds.some((sourceEntryId) => (idToIndex.get(sourceEntryId) ?? -1) > reflectionCoverage.index),
	);

	return {
		observations,
		reflections,
		retiredReflectionIds,
		lastObservationCoverageIndex: observationCoverage.index,
		lastReflectionCoverageIndex: reflectionCoverage.index,
		lastObservationCoverageId: observationCoverage.id,
		lastReflectionCoverageId: reflectionCoverage.id,
		unreflectedObservations,
	};
}
