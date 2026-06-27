import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { agentLoop, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { isValidCheckpointMarkdown } from "../../session-ledger/index.js";
import { debugLog } from "../../debug-log.js";
import { runMemoryAgentLoop, type MemoryAgentUsage } from "../common.js";
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
}

export type CheckpointEditorMetrics = {
	readCalls: number;
	editCalls: number;
	successfulEditCalls: number;
	failedEditCalls: number;
	editOldTextChars: number;
	editNewTextChars: number;
	finishCalls: number;
	finishRetryCount: number;
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
		editOldTextChars: 0,
		editNewTextChars: 0,
		finishCalls: 0,
		finishRetryCount: 0,
	};

	const readTool: AgentTool<typeof ReadSchema> = {
		name: "read",
		label: "Read checkpoint draft",
		description: "Read checkpoint.md. Only checkpoint.md is allowed.",
		parameters: ReadSchema,
		execute: async (_id, params: ReadArgs) => {
			metrics.readCalls++;
			if (!allowedPath(params.path)) {
				debugLog("checkpoint_editor.tool_result", { tool: "read", ok: false, errorMessage: "Only checkpoint.md may be read." });
				return errorResult("Only checkpoint.md may be read.");
			}
			const content = await readDraft(args.draftPath);
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
			metrics.editCalls++;
			metrics.editOldTextChars += params.oldText.length;
			metrics.editNewTextChars += params.newText.length;
			if (!allowedPath(params.path)) {
				metrics.failedEditCalls++;
				debugLog("checkpoint_editor.tool_result", { tool: "edit", ok: false, errorMessage: "Only checkpoint.md may be edited." });
				return errorResult("Only checkpoint.md may be edited.");
			}
			const current = await readDraft(args.draftPath);
			const first = current.indexOf(params.oldText);
			if (first === -1) {
				metrics.failedEditCalls++;
				debugLog("checkpoint_editor.tool_result", { tool: "edit", ok: false, errorMessage: "oldText was not found in checkpoint.md.", oldTextChars: params.oldText.length, newTextChars: params.newText.length });
				return errorResult("oldText was not found in checkpoint.md.");
			}
			if (current.indexOf(params.oldText, first + params.oldText.length) !== -1) {
				metrics.failedEditCalls++;
				debugLog("checkpoint_editor.tool_result", { tool: "edit", ok: false, errorMessage: "oldText is not unique in checkpoint.md.", oldTextChars: params.oldText.length, newTextChars: params.newText.length });
				return errorResult("oldText is not unique in checkpoint.md.");
			}
			const next = `${current.slice(0, first)}${params.newText}${current.slice(first + params.oldText.length)}`;
			await writeDraft(args.draftPath, next);
			metrics.successfulEditCalls++;
			debugLog("checkpoint_editor.tool_result", { tool: "edit", ok: true, oldTextChars: params.oldText.length, newTextChars: params.newText.length, contentChars: next.length, valid: isValidCheckpointMarkdown(next) });
			return { content: [{ type: "text", text: "Edited checkpoint.md." }] };
		},
	};

	const finishTool: AgentTool<typeof FinishSchema> = {
		name: "finish_checkpoint_edit",
		label: "Finish checkpoint edit",
		description: "Finish the checkpoint edit after checkpoint.md is valid.",
		parameters: FinishSchema,
		execute: async (_id, params: FinishArgs) => {
			metrics.finishCalls++;
			const content = await readDraft(args.draftPath);
			if (!isValidCheckpointMarkdown(content)) {
				debugLog("checkpoint_editor.tool_result", { tool: "finish_checkpoint_edit", ok: false, errorMessage: "checkpoint.md is invalid or missing required headings.", contentChars: content.length });
				return errorResult("checkpoint.md is invalid or missing required headings.");
			}
			finishedReason = params.reason;
			debugLog("checkpoint_editor.tool_result", { tool: "finish_checkpoint_edit", ok: true, reason: params.reason, changed: content !== args.initialContent, contentChars: content.length });
			return { content: [{ type: "text", text: "Checkpoint edit finished." }], terminate: true };
		},
	};

	const userText = args.purpose === "prune"
		? checkpointEditorPruneUserText()
		: checkpointEditorUpdateUserText({ observationsText: args.observationsText });

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
		tools: [readTool as AgentTool<any>, editTool as AgentTool<any>, finishTool as AgentTool<any>],
		agentName: "checkpoint-editor",
		onUsage: args.onUsage,
		requireToolCall: true,
		toolCallReminder: "You must update checkpoint.md if needed and call finish_checkpoint_edit.",
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
			userText: "checkpoint.md is valid after prior edits, but finish_checkpoint_edit was not called. Read checkpoint.md, then call finish_checkpoint_edit now with a concise reason. Do not edit unless the file is invalid.",
			tools: [readTool as AgentTool<any>, finishTool as AgentTool<any>],
			agentName: "checkpoint-editor",
			onUsage: args.onUsage,
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
