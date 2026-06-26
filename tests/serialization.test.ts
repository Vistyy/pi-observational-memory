import { describe, expect, it } from "vitest";

import { serializeObserverSourceEntries, type ObserverToolRenderingOptions } from "../src/memory/serialization/observer.js";

const observerToolOptions: ObserverToolRenderingOptions = {
	toolResultSummaryMaxLines: 4,
	toolResultErrorMaxLines: 20,
	toolResultLineMaxChars: 300,
	toolOutputPolicies: { fork: "full" },
};

describe("memory serialization", () => {
	it("keeps user prompts and omits assistant thinking from observer input", () => {
		const { text, sourceEntryIds } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "raw-user",
				timestamp: "2026-05-02T10:00:00.000Z",
				message: { role: "user", timestamp: 1777716000000, content: [{ type: "text", text: "Remember the exact flag --unsafe-fast." }, { type: "image", data: "abc", mimeType: "image/png" }] },
			},
			{
				type: "message",
				id: "raw-assistant",
				timestamp: "2026-05-02T10:01:00.000Z",
				message: { role: "assistant", timestamp: 1777716060000, content: [{ type: "thinking", thinking: "Maybe this is irrelevant." }, { type: "text", text: "I will use --unsafe-fast." }] },
			},
		] as any, observerToolOptions);

		expect(sourceEntryIds).toEqual(["raw-user", "raw-assistant"]);
		expect(text).toContain("Remember the exact flag --unsafe-fast.");
		expect(text).toContain("[non-text content omitted]");
		expect(text).toContain("I will use --unsafe-fast.");
		expect(text).not.toContain("[thinking omitted]");
		expect(text).not.toContain("Maybe this is irrelevant");
	});

	it("stops before assistant text with an in-flight tool call", () => {
		const { text, sourceEntryIds } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "assistant-tool-call",
				timestamp: "2026-05-02T10:01:00.000Z",
				message: {
					role: "assistant",
					timestamp: 1777716060000,
					content: [
						{ type: "text", text: "I will update the config." },
						{ type: "toolCall", name: "edit", arguments: { path: "src/config.ts", edits: [{ oldText: "x".repeat(500), newText: "y".repeat(500) }] } },
					],
				},
			},
		] as any, observerToolOptions);

		expect(sourceEntryIds).toEqual([]);
		expect(text).toBe("");
		expect(text).not.toContain("Attempted tool call");
		expect(text).not.toContain("input: src/config.ts");
		expect(text).not.toContain("payload: omitted");
		expect(text).not.toContain("oldText");
		expect(text).not.toContain("newText");
		expect(text).not.toContain("xxxx");
		expect(text).not.toContain("yyyy");
	});

	it("omits successful generic tool results by default", () => {
		const output = `HEAD-${"a".repeat(9000)}-TAIL`;
		const { text, sourceEntryIds } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "tool-1",
				timestamp: "2026-05-02T10:00:00.000Z",
				message: { role: "toolResult", timestamp: 1777716000000, toolName: "unknown_extension_tool", isError: false, path: "src/foo.ts", content: [{ type: "text", text: output }] },
			},
		] as any, { toolResultSummaryMaxLines: 4, toolResultErrorMaxLines: 20, toolResultLineMaxChars: 300, toolOutputPolicies: { fork: "full" } });

		expect(sourceEntryIds).toEqual([]);
		expect(text).toBe("");
	});

	it("omits successful mutation-style tool results by default", () => {
		const { text, sourceEntryIds } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "tool-ok",
				timestamp: "2026-05-02T10:00:00.000Z",
				message: { role: "toolResult", timestamp: 1777716000000, toolName: "edit", isError: false, path: "src/config.ts", content: [{ type: "text", text: "Successfully replaced 1 block in src/config.ts." }] },
			},
		] as any, { toolResultSummaryMaxLines: 0, toolResultErrorMaxLines: 20, toolResultLineMaxChars: 300, toolOutputPolicies: { fork: "full" } });

		expect(sourceEntryIds).toEqual([]);
		expect(text).toBe("");
	});

	it("gives error tool results a larger generic excerpt", () => {
		const output = `ERROR first line\n${"x".repeat(500)}\nFinal stack line`;
		const { text } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "tool-error",
				timestamp: "2026-05-02T10:00:00.000Z",
				message: { role: "toolResult", timestamp: 1777716000000, toolName: "custom_runner", isError: true, content: [{ type: "text", text: output }] },
			},
		] as any, { toolResultSummaryMaxLines: 4, toolResultErrorMaxLines: 20, toolResultLineMaxChars: 300, toolOutputPolicies: { fork: "full" } });

		expect(text).toContain("status: error");
		expect(text).toContain("ERROR first line");
		expect(text).toContain("Final stack line");
	});

	it("renders successful empty-output bash execution as bounded command evidence", () => {
		const { text, sourceEntryIds } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "bash-empty",
				timestamp: "2026-05-02T10:00:00.000Z",
				message: { role: "bashExecution", timestamp: 1777716000000, command: "true", output: "", exitCode: 0, truncated: false },
			},
		] as any, observerToolOptions);

		expect(sourceEntryIds).toEqual(["bash-empty"]);
		expect(text).toContain("tool: bash");
		expect(text).toContain("status: success");
		expect(text).toContain("command");
		expect(text).toContain("[no textual output]");
	});

	it("renders bash execution through the same sanitized tool path", () => {
		const { text, sourceEntryIds } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "bash-1",
				timestamp: "2026-05-02T10:00:00.000Z",
				message: { role: "bashExecution", timestamp: 1777716000000, command: "pnpm test", output: "failed at exact needle", exitCode: 1, truncated: false },
			},
		] as any, observerToolOptions);

		expect(sourceEntryIds).toEqual(["bash-1"]);
		expect(text).toContain("[Tool interaction: bash @");
		expect(text).toContain("status: error");
		expect(text).toContain("command");
		expect(text).toContain("pnpm test");
		expect(text).toContain("exitCode");
		expect(text).toContain("failed at exact needle");
	});

	it("uses include filtering and excludes derived observer sources", () => {
		const { text, sourceEntryIds } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "user-1",
				timestamp: "2026-05-02T10:00:00.000Z",
				message: { role: "user", content: "Primary user evidence." },
			},
			{ type: "compaction", id: "cmp-1", timestamp: "2026-05-02T10:02:00.000Z", summary: "Derived compaction should not be observed." },
			{ type: "branch_summary", id: "branch-1", timestamp: "2026-05-02T10:03:00.000Z", summary: "Derived branch summary." },
			{ type: "custom_message", id: "custom-1", timestamp: "2026-05-02T10:04:00.000Z", content: "Custom event." },
			{
				type: "message",
				id: "custom-role",
				timestamp: "2026-05-02T10:05:00.000Z",
				message: { role: "custom", content: "Custom message role." },
			},
			{
				type: "message",
				id: "compaction-role",
				timestamp: "2026-05-02T10:06:00.000Z",
				message: { role: "compactionSummary", summary: "Compaction message role." },
			},
		] as any, observerToolOptions);

		expect(sourceEntryIds).toEqual(["user-1"]);
		expect(text).toContain("Primary user evidence.");
		expect(text).not.toContain("Derived compaction");
		expect(text).not.toContain("Derived branch");
		expect(text).not.toContain("Custom event");
		expect(text).not.toContain("Custom message role");
		expect(text).not.toContain("Compaction message role");
	});

	it("bounds configured fork tool output while preserving head and tail", () => {
		const realGigaForkHead = "Now I have a thorough understanding of the full codebase. Here is my triage report. B1. Additive cross-compaction memory gap in src/hooks/additive-context.ts.";
		const realGigaForkTail = "Recommended order: fix compaction gap first, then tune observer records, then add checkpoint evals. End of triage report.";
		const output = `${realGigaForkHead}\n${"middle noise\n".repeat(1000)}${realGigaForkTail}`;
		const { text } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "tool-giga-fork",
				timestamp: "2026-06-11T14:02:00.000Z",
				message: { role: "toolResult", timestamp: 1777716000000, toolName: "fork", isError: false, content: [{ type: "text", text: output }] },
			},
		] as any, { toolResultSummaryMaxLines: 4, toolResultErrorMaxLines: 20, toolResultLineMaxChars: 300, toolOutputPolicies: { fork: "full" } });

		expect(text).toContain("result_omitted: false");
		expect(text).toContain("Additive cross-compaction memory gap");
		expect(text).toContain("src/hooks/additive-context.ts");
		expect(text).toContain("fix compaction gap first");
		expect(text).toContain("add checkpoint evals");
		expect(text).not.toContain("truncated middle");
		expect((text.match(/middle noise/g) ?? []).length).toBe(1000);
	});

	it("skips unknown successful tools by default", () => {
		const { text, sourceEntryIds } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "tool-1",
				timestamp: "2026-05-02T10:00:00.000Z",
				message: { role: "toolResult", timestamp: 1777716000000, toolName: "first", isError: false, content: [{ type: "text", text: "FIRST-1\nFIRST-2\nFIRST-3\nFIRST-4" }] },
			},
			{
				type: "message",
				id: "tool-2",
				timestamp: "2026-05-02T10:01:00.000Z",
				message: { role: "toolResult", timestamp: 1777716060000, toolName: "second", isError: false, content: [{ type: "text", text: "SECOND-" + "b".repeat(200) }] },
			},
		] as any, { toolResultSummaryMaxLines: 4, toolResultErrorMaxLines: 20, toolResultLineMaxChars: 300, toolOutputPolicies: { fork: "full" } });

		expect(sourceEntryIds).toEqual([]);
		expect(text).toBe("");
	});

	it("joins assistant tool calls with matching bash tool results", () => {
		const { text, sourceEntryIds } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "assistant-call",
				timestamp: "2026-05-02T10:00:00.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "I will verify the release." },
						{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "git status --short --branch" } },
					],
				},
			},
			{
				type: "message",
				id: "tool-result",
				timestamp: "2026-05-02T10:01:00.000Z",
				message: { role: "toolResult", toolCallId: "call-1", toolName: "bash", isError: false, content: [{ type: "text", text: "## main...origin/main\n907b437 Document checkpoint observer design" }] },
			},
		] as any, observerToolOptions);

		expect(sourceEntryIds).toEqual(["assistant-call", "tool-result"]);
		expect(text).toContain("I will verify the release.");
		expect(text).toContain("[Source entry ids: assistant-call, tool-result]");
		expect(text).toContain("tool: bash");
		expect(text).toContain("git status --short --branch");
		expect(text).toContain("907b437 Document checkpoint observer design");
	});

	it("renders abandoned unmatched tool calls as incomplete records", () => {
		const { text, sourceEntryIds } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "assistant-call",
				timestamp: "2026-05-02T10:00:00.000Z",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "call-1", name: "fork", arguments: { task: "Investigate the crash" } }],
				},
			},
			{
				type: "message",
				id: "user-after",
				timestamp: "2026-05-02T10:01:00.000Z",
				message: { role: "user", content: "The tool crashed." },
			},
		] as any, observerToolOptions);

		expect(sourceEntryIds).toEqual(["assistant-call", "user-after"]);
		expect(text).toContain("tool: fork");
		expect(text).toContain("status: incomplete/no result");
		expect(text).toContain("Investigate the crash");
		expect(text).not.toContain("result:");
	});

	it("bounds long successful bash results with head, tail, and omitted line count", () => {
		const output = Array.from({ length: 35 }, (_, i) => `line-${i + 1}`).join("\n");
		const { text } = serializeObserverSourceEntries([
			{
				type: "message",
				id: "tool-result",
				timestamp: "2026-05-02T10:01:00.000Z",
				message: { role: "toolResult", toolName: "bash", isError: false, content: [{ type: "text", text: output }] },
			},
		] as any, observerToolOptions);

		expect(text).toContain("line-1");
		expect(text).toContain("line-10");
		expect(text).toContain("[... omitted 5 lines ...]");
		expect(text).toContain("line-16");
		expect(text).toContain("line-35");
		expect(text).not.toContain("line-11\n");
	});

});
