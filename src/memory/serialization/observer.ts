import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { ObserverToolOutputPolicy } from "../../config.js";
import { formatTimestamp, textAndPlaceholders, truncateMiddle, type RenderableEntry } from "./shared.js";

export type SourceAddressedSerialization = {
	text: string;
	sourceEntryIds: string[];
};

export type ObserverToolRenderingOptions = {
	toolResultSummaryMaxLines: number;
	toolResultErrorMaxLines: number;
	toolResultLineMaxChars: number;
	toolOutputPolicies: Record<string, ObserverToolOutputPolicy>;
	allowTailIncompleteToolCalls?: boolean;
};

const OBSERVER_ENTRY_MAX_CHARS = 12_000;
const RESULT_TOTAL_LINE_BOUND = 30;
const RESULT_HEAD_LINES = 10;
const RESULT_TAIL_LINES = 20;
const ARGUMENT_TOTAL_LINE_BOUND = 10;
const ARGUMENT_HEAD_LINES = 5;
const ARGUMENT_TAIL_LINES = 5;
const LINE_TRUNCATION_SUFFIX = "…[trunc]";

type ToolStatus = "success" | "error" | "incomplete/no result";

type ToolCallPart = {
	id?: string;
	name: string;
	arguments?: unknown;
};

type ToolResultEntry = {
	entry: RenderableEntry;
	message: Record<string, any>;
	toolCallId?: string;
};

type ObserverRecord = {
	entryIds: string[];
	rendered: string | null;
};

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}

function unique(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		if (seen.has(value)) continue;
		seen.add(value);
		out.push(value);
	}
	return out;
}

function normalizeBody(text: string): string {
	return text.trim();
}

function truncateLine(line: string, maxChars: number): { text: string; omitted: boolean } {
	if (line.length <= maxChars) return { text: line, omitted: false };
	if (maxChars <= LINE_TRUNCATION_SUFFIX.length + 1) return { text: line.slice(0, maxChars), omitted: true };
	return { text: `${line.slice(0, maxChars - LINE_TRUNCATION_SUFFIX.length)}${LINE_TRUNCATION_SUFFIX}`, omitted: true };
}

type BoundedText = { text: string; omitted: boolean };

function boundedLines(text: string, args: { allLineLimit: number; headLines: number; tailLines: number; lineMaxChars: number }): BoundedText {
	const body = normalizeBody(text);
	if (!body) return { text: "[no textual output]", omitted: false };
	const lines = body.split(/\r?\n/);
	const omittedByLines = lines.length > args.allLineLimit;
	const selected = omittedByLines
		? [
			...lines.slice(0, args.headLines),
			`[... omitted ${lines.length - args.headLines - args.tailLines} lines ...]`,
			...lines.slice(-args.tailLines),
		]
		: lines;
	const rendered = selected.map((line) => line.startsWith("[... omitted ") ? { text: line, omitted: false } : truncateLine(line, args.lineMaxChars));
	return {
		text: rendered.map((line) => line.text).join("\n"),
		omitted: omittedByLines || rendered.some((line) => line.omitted),
	};
}

function boundedResult(text: string, lineMaxChars: number): BoundedText {
	return boundedLines(text, {
		allLineLimit: RESULT_TOTAL_LINE_BOUND,
		headLines: RESULT_HEAD_LINES,
		tailLines: RESULT_TAIL_LINES,
		lineMaxChars,
	});
}

function boundedArguments(text: string, lineMaxChars: number): BoundedText {
	return boundedLines(text, {
		allLineLimit: ARGUMENT_TOTAL_LINE_BOUND,
		headLines: ARGUMENT_HEAD_LINES,
		tailLines: ARGUMENT_TAIL_LINES,
		lineMaxChars,
	});
}

function toolPolicy(toolName: string, status: ToolStatus, options: ObserverToolRenderingOptions): ObserverToolOutputPolicy {
	if (status === "error") return "bounded";
	if (status === "incomplete/no result") return "bounded";
	return options.toolOutputPolicies[toolName] ?? (toolName === "bash" ? "bounded" : "omit");
}

function argumentText(value: unknown): string {
	if (value === undefined) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2) ?? "";
	} catch {
		return String(value);
	}
}

