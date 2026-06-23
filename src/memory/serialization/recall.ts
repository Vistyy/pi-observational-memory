import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { formatRecallTimestamp, textAndPlaceholders, type RenderableEntry } from "./shared.js";

function renderCustomMessage(entry: RenderableEntry): string {
	const time = formatRecallTimestamp(entry.timestamp);
	const text = textAndPlaceholders(entry.content);
	const origin = entry.customType ? `Custom message (${entry.customType})` : "Custom message";
	return `[${origin} @ ${time}]: ${text}`;
}

function renderRecallMessage(entry: RenderableEntry): string | null {
	if (!entry.message || typeof entry.message !== "object") return null;
	const msg = entry.message as Record<string, any>;
	const time = formatRecallTimestamp(
		typeof msg.timestamp === "string" || typeof msg.timestamp === "number" ? msg.timestamp : undefined,
		entry.timestamp,
	);
	if (msg.role === "user") {
		return `[User @ ${time}]: ${textAndPlaceholders(msg.content)}`;
	}
	if (msg.role === "assistant") {
		const body = textAndPlaceholders(msg.content, {
			includeThinking: false,
			omitRedactedThinking: true,
			omitToolCalls: true,
		})
			.split("\n")
			.filter(Boolean)
			.join("\n");
		if (!body) return null;
		return `[Assistant @ ${time}]: ${body}`;
	}
	if (msg.role === "toolResult") return `[Tool result: ${(msg as ToolResultMessage).toolName} @ ${time}]: ${textAndPlaceholders(msg.content)}`;
	if (msg.role === "bashExecution") {
		const command = typeof msg.command === "string" ? msg.command : "";
		const output = typeof msg.output === "string" ? msg.output : "";
		const exitCode = typeof msg.exitCode === "number" ? msg.exitCode : "unknown";
		const truncated = msg.truncated === true ? "true" : "false";
		return `[Bash @ ${time}]: command: ${command}\nexitCode: ${exitCode}\ntruncated: ${truncated}\noutput:\n${output}`;
	}
	if (msg.role === "custom") {
		const customType = typeof msg.customType === "string" ? msg.customType : "unknown";
		return `[Custom message (${customType}) @ ${time}]: ${textAndPlaceholders(msg.content)}`;
	}
	if (msg.role === "branchSummary" || msg.role === "compactionSummary") {
		const summary = typeof msg.summary === "string" ? msg.summary : "";
		return summary ? `[${msg.role} @ ${time}]: ${summary}` : null;
	}
	return null;
}

export function renderRecallSourceEntry(entry: RenderableEntry): string | null {
	if (entry.type === "message") return renderRecallMessage(entry);
	if (entry.type === "custom_message") return renderCustomMessage(entry);
	if (entry.type === "branch_summary" && typeof entry.summary === "string") {
		const time = formatRecallTimestamp(entry.timestamp);
		return `[Branch summary @ ${time}]: ${entry.summary}`;
	}
	if (entry.type === "compaction" && typeof entry.summary === "string") {
		const time = formatRecallTimestamp(entry.timestamp);
		const firstKept = entry.firstKeptEntryId ? `; first kept: ${entry.firstKeptEntryId}` : "";
		const tokensBefore = typeof entry.tokensBefore === "number" ? `; tokens before: ${entry.tokensBefore}` : "";
		return `[Compaction summary @ ${time}${firstKept}${tokensBefore}]: ${entry.summary}`;
	}
	return null;
}

