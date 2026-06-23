export const OM_OBSERVATIONS_RECORDED = "om.observations.recorded";
export const OM_REFLECTIONS_RECORDED = "om.reflections.recorded";
export const OM_REFLECTIONS_REWRITTEN = "om.reflections.rewritten";
export const OM_FOLDED = "om.folded";

import { isLegacyMemoryId, isObservationId, isReflectionId, observationId, reflectionId } from "../memory/ids.js";

export type Entry = {
	type: string;
	id: string;
	timestamp?: string;
	message?: unknown;
	content?: unknown;
	customType?: string;
	summary?: unknown;
	fromId?: string;
	data?: unknown;
	details?: unknown;
	firstKeptEntryId?: string;
};

export type MemoryRecordBase = {
	id: string;
	content: string;
	createdAt: string;
};

export type Observation = MemoryRecordBase & {
	kind: "observation";
	/** Observation event time. Kept separately while prompts/status still render observation timestamps. */
	timestamp: string;
	/** Source ledger entry ids. */
	sourceEntryIds: string[];
};

export type Reflection = MemoryRecordBase & {
	kind: "reflection";
	sources: string[];
};

export type ObservationsRecordedEntryData = {
	observations: Observation[];
	coversUpToId: string;
};

export type ReflectionsRecordedEntryData = {
	reflections: Reflection[];
	coversUpToId: string;
};

export type ReflectionsRewrittenEntryData = {
	retiredReflectionIds: string[];
	summary?: string;
};

export type MemoryDetails = {
	type: typeof OM_FOLDED;
	reflections: Reflection[];
};

export type MemoryCustomType =
	| typeof OM_OBSERVATIONS_RECORDED
	| typeof OM_REFLECTIONS_RECORDED
	| typeof OM_REFLECTIONS_REWRITTEN;

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export function isNonEmptyStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

export function isMemoryId(value: unknown): value is string {
	return isLegacyMemoryId(value) || isObservationId(value) || isReflectionId(value);
}

function isTokenCount(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

export function normalizeObservation(value: unknown): Observation | undefined {
	if (!isPlainRecord(value)) return undefined;
	if (
		!isMemoryId(value.id) ||
		!isNonEmptyString(value.content) ||
		!isNonEmptyString(value.timestamp) ||
		!isNonEmptyStringArray(value.sourceEntryIds)
	) return undefined;
	return {
		id: observationId(value.id),
		kind: "observation",
		content: value.content,
		createdAt: isNonEmptyString(value.createdAt) ? value.createdAt : value.timestamp,
		timestamp: value.timestamp,
		sourceEntryIds: value.sourceEntryIds,
	};
}

export function isObservation(value: unknown): value is Observation {
	return !!normalizeObservation(value);
}

export function normalizeReflection(value: unknown, createdAt: string): Reflection | undefined {
	if (!isPlainRecord(value)) return undefined;
	if (!isMemoryId(value.id) || !isNonEmptyString(value.content) || /\r|\n/.test(value.content)) return undefined;
	const rawSources = isNonEmptyStringArray(value.sources)
		? value.sources
		: isNonEmptyStringArray(value.supportingObservationIds)
			? value.supportingObservationIds.map(observationId)
			: undefined;
	if (!rawSources) return undefined;
	const sources = rawSources.map((source) => isLegacyMemoryId(source) ? observationId(source) : source);
	if (!sources.every((source) => isObservationId(source) || isReflectionId(source))) return undefined;
	return {
		id: reflectionId(value.id),
		kind: "reflection",
		content: value.content,
		sources,
		createdAt: isNonEmptyString(value.createdAt) ? value.createdAt : createdAt,
	};
}

export function isReflection(value: unknown): value is Reflection {
	return !!normalizeReflection(value, "1970-01-01T00:00:00.000Z");
}

export function normalizeObservationsRecordedData(value: unknown): ObservationsRecordedEntryData | undefined {
	if (!isPlainRecord(value) || !Array.isArray(value.observations) || !isNonEmptyString(value.coversUpToId)) return undefined;
	const observations = value.observations.map(normalizeObservation);
	if (observations.some((observation) => !observation)) return undefined;
	return { observations: observations as Observation[], coversUpToId: value.coversUpToId };
}

export function isObservationsRecordedData(value: unknown): value is ObservationsRecordedEntryData {
	return !!normalizeObservationsRecordedData(value);
}

export function normalizeReflectionsRecordedData(value: unknown, createdAt: string): ReflectionsRecordedEntryData | undefined {
	if (!isPlainRecord(value) || !Array.isArray(value.reflections) || !isNonEmptyString(value.coversUpToId)) return undefined;
	const reflections = value.reflections.map((reflection) => normalizeReflection(reflection, createdAt));
	if (reflections.some((reflection) => !reflection)) return undefined;
	return { reflections: reflections as Reflection[], coversUpToId: value.coversUpToId };
}

export function isReflectionsRecordedData(value: unknown): value is ReflectionsRecordedEntryData {
	return !!normalizeReflectionsRecordedData(value, "1970-01-01T00:00:00.000Z");
}

export function isReflectionsRewrittenData(value: unknown): value is ReflectionsRewrittenEntryData {
	if (!isPlainRecord(value)) return false;
	return isNonEmptyStringArray(value.retiredReflectionIds) && (value.summary === undefined || isNonEmptyString(value.summary));
}

export function isMemoryDetails(value: unknown): value is MemoryDetails {
	if (!isPlainRecord(value)) return false;
	return (
		value.type === OM_FOLDED &&
		(value.fullFold === undefined || typeof value.fullFold === "boolean") &&
		(value.observations === undefined || (Array.isArray(value.observations) && value.observations.every(isObservation))) &&
		Array.isArray(value.reflections) &&
		value.reflections.every(isReflection)
	);
}

export function isObservationsRecordedEntry(entry: Entry): entry is Entry & {
	type: "custom";
	customType: typeof OM_OBSERVATIONS_RECORDED;
	data: ObservationsRecordedEntryData;
} {
	return entry.type === "custom" && entry.customType === OM_OBSERVATIONS_RECORDED && isObservationsRecordedData(entry.data);
}

export function isReflectionsRecordedEntry(entry: Entry): entry is Entry & {
	type: "custom";
	customType: typeof OM_REFLECTIONS_RECORDED;
	data: ReflectionsRecordedEntryData;
} {
	return entry.type === "custom" && entry.customType === OM_REFLECTIONS_RECORDED && isReflectionsRecordedData(entry.data);
}

export function isReflectionsRewrittenEntry(entry: Entry): entry is Entry & {
	type: "custom";
	customType: typeof OM_REFLECTIONS_REWRITTEN;
	data: ReflectionsRewrittenEntryData;
} {
	return entry.type === "custom" && entry.customType === OM_REFLECTIONS_REWRITTEN && isReflectionsRewrittenData(entry.data);
}

export function buildObservationsRecordedData(
	observations: Observation[],
	coversUpToId: string,
): ObservationsRecordedEntryData | undefined {
	if (!isNonEmptyString(coversUpToId)) return undefined;
	return { observations, coversUpToId };
}

export function buildReflectionsRecordedData(
	reflections: Reflection[],
	coversUpToId: string,
): ReflectionsRecordedEntryData | undefined {
	if (!isNonEmptyString(coversUpToId)) return undefined;
	return { reflections, coversUpToId };
}

export function buildReflectionsRewrittenData(
	data: ReflectionsRewrittenEntryData,
): ReflectionsRewrittenEntryData | undefined {
	return isReflectionsRewrittenData(data) ? data : undefined;
}