function extractToolCalls(content: unknown): ToolCallPart[] {
	if (!Array.isArray(content)) return [];
	const calls: ToolCallPart[] = [];
	for (const block of content as Array<Record<string, unknown>>) {
		if (!isRecord(block) || block.type !== "toolCall" || typeof block.name !== "string") continue;
		calls.push({
			id: typeof block.id === "string" ? block.id : undefined,
			name: block.name,
			arguments: block.arguments,
		});
	}
	return calls;
}

function laterUserMessageExists(entries: RenderableEntry[], startIndex: number): boolean {
	for (let i = startIndex + 1; i < entries.length; i++) {
		const message = entries[i]?.message;
		if (isRecord(message) && message.role === "user") return true;
	}
	return false;
}

function hasAbortMarker(message: Record<string, any>): boolean {
	return typeof message.errorMessage === "string" || message.stopReason === "aborted" || message.stopReason === "error";
}

function isAbandonedToolCallMessage(entries: RenderableEntry[], index: number, message: Record<string, any>, options: ObserverToolRenderingOptions): boolean {
	return hasAbortMarker(message) || laterUserMessageExists(entries, index) || options.allowTailIncompleteToolCalls === true;
}

function renderUserMessage(entry: RenderableEntry, msg: Record<string, any>, time: string): string | null {
	const body = normalizeBody(textAndPlaceholders(msg.content));
	return body ? `[User @ ${time}]: ${truncateMiddle(body, OBSERVER_ENTRY_MAX_CHARS)}` : null;
}

function renderAssistantText(entry: RenderableEntry, msg: Record<string, any>, time: string): string | null {
	const body = normalizeBody(textAndPlaceholders(msg.content, { omitThinking: true, omitToolCalls: true }));
	return body ? `[Assistant @ ${time}]: ${truncateMiddle(body, OBSERVER_ENTRY_MAX_CHARS)}` : null;
}

function renderToolInteraction(args: {
	time: string;
	toolName: string;
	status: ToolStatus;
	argumentsText?: string;
	resultText?: string;
	options: ObserverToolRenderingOptions;
}): string | null {
	const policy = toolPolicy(args.toolName, args.status, args.options);
	if (policy === "omit") return null;

	const lines = [`[Tool interaction: ${args.toolName} @ ${args.time}]`, `tool: ${args.toolName}`, `status: ${args.status}`];
	const rawArguments = normalizeBody(args.argumentsText ?? "");
	if (rawArguments) {
		const renderedArguments = policy === "full"
			? { text: rawArguments, omitted: false }
			: boundedArguments(rawArguments, args.options.toolResultLineMaxChars);
		lines.push(`arguments_omitted: ${renderedArguments.omitted ? "true" : "false"}`);
		lines.push("arguments:");
		lines.push(renderedArguments.text);
	}

	if (args.status !== "incomplete/no result") {
		const rawResult = args.resultText ?? "";
		const outputChars = normalizeBody(rawResult).length;
		const renderedResult = policy === "full"
			? { text: normalizeBody(rawResult) || "[no textual output]", omitted: false }
			: boundedResult(rawResult, args.options.toolResultLineMaxChars);
		lines.push(`result_chars: ${outputChars}`);
		lines.push(`result_omitted: ${renderedResult.omitted ? "true" : "false"}`);
		lines.push("result:");
		lines.push(renderedResult.text);
	}

	return lines.join("\n");
}

function renderLegacyBashExecution(entry: RenderableEntry, msg: Record<string, any>, time: string, options: ObserverToolRenderingOptions): string | null {
	const command = typeof msg.command === "string" ? msg.command : "";
	const output = typeof msg.output === "string" ? msg.output : "";
	const exitCode = typeof msg.exitCode === "number" ? msg.exitCode : undefined;
	const status: ToolStatus = typeof exitCode === "number" && exitCode !== 0 ? "error" : "success";
	const argumentsText = command ? argumentText({ command, exitCode, truncated: msg.truncated === true }) : argumentText({ exitCode, truncated: msg.truncated === true });
	return renderToolInteraction({
		time,
		toolName: "bash",
		status,
		argumentsText,
		resultText: output,
		options,
	});
}

function renderStandaloneToolResult(entry: RenderableEntry, msg: Record<string, any>, time: string, options: ObserverToolRenderingOptions): string | null {
	const toolName = (msg as ToolResultMessage).toolName ?? "unknown";
	const status: ToolStatus = msg.isError === true ? "error" : "success";
	return renderToolInteraction({
		time,
		toolName,
		status,
		resultText: textAndPlaceholders(msg.content),
		options,
	});
}

