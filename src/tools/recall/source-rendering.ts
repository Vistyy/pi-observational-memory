import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { renderRecallSourceEntry } from "../../memory/serialization/recall.js";
import { formatRecallTimestamp } from "../../memory/serialization/shared.js";
import { estimateEntryTokens } from "../../memory/token-estimate.js";
import type { Entry } from "../../session-ledger/recall.js";
import type { RecallSourceEntryDetails } from "./types.js";

const MAX_RECALL_SOURCE_CHARS = 12_000;
const MAX_RECALL_SOURCE_ENTRIES = 20;
const MAX_RECALL_SOURCE_ENTRY_CONTENT_CHARS = 4_000;

type BoundedSourceText = {
	text: string;
};

function textContentBlocks(content: unknown): Array<Record<string, unknown>> {
	return Array.isArray(content) ? content.filter((block): block is Record<string, unknown> => !!block && typeof block === "object") : [];
}

function uniqueStrings(items: string[]): string[] {
	return Array.from(new Set(items));
}

function sourceOriginAndQualifiers(entry: Entry): { origin: string; timestamp: string; qualifiers: string[] } {
	if (entry.type === "message" && entry.message && typeof entry.message === "object") {
		const msg = entry.message as Message;
		const timestamp = formatRecallTimestamp(msg.timestamp, entry.timestamp);
		if (msg.role === "user") return { origin: "User", timestamp, qualifiers: [] };
		if (msg.role === "assistant") {
			const toolCalls = uniqueStrings(
				textContentBlocks(msg.content)
					.filter((block) => block.type === "toolCall" && typeof block.name === "string")
					.map((block) => block.name as string),
			);
			return { origin: "Assistant", timestamp, qualifiers: toolCalls.length > 0 ? [`tool calls: ${toolCalls.join(", ")}`] : [] };
		}
		const toolName = (msg as ToolResultMessage).toolName;
		return { origin: `Tool result: ${typeof toolName === "string" && toolName ? toolName : "unknown"}`, timestamp, qualifiers: [] };
	}
	if (entry.type === "custom_message") {
		return {
			origin: "Custom message",
			timestamp: formatRecallTimestamp(entry.timestamp),
			qualifiers: typeof entry.customType === "string" && entry.customType ? [`custom: ${entry.customType}`] : [],
		};
	}
	if (entry.type === "branch_summary") return { origin: "Branch summary", timestamp: formatRecallTimestamp(entry.timestamp), qualifiers: [] };
	return { origin: entry.type || "Entry", timestamp: formatRecallTimestamp(entry.timestamp), qualifiers: [] };
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) return { text, truncated: false };
	return { text: `${text.slice(0, Math.max(0, maxChars - 35)).trimEnd()}\n[truncated ${text.length - maxChars} characters]`, truncated: true };
}

function renderSourceEntryContentOnly(entry: Entry): string | undefined {
	const rendered = renderRecallSourceEntry(entry);
	return rendered?.replace(/^\[[^\]]+\]:\s?/, "") || undefined;
}

function sourceEntryDetails(entry: Entry, includeContent: boolean): RecallSourceEntryDetails {
	const { origin, timestamp, qualifiers } = sourceOriginAndQualifiers(entry);
	const content = renderSourceEntryContentOnly(entry);
	const boundedContent = content ? truncateText(content, MAX_RECALL_SOURCE_ENTRY_CONTENT_CHARS) : undefined;
	return {
		id: entry.id,
		origin,
		timestamp,
		tokens: estimateEntryTokens(entry),
		qualifiers,
		...(includeContent && boundedContent ? { content: boundedContent.text } : {}),
	};
}

export function sourceEntryDetailsList(entries: Entry[], includeContent: boolean): RecallSourceEntryDetails[] {
	return entries.slice(0, MAX_RECALL_SOURCE_ENTRIES).map((entry) => sourceEntryDetails(entry, includeContent));
}

export function renderRecallSourceEntriesBounded(entries: Entry[]): BoundedSourceText {
	const blocks: string[] = [];
	let originalCharacterCount = 0;
	let truncated = false;
	let omittedEntryCount = 0;
	for (const entry of entries) {
		const rendered = renderRecallSourceEntry(entry);
		if (!rendered || rendered.trim().length === 0) continue;
		originalCharacterCount += rendered.length;
		if (blocks.length >= MAX_RECALL_SOURCE_ENTRIES) {
			omittedEntryCount += 1;
			truncated = true;
			continue;
		}
		const prefix = blocks.length > 0 ? "\n\n" : "";
		const remaining = MAX_RECALL_SOURCE_CHARS - blocks.join("\n\n").length - prefix.length;
		if (remaining <= 0) {
			omittedEntryCount += 1;
			truncated = true;
			continue;
		}
		const bounded = truncateText(rendered, remaining);
		blocks.push(bounded.text);
		if (bounded.truncated) {
			truncated = true;
			omittedEntryCount += 1;
		}
	}
	let text = blocks.join("\n\n");
	if (truncated) {
		const note = `[recall sources truncated: rendered ${Math.min(originalCharacterCount, MAX_RECALL_SOURCE_CHARS).toLocaleString()} of ${originalCharacterCount.toLocaleString()} chars; omitted ${omittedEntryCount.toLocaleString()} entr${omittedEntryCount === 1 ? "y" : "ies"}]`;
		text = text ? `${text}\n\n${note}` : note;
	}
	return { text };
}
