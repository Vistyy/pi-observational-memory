import type { TextContent } from "@earendil-works/pi-ai";

export type RenderableEntry = {
	type: string;
	id?: string;
	timestamp?: string;
	message?: unknown;
	customType?: string;
	content?: unknown;
	summary?: unknown;
	firstKeptEntryId?: string;
	tokensBefore?: number;
};

function pad(n: number): string {
	return n.toString().padStart(2, "0");
}

function fmtLocal(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatTimestamp(v: number | string | undefined): string {
	if (v === undefined) return "????-??-?? ??:??";
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? "????-??-?? ??:??" : fmtLocal(d);
}

export function formatRecallTimestamp(...values: Array<number | string | undefined>): string {
	for (const v of values) {
		if (v === undefined) continue;
		const d = new Date(v);
		if (!Number.isNaN(d.getTime())) return fmtLocal(d);
	}
	return "Unknown time";
}

export function truncateMiddle(content: string, maxChars: number): string {
	if (content.length <= maxChars) return content;
	if (maxChars < 64) return `${content.slice(0, maxChars)} … [truncated ${content.length - maxChars} chars]`;
	const marker = `\n… [truncated middle ${content.length - maxChars} chars]\n`;
	const available = Math.max(0, maxChars - marker.length);
	const headChars = Math.ceil(available / 2);
	const tailChars = Math.floor(available / 2);
	return `${content.slice(0, headChars)}${marker}${content.slice(content.length - tailChars)}`;
}

export function textAndPlaceholders(
	content: unknown,
	options: { omitRedactedThinking?: boolean; includeThinking?: boolean; omitThinking?: boolean; omitToolCalls?: boolean } = {},
): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "[non-text content omitted]";

	const parts: string[] = [];
	for (const block of content as Array<Record<string, unknown>>) {
		if (!block || typeof block !== "object") {
			parts.push("[non-text content omitted]");
			continue;
		}
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
			continue;
		}
		if (block.type === "thinking") {
			if (options.omitThinking || (options.omitRedactedThinking && block.redacted === true)) continue;
			if (options.includeThinking && typeof block.thinking === "string") {
				parts.push(`[thinking: ${block.thinking}]`);
				continue;
			}
			parts.push("[thinking omitted]");
			continue;
		}
		if (block.type === "toolCall" && typeof block.name === "string") {
			if (options.omitToolCalls) continue;
			parts.push(`[${block.name}(${JSON.stringify(block.arguments ?? {})})]`);
			continue;
		}
		parts.push("[non-text content omitted]");
	}
	return parts.join("\n");
}

export function textOnly(content: unknown): string {
	if (content == null) return "";
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((b): b is TextContent => b?.type === "text" && typeof b.text === "string")
		.map((b) => b.text)
		.join("\n");
}
