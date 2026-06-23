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
};

const OBSERVER_ENTRY_MAX_CHARS = 12_000;

function toolEvidencePolicy(toolName: string, status: "ok" | "error", role: "toolResult" | "bashExecution", options: ObserverToolRenderingOptions): ObserverToolOutputPolicy {
	if (status === "error") return "bounded-excerpt";
	if (role === "bashExecution") return "bounded-excerpt";
	return options.toolOutputPolicies[toolName] ?? "metadata-only";
}

function normalizeBody(text: string): string {
	return text.trim();
}

function truncateLine(line: string, maxChars: number): { text: string; omitted: boolean } {
	return line.length > maxChars ? { text: truncateMiddle(line, maxChars), omitted: true } : { text: line, omitted: false };
}

type RenderedExcerpt = { excerpt: string; omitted: boolean; reason?: "policy" | "length" };

function renderExcerpt(text: string, maxLines: number, lineMaxChars: number): RenderedExcerpt {
	const body = normalizeBody(text);
	if (!body) return { excerpt: "[no textual output]", omitted: false };
	if (maxLines <= 0) return { excerpt: "[output omitted by observer policy]", omitted: true, reason: "policy" };

	const lines = body.split(/\r?\n/);
	const allowed = Math.min(lines.length, maxLines);

	const selected = lines.length <= allowed
		? lines
		: [
			...lines.slice(0, Math.ceil(allowed / 2)),
			...lines.slice(-Math.floor(allowed / 2)),
		];
	const rendered = selected.map((line) => truncateLine(line, lineMaxChars));
	const omittedByLineChars = rendered.some((line) => line.omitted);
	const omittedByLines = lines.length > allowed;
	const omittedMiddle = lines.length - selected.length;
	const excerptLines = rendered.map((line) => line.text);
	if (omittedByLines && omittedMiddle > 0) {
		excerptLines.splice(Math.ceil(allowed / 2), 0, `… [truncated middle ${omittedMiddle} lines]`);
	}
	return {
		excerpt: excerptLines.join("\n"),
		omitted: omittedByLines || omittedByLineChars,
		reason: omittedByLines || omittedByLineChars ? "length" : undefined,
	};
}

function inputSummary(msg: Record<string, any>): string | undefined {
	const candidates = [msg.command, msg.input, msg.path, msg.filePath, msg.name]
		.filter((value): value is string => typeof value === "string" && value.length > 0);
	if (candidates.length === 0) return undefined;
	return truncateMiddle(candidates.join(" "), 300);
}

function renderToolEvidence(args: {
	time: string;
	toolName: string;
	status: "ok" | "error";
	content: string;
	options: ObserverToolRenderingOptions;
	input?: string;
	exitCode?: number | string;
	truncated?: boolean;
	role: "toolResult" | "bashExecution";
}): string | null {
	const policy = toolEvidencePolicy(args.toolName, args.status, args.role, args.options);
	if (policy === "metadata-only") return null;
	const maxLines = policy === "full-excerpt"
		? Number.MAX_SAFE_INTEGER
		: args.status === "error" ? args.options.toolResultErrorMaxLines : args.options.toolResultSummaryMaxLines;
	const outputChars = normalizeBody(args.content).length;
	const { excerpt, omitted, reason } = renderExcerpt(args.content, maxLines, args.options.toolResultLineMaxChars);
	const lines = [`[Tool evidence: ${args.toolName} @ ${args.time}]`, `status: ${args.status}`, `output_chars: ${outputChars}`];
	if (args.input) lines.push(`input: ${args.input}`);
	if (args.exitCode !== undefined) lines.push(`exitCode: ${args.exitCode}`);
	if (args.truncated !== undefined) lines.push(`tool_truncated: ${args.truncated ? "true" : "false"}`);
	lines.push(`output_omitted: ${omitted ? "true" : "false"}${reason ? ` (${reason})` : ""}`);
	lines.push("excerpt:");
	lines.push(excerpt);
	return lines.join("\n");
}

function renderObserverMessage(entry: RenderableEntry, options: ObserverToolRenderingOptions): string | null {
	if (!entry.message || typeof entry.message !== "object") return null;
	const msg = entry.message as Record<string, any>;
	const time = formatTimestamp(typeof msg.timestamp === "string" || typeof msg.timestamp === "number" ? msg.timestamp : entry.timestamp);

	if (msg.role === "user") {
		const body = normalizeBody(textAndPlaceholders(msg.content));
		return body ? `[User @ ${time}]: ${truncateMiddle(body, OBSERVER_ENTRY_MAX_CHARS)}` : null;
	}
	if (msg.role === "assistant") {
		const body = normalizeBody(textAndPlaceholders(msg.content, { omitThinking: true, omitToolCalls: true }));
		return body ? `[Assistant @ ${time}]: ${truncateMiddle(body, OBSERVER_ENTRY_MAX_CHARS)}` : null;
	}
	if (msg.role === "toolResult") {
		const toolName = (msg as ToolResultMessage).toolName ?? "unknown";
		const status = msg.isError === true ? "error" : "ok";
		return renderToolEvidence({
			time,
			toolName,
			status,
			content: textAndPlaceholders(msg.content),
			options,
			input: inputSummary(msg),
			role: "toolResult",
		});
	}
	if (msg.role === "bashExecution") {
		const command = typeof msg.command === "string" ? msg.command : "";
		const output = typeof msg.output === "string" ? msg.output : "";
		const exitCode = typeof msg.exitCode === "number" ? msg.exitCode : "unknown";
		const status = typeof msg.exitCode === "number" && msg.exitCode !== 0 ? "error" : "ok";
		if (status === "ok" && normalizeBody(output).length === 0) return null;
		return renderToolEvidence({
			time,
			toolName: "bash",
			status,
			content: output,
			options,
			input: command,
			exitCode,
			truncated: msg.truncated === true,
			role: "bashExecution",
		});
	}
	return null;
}

function renderObserverSourceEntry(entry: RenderableEntry, options: ObserverToolRenderingOptions): string | null {
	if (entry.type === "message") return renderObserverMessage(entry, options);
	return null;
}

function isObserverSourceEntry(entry: RenderableEntry): boolean {
	return entry.type === "message";
}

export function serializeObserverSourceEntries(
	entries: RenderableEntry[],
	options: ObserverToolRenderingOptions,
): SourceAddressedSerialization {
	const blocks: string[] = [];
	const sourceEntryIds: string[] = [];
	for (const entry of entries) {
		if (!entry.id || !isObserverSourceEntry(entry)) continue;
		const rendered = renderObserverSourceEntry(entry, options);
		if (!rendered?.trim()) continue;
		sourceEntryIds.push(entry.id);
		blocks.push(`[Source entry id: ${entry.id}]\n${rendered}`);
	}
	return { text: blocks.join("\n\n"), sourceEntryIds };
}
