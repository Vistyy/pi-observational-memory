import type { RecallResult, RecalledObservation } from "../../session-ledger/recall.js";
import type { Observation, Reflection } from "../../session-ledger/index.js";
import { sourceEntryDetailsList } from "./source-rendering.js";
import type {
	ObservationDetails,
	RecallObservationMatchDetails,
	RecallObservationToolDetails,
	RecallObservationToolStatus,
	RecallSourceEntryDetails,
	ReflectionDetails,
} from "./types.js";

export function textResult(text: string, details: RecallObservationToolDetails) {
	return { content: [{ type: "text" as const, text }], details };
}

export function emptyDetails(status: RecallObservationToolStatus, memoryId: string, message: string): RecallObservationToolDetails {
	return {
		status,
		memoryId,
		collision: false,
		partial: false,
		reflections: [],
		supportingReflections: [],
		provenanceEdges: [],
		observations: [],
		sourceEntries: [],
		unavailableSupportingObservations: [],
		unavailableSupportingReflections: [],
		depthLimitedReflectionIds: [],
		missingSourceEntryIds: [],
		nonSourceEntryIds: [],
		message,
	};
}

export function observationDetails(observation: Observation, status?: "active"): ObservationDetails {
	return { id: observation.id, content: observation.content, timestamp: observation.timestamp, ...(status ? { status } : {}) };
}

export function reflectionDetails(reflection: Reflection, reflectionIndex: number): ReflectionDetails {
	return { id: reflection.id, content: reflection.content, sources: reflection.sources, createdAt: reflection.createdAt, reflectionIndex };
}

export function observationMatchDetails(match: RecalledObservation, includeSourceContent = true): RecallObservationMatchDetails {
	const unavailable = match.missingSourceEntryIds.length > 0 || match.nonSourceEntryIds.length > 0;
	const status = unavailable ? "source_unavailable" : match.sourceEntries.length === 0 ? "no_source" : match.status;
	return {
		status,
		observationEntryId: match.observationEntryId,
		observationRecordIndex: match.observationRecordIndex,
		observation: observationDetails(match.observation, match.status),
		sourceEntryIds: match.sourceEntryIds,
		sourceEntries: sourceEntryDetailsList(match.sourceEntries, includeSourceContent),
		missingSourceEntryIds: match.missingSourceEntryIds,
		nonSourceEntryIds: match.nonSourceEntryIds,
	};
}

function aggregateStatus(details: Omit<RecallObservationToolDetails, "status">): RecallObservationToolStatus {
	const observationOnly = details.reflections.length === 0 && details.unavailableSupportingObservations.length === 0;
	if (details.partial) return "partial";
	if (observationOnly && details.observations.length > 0 && details.sourceEntries.length === 0 && details.observations.every((match) => (match.sourceEntries ?? []).length === 0)) return "no_source";
	return "ok";
}

export function resultDetails(result: Extract<RecallResult, { status: "found" }>, includeSourceContent = true): RecallObservationToolDetails {
	const reflections = result.reflections.map((match) => reflectionDetails(match.reflection, match.reflectionRecordIndex));
	const supportingReflections = result.supportingReflections.map((match) => reflectionDetails(match.reflection, match.reflectionRecordIndex));
	const observations = result.observations.map((match) => observationMatchDetails(match, includeSourceContent));
	const sourceEntries = sourceEntryDetailsList(result.sourceEntries, includeSourceContent);
	const detailWithoutStatus = {
		memoryId: result.memoryId,
		collision: result.collision,
		partial: result.partial,
		reflections,
		supportingReflections,
		provenanceEdges: result.provenanceEdges,
		observations,
		sourceEntries,
		unavailableSupportingObservations: result.missingSupportingObservationIds.map((observationId) => ({ observationId })),
		unavailableSupportingReflections: result.missingSupportingReflectionIds.map((reflectionId) => ({ reflectionId })),
		depthLimitedReflectionIds: result.depthLimitedReflectionIds,
		missingSourceEntryIds: result.missingSourceEntryIds,
		nonSourceEntryIds: result.nonSourceEntryIds,
	};
	return { status: aggregateStatus(detailWithoutStatus), ...detailWithoutStatus };
}

export function isObservationOnly(details: RecallObservationToolDetails): boolean {
	return details.reflections.length === 0 && details.supportingReflections.length === 0 && details.unavailableSupportingObservations.length === 0 && details.unavailableSupportingReflections.length === 0;
}

export function sourceEntriesFromDetails(details: RecallObservationToolDetails): RecallSourceEntryDetails[] {
	if (!isObservationOnly(details)) return details.sourceEntries;
	return details.observations.flatMap((match) => match.sourceEntries ?? []);
}
