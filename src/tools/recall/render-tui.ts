import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { isObservationOnly, sourceEntriesFromDetails } from "./details.js";
import type {
	ObservationDetails,
	RecallObservationToolDetails,
	RecallObservationToolStatus,
	RecallSourceEntryDetails,
	ReflectionDetails,
} from "./types.js";

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
	return `${n.toLocaleString()} ${n === 1 ? singular : pluralForm}`;
}

function tokenSummary(tokens: number): string {
	return `~${tokens.toLocaleString()} ${tokens === 1 ? "token" : "tokens"}`;
}

function isFailureStatus(status: RecallObservationToolStatus): boolean {
	return status === "invalid_id" || status === "not_found";
}

export function formatRecallHeaderForTui(details: RecallObservationToolDetails): string {
	if (isFailureStatus(details.status)) return "× failure";
	const parts = ["✓ success"];
	if (details.reflections.length > 0) parts.push(plural(details.reflections.length, "reflection"));
	if (details.observations.length > 0) parts.push(plural(details.observations.length, "observation"));
	const sources = sourceEntriesFromDetails(details);
	if (sources.length > 0) parts.push(plural(sources.length, "source"));
	const tokens = sources.reduce((sum, source) => sum + source.tokens, 0);
	if (tokens > 0) parts.push(tokenSummary(tokens));
	if (details.partial && details.status !== "ok") parts.push(details.status.replace(/_/g, " "));
	return parts.join(" · ");
}

const TUI_TYPE_WIDTH = 15;
const TUI_META_WIDTH = 31;

function alignedRow(type: string, meta: string, text: string): string {
	return `${type.padEnd(TUI_TYPE_WIDTH)} ${meta.padEnd(TUI_META_WIDTH)} ${text}`.trimEnd();
}

function sourceTag(source: RecallSourceEntryDetails): string {
	const origin = source.origin.trim().toLowerCase();
	if (origin === "user") return "user";
	if (origin === "assistant") return "assistant";
	if (origin.startsWith("tool result")) return "tool";
	if (origin.startsWith("custom message")) return "custom";
	if (origin.startsWith("branch summary")) return "summary";
	return origin.split(/[^a-z0-9]+/).find(Boolean) ?? "entry";
}

function sourceMetadataLine(source: RecallSourceEntryDetails): string {
	return alignedRow("✓ source", `${source.timestamp} [${sourceTag(source)}]`, tokenSummary(source.tokens));
}

function observationLine(observation: ObservationDetails): string {
	return alignedRow("✓ observation", observation.timestamp, observation.content);
}

function reflectionLine(reflection: ReflectionDetails): string {
	return alignedRow("✓ reflection", "", reflection.content);
}

function noteLine(kind: string, text: string): string {
	return alignedRow("• note", `[${kind}]`, text);
}

function indentContent(content: string): string {
	return content.split("\n").map((line) => `    ${line}`).join("\n");
}

function pushSourceLines(lines: string[], sources: RecallSourceEntryDetails[], expanded: boolean): void {
	for (const source of sources) {
		lines.push(sourceMetadataLine(source));
		if (expanded && source.content) {
			lines.push(indentContent(source.content));
			lines.push("");
		}
	}
}

function memoryRows(details: RecallObservationToolDetails): string[] {
	if (isObservationOnly(details)) return details.observations.map((match) => observationLine(match.observation));
	return [...details.reflections.map((reflection) => reflectionLine(reflection)), ...details.supportingReflections.map((reflection) => reflectionLine(reflection)), ...details.observations.map((observation) => observationLine(observation.observation))];
}

function noteRows(details: RecallObservationToolDetails, sources: RecallSourceEntryDetails[]): string[] {
	const notes: string[] = [];
	if (details.status === "invalid_id") {
		notes.push(noteLine("invalid id", `memory ids must be 12 lowercase hex characters; received ${details.memoryId}`));
		return notes;
	}
	if (details.status === "not_found") {
		notes.push(noteLine("not found", `no observation or reflection with id ${details.memoryId} was found on the current branch`));
		return notes;
	}
	if (details.collision) notes.push(noteLine("id collision", `multiple memory items share ${details.memoryId}`));
	if (details.unavailableSupportingObservations.length > 0) notes.push(noteLine("missing support", details.unavailableSupportingObservations.map((item) => item.observationId).join(", ")));
	if (details.unavailableSupportingReflections.length > 0) notes.push(noteLine("missing ref", details.unavailableSupportingReflections.map((item) => item.reflectionId).join(", ")));
	if (details.depthLimitedReflectionIds.length > 0) notes.push(noteLine("depth limit", details.depthLimitedReflectionIds.join(", ")));
	if (details.missingSourceEntryIds.length > 0) notes.push(noteLine("missing source", details.missingSourceEntryIds.join(", ")));
	if (details.nonSourceEntryIds.length > 0) notes.push(noteLine("non-source", details.nonSourceEntryIds.join(", ")));
	if (sources.length === 0 && (details.reflections.length > 0 || details.observations.length > 0)) notes.push(noteLine("unavailable evidence", "no source entries are available for this memory id"));
	return notes;
}

export function formatRecallResultForTui(result: AgentToolResult<RecallObservationToolDetails>, expanded: boolean): string {
	const details = result.details;
	if (!details) {
		const text = result.content.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
		return text || "recall";
	}
	const sources = sourceEntriesFromDetails(details);
	const lines: string[] = [];
	const rows = memoryRows(details);
	const notes = noteRows(details, sources);
	lines.push(...rows);
	if (rows.length > 0 && notes.length > 0) lines.push("");
	lines.push(...notes);
	if ((rows.length > 0 || notes.length > 0) && sources.length > 0) lines.push("");
	pushSourceLines(lines, sources, expanded);
	if (!expanded && sources.some((source) => source.content)) lines.push("", "(Ctrl+O to expand)");
	return lines.join("\n").trimEnd();
}

export function formatRecallCallForTui(id: string | undefined): string {
	return `recall ${id ?? "..."}`;
}

export function formatRecallRenderedResultForTui(result: AgentToolResult<RecallObservationToolDetails>, expanded: boolean): string {
	const body = formatRecallResultForTui(result, expanded);
	const header = result.details ? formatRecallHeaderForTui(result.details) : undefined;
	if (header && body) return `\n${header}\n\n${body}`;
	if (header) return `\n${header}`;
	return body ? `\n${body}` : "";
}
