import type { RecallProvenanceEdge } from "../../session-ledger/recall.js";
import type { Observation, Reflection } from "../../session-ledger/index.js";

export type RecallRenderMode = "evidence" | "provenance";

export type RecallObservationToolStatus =
	| "ok"
	| "partial"
	| "invalid_id"
	| "not_found"
	| "no_source";

export type ObservationDetails = Pick<Observation, "id" | "content" | "timestamp"> & { status?: "active" };
export type ReflectionDetails = Pick<Reflection, "id" | "content" | "sources" | "createdAt"> & { reflectionIndex: number };

export type RecallSourceEntryDetails = {
	id: string;
	origin: string;
	timestamp: string;
	tokens: number;
	qualifiers: string[];
	content?: string;
};

export type RecallObservationMatchDetails = {
	status: "active" | "source_unavailable" | "no_source";
	observationEntryId: string;
	observationRecordIndex: number;
	observation: ObservationDetails;
	sourceEntryIds?: string[];
	sourceEntries?: RecallSourceEntryDetails[];
	missingSourceEntryIds?: string[];
	nonSourceEntryIds?: string[];
};

export type RecallUnavailableSupportingObservationDetails = {
	observationId: string;
};

export type RecallUnavailableSupportingReflectionDetails = {
	reflectionId: string;
};

export type RecallObservationToolDetails = {
	status: RecallObservationToolStatus;
	memoryId: string;
	collision: boolean;
	partial: boolean;
	reflections: ReflectionDetails[];
	supportingReflections: ReflectionDetails[];
	provenanceEdges: RecallProvenanceEdge[];
	observations: RecallObservationMatchDetails[];
	sourceEntries: RecallSourceEntryDetails[];
	unavailableSupportingObservations: RecallUnavailableSupportingObservationDetails[];
	unavailableSupportingReflections: RecallUnavailableSupportingReflectionDetails[];
	depthLimitedReflectionIds: string[];
	missingSourceEntryIds: string[];
	nonSourceEntryIds: string[];
	message?: string;
};
