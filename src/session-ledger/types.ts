export const OM_OBSERVATIONS_RECORDED = "om.observations.recorded";
export const OM_CHECKPOINT_RECORDED = "om.checkpoint.recorded";
export const OM_CHECKPOINT_COVERAGE_ADVANCED = "om.checkpoint.coverage_advanced";
export const OM_CHECKPOINT = "om.checkpoint";

import { checkpointId, isCheckpointId, isLegacyMemoryId, isObservationId, observationId } from "../memory/ids.js";

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
	timestamp: string;
	sourceEntryIds: string[];
};

export type Checkpoint = {
	id: string;
	content: string;
	createdAt: string;
	contentFormat: "markdown";
};

export type CheckpointRecordedEntryData = {
	mode: "update" | "prune";
	checkpoint: Checkpoint;
	coversUpToObservationId: string;
	observationIds: string[];
};

export type CheckpointCoverageAdvancedEntryData = {
	coversUpToObservationId: string;
	observationIds: string[];
	reason: string;
};

export type ObservationsRecordedEntryData = {
	observations: Observation[];
	coversUpToId: string;
};

export type CheckpointMemoryDetails = {
	type: typeof OM_CHECKPOINT;
	checkpoint: Checkpoint;
	coversUpToObservationId?: string;
};

export type MemoryCustomType =
	| typeof OM_OBSERVATIONS_RECORDED
	| typeof OM_CHECKPOINT_RECORDED
	| typeof OM_CHECKPOINT_COVERAGE_ADVANCED;

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export function isNonEmptyStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

export function isMemoryId(value: unknown): value is string {
	return isLegacyMemoryId(value) || isObservationId(value);
}

export function isCheckpointRecordId(value: unknown): value is string {
	return isCheckpointId(value);
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

const REQUIRED_CHECKPOINT_HEADINGS = [
	"# Checkpoint",
	"## Current objective",
	"## Progress and decisions",
	"## Important context",
	"## Remaining work",
	"## References and anchors",
] as const;

export function isValidCheckpointMarkdown(content: string): boolean {
	return content.trim().length > 0 && REQUIRED_CHECKPOINT_HEADINGS.every((heading) => content.includes(heading));
}

export function normalizeCheckpoint(value: unknown): Checkpoint | undefined {
	if (!isPlainRecord(value)) return undefined;
	if (!isCheckpointId(value.id) || !isNonEmptyString(value.content) || !isNonEmptyString(value.createdAt) || value.contentFormat !== "markdown") return undefined;
	if (!isValidCheckpointMarkdown(value.content)) return undefined;
	return {
		id: checkpointId(value.id),
		content: value.content,
		createdAt: value.createdAt,
		contentFormat: "markdown",
	};
}

export function isCheckpoint(value: unknown): value is Checkpoint {
	return !!normalizeCheckpoint(value);
}

export function normalizeCheckpointRecordedData(value: unknown): CheckpointRecordedEntryData | undefined {
	if (!isPlainRecord(value) || (value.mode !== "update" && value.mode !== "prune") || !isNonEmptyString(value.coversUpToObservationId) || !Array.isArray(value.observationIds)) return undefined;
	const checkpoint = normalizeCheckpoint(value.checkpoint);
	if (!checkpoint || !value.observationIds.every(isNonEmptyString)) return undefined;
	return {
		mode: value.mode,
		checkpoint,
		coversUpToObservationId: observationId(value.coversUpToObservationId),
		observationIds: value.observationIds.map(observationId),
	};
}

export function isCheckpointRecordedData(value: unknown): value is CheckpointRecordedEntryData {
	return !!normalizeCheckpointRecordedData(value);
}

export function normalizeCheckpointCoverageAdvancedData(value: unknown): CheckpointCoverageAdvancedEntryData | undefined {
	if (!isPlainRecord(value) || !isNonEmptyString(value.coversUpToObservationId) || !Array.isArray(value.observationIds) || !isNonEmptyString(value.reason)) return undefined;
	if (!value.observationIds.every(isNonEmptyString)) return undefined;
	return {
		coversUpToObservationId: observationId(value.coversUpToObservationId),
		observationIds: value.observationIds.map(observationId),
		reason: value.reason,
	};
}

export function isCheckpointCoverageAdvancedData(value: unknown): value is CheckpointCoverageAdvancedEntryData {
	return !!normalizeCheckpointCoverageAdvancedData(value);
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

export function isCheckpointMemoryDetails(value: unknown): value is CheckpointMemoryDetails {
	if (!isPlainRecord(value)) return false;
	return (
		value.type === OM_CHECKPOINT &&
		isCheckpoint(value.checkpoint) &&
		(value.coversUpToObservationId === undefined || isObservationId(value.coversUpToObservationId))
	);
}

export function isObservationsRecordedEntry(entry: Entry): entry is Entry & {
	type: "custom";
	customType: typeof OM_OBSERVATIONS_RECORDED;
	data: ObservationsRecordedEntryData;
} {
	return entry.type === "custom" && entry.customType === OM_OBSERVATIONS_RECORDED && isObservationsRecordedData(entry.data);
}

export function isCheckpointRecordedEntry(entry: Entry): entry is Entry & {
	type: "custom";
	customType: typeof OM_CHECKPOINT_RECORDED;
	data: CheckpointRecordedEntryData;
} {
	return entry.type === "custom" && entry.customType === OM_CHECKPOINT_RECORDED && isCheckpointRecordedData(entry.data);
}

export function isCheckpointCoverageAdvancedEntry(entry: Entry): entry is Entry & {
	type: "custom";
	customType: typeof OM_CHECKPOINT_COVERAGE_ADVANCED;
	data: CheckpointCoverageAdvancedEntryData;
} {
	return entry.type === "custom" && entry.customType === OM_CHECKPOINT_COVERAGE_ADVANCED && isCheckpointCoverageAdvancedData(entry.data);
}

export function buildObservationsRecordedData(
	observations: Observation[],
	coversUpToId: string,
): ObservationsRecordedEntryData | undefined {
	if (!isNonEmptyString(coversUpToId)) return undefined;
	return { observations, coversUpToId };
}

export function buildCheckpointRecordedData(data: CheckpointRecordedEntryData): CheckpointRecordedEntryData | undefined {
	return normalizeCheckpointRecordedData(data);
}

export function buildCheckpointCoverageAdvancedData(data: CheckpointCoverageAdvancedEntryData): CheckpointCoverageAdvancedEntryData | undefined {
	return normalizeCheckpointCoverageAdvancedData(data);
}
