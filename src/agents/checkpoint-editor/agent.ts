import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { agentLoop, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { isValidCheckpointMarkdown } from "../../session-ledger/index.js";
import { debugLog } from "../../debug-log.js";
import { runMemoryAgentLoop, type MemoryAgentRequestDiagnostics, type MemoryAgentUsage } from "../common.js";
import { CHECKPOINT_EDITOR_SYSTEM, checkpointEditorPruneUserText, checkpointEditorUpdateUserText } from "./prompts.js";

interface RunCheckpointEditorArgs {
	model: Model<any>;
	apiKey: string;
	headers?: Record<string, string>;
	draftPath: string;
	initialContent: string;
	observationsText: string;
	purpose: "update" | "prune";
	signal?: AbortSignal;
	agentLoop?: typeof agentLoop;
	maxTurns?: number;
	thinkingLevel?: ModelThinkingLevel;
	onUsage?: (usage: MemoryAgentUsage) => void;
	onRequestDiagnostics?: (diagnostics: MemoryAgentRequestDiagnostics) => void;
	onToolEvent?: (event: CheckpointEditorToolEvent) => void;
	pruneSizeGuidance?: string;
}

export type CheckpointEditorMetrics = {
	readCalls: number;
	editCalls: number;
	successfulEditCalls: number;
	failedEditCalls: number;
	editFailureReasons: {
		badPath: number;
		oldTextNotFound: number;
		oldTextNotUnique: number;
	};
	editOldTextChars: number;
	editNewTextChars: number;
	writeCalls: number;
	writeChars: number;
	finishCalls: number;
	finishRetryCount: number;
};

export type CheckpointEditorToolEvent = {
	requestIndex: number | undefined;
	tool: "read" | "edit" | "write" | "finish_checkpoint_edit";
	durationMs: number;
	ok: boolean;
	errorReason?: "bad_path" | "old_text_not_found" | "old_text_not_unique" | "invalid_checkpoint";
	oldTextChars?: number;
	newTextChars?: number;
	contentChars?: number;
};

export type CheckpointEditorResult = {
	content: string;
	reason: string;
	changed: boolean;
	metrics: CheckpointEditorMetrics;
};

const ReadSchema = Type.Object({
	path: Type.String({ minLength: 1 }),
});

type ReadArgs = Static<typeof ReadSchema>;

const EditSchema = Type.Object({
	path: Type.String({ minLength: 1 }),
	oldText: Type.String(),
	newText: Type.String(),
});

type EditArgs = Static<typeof EditSchema>;

const WriteSchema = Type.Object({
	path: Type.String({ minLength: 1 }),
	content: Type.String(),
});

type WriteArgs = Static<typeof WriteSchema>;

const FinishSchema = Type.Object({
	reason: Type.String({ minLength: 1 }),
});

type FinishArgs = Static<typeof FinishSchema>;

function allowedPath(path: string): boolean {
	return path === "checkpoint.md";
}

async function readDraft(path: string): Promise<string> {
	return readFile(path, "utf-8");
}

async function writeDraft(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf-8");
}

function errorResult(text: string): any {
	return { content: [{ type: "text", text }], isError: true };
}

export async function runCheckpointEditor(args: RunCheckpointEditorArgs): Promise<CheckpointEditorResult | undefined> {
	await writeDraft(args.draftPath, args.initialContent);
	let finishedReason: string | undefined;
	const metrics: CheckpointEditorMetrics = {
		readCalls: 0,
		editCalls: 0,
		successfulEditCalls: 0,
		failedEditCalls: 0,
		editFailureReasons: {
			badPath: 0,
			oldTextNotFound: 0,
			oldTextNotUnique: 0,
		},
		editOldTextChars: 0,
		editNewTextChars: 0,
		writeCalls: 0,
		writeChars: 0,
		finishCalls: 0,
		finishRetryCount: 0,
	};
	let currentRequestIndex: number | undefined;
	const emitToolEvent = (event: Omit<CheckpointEditorToolEvent, "requestIndex">) => {
		args.onToolEvent?.({ requestIndex: currentRequestIndex, ...event });
	};
	const handleRequestDiagnostics = (diagnostics: MemoryAgentRequestDiagnostics) => {
		currentRequestIndex = diagnostics.requestIndex;
		args.onRequestDiagnostics?.(diagnostics);
	};

	const readTool: AgentTool<typeof ReadSchema> = {
		name: "read",
		label: "Read checkpoint draft",
		description: "Read checkpoint.md. Only checkpoint.md is allowed.",
		parameters: ReadSchema,
		execute: async (_id, params: ReadArgs) => {
			const started = Date.now();
			metrics.readCalls++;
			if (!allowedPath(params.path)) {
				emitToolEvent({ tool: "read", durationMs: Date.now() - started, ok: false, errorReason: "bad_path" });
				debugLog("checkpoint_editor.tool_result", { tool: "read", ok: false, errorMessage: "Only checkpoint.md may be read." });
				return errorResult("Only checkpoint.md may be read.");
			}
			const content = await readDraft(args.draftPath);
			emitToolEvent({ tool: "read", durationMs: Date.now() - started, ok: true, contentChars: content.length });
			debugLog("checkpoint_editor.tool_result", { tool: "read", ok: true, contentChars: content.length });
			return { content: [{ type: "text", text: content }] };
		},
	};

	const editTool: AgentTool<typeof EditSchema> = {
		name: "edit",
		label: "Edit checkpoint draft",
		description: "Replace one exact text span in checkpoint.md. Only checkpoint.md is allowed.",
		parameters: EditSchema,
		execute: async (_id, params: EditArgs) => {
			const started = Date.now();
			metrics.editCalls++;
			metrics.editOldTextChars += params.oldText.length;
			metrics.editNewTextChars += params.newText.length;
			if (!allowedPath(params.path)) {
				metrics.failedEditCalls++;
				metrics.editFailureReasons.badPath++;
				emitToolEvent({ tool: "edit", durationMs: Date.now() - started, ok: false, errorReason: "bad_path", oldTextChars: params.oldText.length, newTextChars: params.newText.length });
				debugLog("checkpoint_editor.tool_result", { tool: "edit", ok: false, errorMessage: "Only checkpoint.md may be edited." });
				return errorResult("Only checkpoint.md may be edited.");
			}
			const current = await readDraft(args.draftPath);
			const first = current.indexOf(params.oldText);
			if (first === -1) {
				metrics.failedEditCalls++;
				metrics.editFailureReasons.oldTextNotFound++;
				emitToolEvent({ tool: "edit", durationMs: Date.now() - started, ok: false, errorReason: "old_text_not_found", oldTextChars: params.oldText.length, newTextChars: params.newText.length, contentChars: current.length });
				debugLog("checkpoint_editor.tool_result", { tool: "edit", ok: false, errorMessage: "oldText was not found in checkpoint.md.", oldTextChars: params.oldText.length, newTextChars: params.newText.length });
				return errorResult("oldText was not found in checkpoint.md.");
			}
			if (current.indexOf(params.oldText, first + params.oldText.length) !== -1) {
				metrics.failedEditCalls++;
				metrics.editFailureReasons.oldTextNotUnique++;
				emitToolEvent({ tool: "edit", durationMs: Date.now() - started, ok: false, errorReason: "old_text_not_unique", oldTextChars: params.oldText.length, newTextChars: params.newText.length, contentChars: current.length });
				debugLog("checkpoint_editor.tool_result", { tool: "edit", ok: false, errorMessage: "oldText is not unique in checkpoint.md.", oldTextChars: params.oldText.length, newTextChars: params.newText.length });
				return errorResult("oldText is not unique in checkpoint.md.");
			}
			const next = `${current.slice(0, first)}${params.newText}${current.slice(first + params.oldText.length)}`;
			await writeDraft(args.draftPath, next);
			metrics.successfulEditCalls++;
			emitToolEvent({ tool: "edit", durationMs: Date.now() - started, ok: true, oldTextChars: params.oldText.length, newTextChars: params.newText.length, contentChars: next.length });
			debugLog("checkpoint_editor.tool_result", { tool: "edit", ok: true, oldTextChars: params.oldText.length, newTextChars: params.newText.length, contentChars: next.length, valid: isValidCheckpointMarkdown(next) });
			return { content: [{ type: "text", text: "Edited checkpoint.md." }] };
		},
	};

	const writeTool: AgentTool<typeof WriteSchema> = {
		name: "write",
		label: "Write checkpoint draft",
		description: "Replace checkpoint.md with full Markdown content. Only checkpoint.md is allowed.",
		parameters: WriteSchema,
		execute: async (_id, params: WriteArgs) => {
			const started = Date.now();
			metrics.writeCalls++;
			metrics.writeChars += params.content.length;
			if (!allowedPath(params.path)) {
				emitToolEvent({ tool: "write", durationMs: Date.now() - started, ok: false, errorReason: "bad_path", contentChars: params.content.length });
				debugLog("checkpoint_editor.tool_result", { tool: "write", ok: false, errorMessage: "Only checkpoint.md may be written.", contentChars: params.content.length });
				return errorResult("Only checkpoint.md may be written.");
			}
			await writeDraft(args.draftPath, params.content);
			emitToolEvent({ tool: "write", durationMs: Date.now() - started, ok: true, contentChars: params.content.length });
			debugLog("checkpoint_editor.tool_result", { tool: "write", ok: true, contentChars: params.content.length, valid: isValidCheckpointMarkdown(params.content) });
			return { content: [{ type: "text", text: "Wrote checkpoint.md." }] };
		},
	};

	const finishTool: AgentTool<typeof FinishSchema> = {
		name: "finish_checkpoint_edit",
		label: "Finish checkpoint edit",
		description: "Finish the checkpoint edit after checkpoint.md is valid.",
		parameters: FinishSchema,
		execute: async (_id, params: FinishArgs) => {
			const started = Date.now();
			metrics.finishCalls++;
			const content = await readDraft(args.draftPath);
			if (!isValidCheckpointMarkdown(content)) {
				emitToolEvent({ tool: "finish_checkpoint_edit", durationMs: Date.now() - started, ok: false, errorReason: "invalid_checkpoint", contentChars: content.length });
				debugLog("checkpoint_editor.tool_result", { tool: "finish_checkpoint_edit", ok: false, errorMessage: "checkpoint.md is invalid or missing required headings.", contentChars: content.length });
				return errorResult("checkpoint.md is invalid or missing required headings.");
			}
			finishedReason = params.reason;
			emitToolEvent({ tool: "finish_checkpoint_edit", durationMs: Date.now() - started, ok: true, contentChars: content.length });
			debugLog("checkpoint_editor.tool_result", { tool: "finish_checkpoint_edit", ok: true, reason: params.reason, changed: content !== args.initialContent, contentChars: content.length });
			return { content: [{ type: "text", text: "Checkpoint edit finished." }], terminate: true };
		},
	};

	const userText = args.purpose === "prune"
		? checkpointEditorPruneUserText({ sizeGuidance: args.pruneSizeGuidance })
		: checkpointEditorUpdateUserText({ observationsText: args.observationsText });
	const tools = args.purpose === "prune"
		? [readTool as AgentTool<any>, writeTool as AgentTool<any>, finishTool as AgentTool<any>]
		: [readTool as AgentTool<any>, editTool as AgentTool<any>, finishTool as AgentTool<any>];
	const toolCallReminder = args.purpose === "prune"
		? "You must read checkpoint.md, write the full pruned checkpoint.md if needed, and call finish_checkpoint_edit."
		: "You must update checkpoint.md if needed and call finish_checkpoint_edit.";

	await runMemoryAgentLoop({
		model: args.model,
		apiKey: args.apiKey,
		headers: args.headers,
		signal: args.signal,
		agentLoop: args.agentLoop,
		maxTurns: args.maxTurns,
		thinkingLevel: args.thinkingLevel,
		systemPrompt: CHECKPOINT_EDITOR_SYSTEM,
		userText,
		tools,
		agentName: "checkpoint-editor",
		onUsage: args.onUsage,
		onRequestDiagnostics: handleRequestDiagnostics,
		requireToolCall: true,
		toolCallReminder,
		maxNoToolRetries: 2,
	});

	let content = await readDraft(args.draftPath);
	if (!finishedReason && isValidCheckpointMarkdown(content)) {
		metrics.finishRetryCount++;
		debugLog("checkpoint_editor.finish_retry", { changed: content !== args.initialContent, contentChars: content.length });
		await runMemoryAgentLoop({
			model: args.model,
			apiKey: args.apiKey,
			headers: args.headers,
			signal: args.signal,
			agentLoop: args.agentLoop,
			maxTurns: 2,
			thinkingLevel: args.thinkingLevel,
			systemPrompt: CHECKPOINT_EDITOR_SYSTEM,
			userText: "checkpoint.md is valid after prior changes, but finish_checkpoint_edit was not called. Read checkpoint.md, then call finish_checkpoint_edit now with a concise reason. Do not change the file unless it is invalid.",
			tools: [readTool as AgentTool<any>, finishTool as AgentTool<any>],
			agentName: "checkpoint-editor",
			onUsage: args.onUsage,
			onRequestDiagnostics: handleRequestDiagnostics,
			requireToolCall: true,
			toolCallReminder: "You must call finish_checkpoint_edit for the valid checkpoint.md draft.",
			maxNoToolRetries: 1,
		});
		content = await readDraft(args.draftPath);
	}
	if (!finishedReason) {
		debugLog("checkpoint_editor.no_finish_draft", {
			changed: content !== args.initialContent,
			valid: isValidCheckpointMarkdown(content),
			contentChars: content.length,
			content,
		});
		return undefined;
	}
	return { content, reason: finishedReason, changed: content !== args.initialContent, metrics };
}