function toolResultTime(result: ToolResultEntry, fallback: string | number | undefined): string {
	const timestamp = typeof result.message.timestamp === "string" || typeof result.message.timestamp === "number"
		? result.message.timestamp
		: result.entry.timestamp ?? fallback;
	return formatTimestamp(timestamp);
}

function buildToolResultMap(entries: RenderableEntry[]): Map<string, ToolResultEntry> {
	const results = new Map<string, ToolResultEntry>();
	for (const entry of entries) {
		if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "toolResult") continue;
		const toolCallId = typeof entry.message.toolCallId === "string" ? entry.message.toolCallId : undefined;
		if (!toolCallId) continue;
		results.set(toolCallId, { entry, message: entry.message, toolCallId });
	}
	return results;
}

function record(entryIds: string[], rendered: string | null): ObserverRecord {
	return { entryIds: unique(entryIds.filter(Boolean)), rendered };
}

function buildObserverRecords(entries: RenderableEntry[], options: ObserverToolRenderingOptions): ObserverRecord[] {
	const records: ObserverRecord[] = [];
	const toolResultsByCallId = buildToolResultMap(entries);
	const consumedToolResultEntryIds = new Set<string>();

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.type !== "message" || !entry.id || !isRecord(entry.message)) continue;
		const msg = entry.message;
		const time = formatTimestamp(typeof msg.timestamp === "string" || typeof msg.timestamp === "number" ? msg.timestamp : entry.timestamp);

		if (msg.role === "user") {
			records.push(record([entry.id], renderUserMessage(entry, msg, time)));
			continue;
		}

		if (msg.role === "assistant") {
			const toolCalls = extractToolCalls(msg.content);
			if (toolCalls.length === 0) {
				records.push(record([entry.id], renderAssistantText(entry, msg, time)));
				continue;
			}

			const missingToolCalls = toolCalls.filter((call) => !call.id || !toolResultsByCallId.has(call.id));
			if (missingToolCalls.length > 0 && !isAbandonedToolCallMessage(entries, i, msg, options)) break;

			records.push(record([entry.id], renderAssistantText(entry, msg, time)));
			for (const call of toolCalls) {
				const result = call.id ? toolResultsByCallId.get(call.id) : undefined;
				if (result?.entry.id) {
					consumedToolResultEntryIds.add(result.entry.id);
					const status: ToolStatus = result.message.isError === true ? "error" : "success";
					records.push(record(
						[entry.id, result.entry.id],
						renderToolInteraction({
							time: toolResultTime(result, msg.timestamp ?? entry.timestamp),
							toolName: call.name,
							status,
							argumentsText: argumentText(call.arguments),
							resultText: textAndPlaceholders(result.message.content),
							options,
						}),
					));
					continue;
				}

				records.push(record(
					[entry.id],
					renderToolInteraction({
						time,
						toolName: call.name,
						status: "incomplete/no result",
						argumentsText: argumentText(call.arguments),
						options,
					}),
				));
			}
			continue;
		}

		if (msg.role === "toolResult") {
			if (consumedToolResultEntryIds.has(entry.id)) continue;
			records.push(record([entry.id], renderStandaloneToolResult(entry, msg, time, options)));
			continue;
		}

		if (msg.role === "bashExecution") {
			records.push(record([entry.id], renderLegacyBashExecution(entry, msg, time, options)));
		}
	}

	return records;
}

function sourceLabel(ids: string[]): string {
	return ids.length === 1 ? `[Source entry id: ${ids[0]}]` : `[Source entry ids: ${ids.join(", ")}]`;
}

export function serializeObserverSourceEntries(
	entries: RenderableEntry[],
	options: ObserverToolRenderingOptions,
): SourceAddressedSerialization {
	const blocks: string[] = [];
	const sourceEntryIds: string[] = [];
	for (const observerRecord of buildObserverRecords(entries, options)) {
		if (!observerRecord.rendered?.trim()) continue;
		const ids = observerRecord.entryIds;
		if (ids.length === 0) continue;
		sourceEntryIds.push(...ids);
		blocks.push(`${sourceLabel(ids)}\n${observerRecord.rendered}`);
	}
	return { text: blocks.join("\n\n"), sourceEntryIds: unique(sourceEntryIds) };
}
