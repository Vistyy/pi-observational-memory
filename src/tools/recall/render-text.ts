import type { RecallProvenanceEdge, RecallResult, RecalledObservation } from "../../session-ledger/recall.js";
import { isLegacyMemoryId, observationId } from "../../memory/ids.js";
import {
	observationDetails,
	observationMatchDetails,
	reflectionDetails,
	resultDetails,
	textResult,
} from "./details.js";
import { renderRecallSourceEntriesBounded } from "./source-rendering.js";
import type {
	ObservationDetails,
	RecallObservationMatchDetails,
	RecallRenderMode,
	RecallUnavailableSupportingObservationDetails,
	RecallUnavailableSupportingReflectionDetails,
	ReflectionDetails,
} from "./types.js";

function friendlyNoSourceMessage(memoryId: string): string {
	return `Observation ${memoryId} has no source entries associated with it.`;
}

function friendlySourceUnavailableMessage(match: RecallObservationMatchDetails): string {
	const missing = match.missingSourceEntryIds && match.missingSourceEntryIds.length > 0 ? ` missing: ${match.missingSourceEntryIds.join(", ")}` : "";
	const nonSource = match.nonSourceEntryIds && match.nonSourceEntryIds.length > 0 ? ` non-source: ${match.nonSourceEntryIds.join(", ")}` : "";
	return `Observation ${match.observation.id} has source entries associated, but some are unavailable on the current branch or are not source-renderable.${missing}${nonSource}`;
}

function reflectionLineText(reflection: ReflectionDetails): string {
	return `[${reflection.id}] ${reflection.content}`;
}

function observationLineText(observation: ObservationDetails): string {
	return `[${observation.id}] ${observation.timestamp} ${observation.content}`;
}

function directObservationMatches(result: Extract<RecallResult, { status: "found" }>): RecalledObservation[] {
	const lookupId = isLegacyMemoryId(result.memoryId) ? observationId(result.memoryId) : result.memoryId;
	return result.observations.filter((match) => match.observation.id === lookupId);
}

function renderObservationOnlyTextFromResult(result: Extract<RecallResult, { status: "found" }>): string {
	const sections: string[] = [];
	if (result.collision) sections.push(`Memory id ${result.memoryId} matched multiple observations; returning all matching source results from the current branch.`);
	const matches = directObservationMatches(result);
	if (matches.length > 0) sections.push(`Observations:\n${matches.map((match) => observationLineText(observationDetails(match.observation, match.status))).join("\n")}`);
	for (const match of matches) {
		if (match.missingSourceEntryIds.length > 0 || match.nonSourceEntryIds.length > 0) {
			sections.push(friendlySourceUnavailableMessage(observationMatchDetails(match, false)));
			continue;
		}
		if (match.sourceEntries.length === 0) {
			sections.push(friendlyNoSourceMessage(match.observation.id));
			continue;
		}
		const sourceText = renderRecallSourceEntriesBounded(match.sourceEntries).text;
		sections.push(sourceText.trim() ? `Sources:\n${sourceText}` : `Observation ${match.observation.id} has source entries associated, but they rendered no text content.`);
	}
	return sections.join("\n\n");
}

function unavailableSupportingLineText(item: RecallUnavailableSupportingObservationDetails): string {
	return `Supporting observation ${item.observationId} is unavailable on the current branch.`;
}

function unavailableSupportingReflectionLineText(item: RecallUnavailableSupportingReflectionDetails): string {
	return `Supporting reflection ${item.reflectionId} is unavailable on the current branch.`;
}

function provenanceLineText(edge: RecallProvenanceEdge): string {
	return `${edge.fromId} -> ${edge.toId}`;
}

function renderMemoryText(result: Extract<RecallResult, { status: "found" }>, mode: RecallRenderMode): string {
	const sections: string[] = [];
	if (result.collision) sections.push(`Memory id ${result.memoryId} matched multiple observations/reflections; returning all available evidence from the current branch.`);
	if (result.reflections.length > 0) sections.push(`Reflections:\n${result.reflections.map((match) => reflectionLineText(reflectionDetails(match.reflection, match.reflectionRecordIndex))).join("\n")}`);
	if (mode === "provenance" && result.supportingReflections.length > 0) sections.push(`Supporting reflections:\n${result.supportingReflections.map((match) => reflectionLineText(reflectionDetails(match.reflection, match.reflectionRecordIndex))).join("\n")}`);
	if (result.provenanceEdges.length > 0) sections.push(`Provenance:\n${result.provenanceEdges.map(provenanceLineText).join("\n")}`);
	if (result.observations.length > 0) sections.push(`Observations:\n${result.observations.map((match) => observationLineText(observationDetails(match.observation, match.status))).join("\n")}`);
	if (result.missingSupportingObservationIds.length > 0) sections.push(`Unavailable supporting observations:\n${result.missingSupportingObservationIds.map((id) => unavailableSupportingLineText({ observationId: id })).join("\n")}`);
	if (result.missingSupportingReflectionIds.length > 0) sections.push(`Unavailable supporting reflections:\n${result.missingSupportingReflectionIds.map((id) => unavailableSupportingReflectionLineText({ reflectionId: id })).join("\n")}`);
	if (result.depthLimitedReflectionIds.length > 0) sections.push(`Depth-limited supporting reflections:\n${result.depthLimitedReflectionIds.join("\n")}`);
	if (result.missingSourceEntryIds.length > 0 || result.nonSourceEntryIds.length > 0) {
		const parts: string[] = [];
		if (result.missingSourceEntryIds.length > 0) parts.push(`missing: ${result.missingSourceEntryIds.join(", ")}`);
		if (result.nonSourceEntryIds.length > 0) parts.push(`non-source: ${result.nonSourceEntryIds.join(", ")}`);
		sections.push(`Unavailable source entries: ${parts.join("; ")}`);
	}
	const sourceText = renderRecallSourceEntriesBounded(result.sourceEntries).text;
	if (sourceText.trim()) sections.push(`Sources:\n${sourceText}`);
	if (sections.length === 0) sections.push(`Memory ${result.memoryId} was found, but no source evidence rendered.`);
	return sections.join("\n\n");
}

export function recallRenderMode(params: { mode?: unknown }): RecallRenderMode {
	return params.mode === "provenance" ? "provenance" : "evidence";
}

export function renderFoundResult(result: Extract<RecallResult, { status: "found" }>, mode: RecallRenderMode): ReturnType<typeof textResult> {
	const details = resultDetails(result);
	const text = result.kind === "observation" ? renderObservationOnlyTextFromResult(result) : renderMemoryText(result, mode);
	return textResult(text, details);
}
