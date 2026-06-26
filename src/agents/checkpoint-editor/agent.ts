import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { agentLoop, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { isValidCheckpointMarkdown } from "../../session-ledger/index.js";
import { runMemoryAgentLoop, type MemoryAgentUsage } from "../common.js";
import { CHECKPOINT_EDITOR_SYSTEM, checkpointEditorUserText } from "./prompts.js";

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

export type CheckpointEditorResult = {
	content: string;
	reason: string;
	changed: boolean;
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

	const readTool: AgentTool<typeof ReadSchema> = {
		name: "read",
		label: "Read checkpoint draft",
		description: "Read checkpoint.md. Only checkpoint.md is allowed.",
		parameters: ReadSchema,
		execute: async (_id, params: ReadArgs) => {
			if (!allowedPath(params.path)) return errorResult("Only checkpoint.md may be read.");
			return { content: [{ type: "text", text: await readDraft(args.draftPath) }] };
		},
	};

	const editTool: AgentTool<typeof EditSchema> = {
		name: "edit",
		label: "Edit checkpoint draft",
		description: "Replace one exact text span in checkpoint.md. Only checkpoint.md is allowed.",
		parameters: EditSchema,
		execute: async (_id, params: EditArgs) => {
			if (!allowedPath(params.path)) return errorResult("Only checkpoint.md may be edited.");
			const current = await readDraft(args.draftPath);
			const first = current.indexOf(params.oldText);
			if (first === -1) return errorResult("oldText was not found in checkpoint.md.");
			if (current.indexOf(params.oldText, first + params.oldText.length) !== -1) return errorResult("oldText is not unique in checkpoint.md.");
			const next = `${current.slice(0, first)}${params.newText}${current.slice(first + params.oldText.length)}`;
			await writeDraft(args.draftPath, next);
			return { content: [{ type: "text", text: "Edited checkpoint.md." }] };
		},
	};

	const finishTool: AgentTool<typeof FinishSchema> = {
		name: "finish_checkpoint_edit",
		label: "Finish checkpoint edit",
		description: "Finish the checkpoint edit after checkpoint.md is valid.",
		parameters: FinishSchema,
		execute: async (_id, params: FinishArgs) => {
			const content = await readDraft(args.draftPath);
			if (!isValidCheckpointMarkdown(content)) return errorResult("checkpoint.md is invalid or missing required headings.");
			finishedReason = params.reason;
			return { content: [{ type: "text", text: "Checkpoint edit finished." }], terminate: true };
		},
	};

	await runMemoryAgentLoop({
		model: args.model,
		apiKey: args.apiKey,
		headers: args.headers,
		signal: args.signal,
		agentLoop: args.agentLoop,
		maxTurns: args.maxTurns,
		thinkingLevel: args.thinkingLevel,
		systemPrompt: CHECKPOINT_EDITOR_SYSTEM,
		userText: checkpointEditorUserText({ purpose: args.purpose, observationsText: args.observationsText }),
		tools: [readTool as AgentTool<any>, editTool as AgentTool<any>, finishTool as AgentTool<any>],
		agentName: "checkpoint-editor",
		onUsage: args.onUsage,
		requireToolCall: true,
		toolCallReminder: "You must update checkpoint.md if needed and call finish_checkpoint_edit.",
		maxNoToolRetries: 2,
	});

	if (!finishedReason) return undefined;
	const content = await readDraft(args.draftPath);
	return { content, reason: finishedReason, changed: content !== args.initialContent };
}
