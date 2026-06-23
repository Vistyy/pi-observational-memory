import { agentLoop, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { debugLog } from "../../debug-log.js";
import { hashId, reflectionId } from "../../memory/ids.js";
import { estimateStringTokens } from "../../memory/token-estimate.js";
import { reflectionToSummaryLine, type Reflection } from "../../session-ledger/index.js";
import { joinOrEmpty, normalizeAllowedIdsStrict, runMemoryAgentLoop, type MemoryAgentUsage } from "../common.js";
import { normalizeReflectionContent } from "../reflection-content.js";
import { RecordReflectionsSchema } from "../record-tool.js";
import { REWRITE_SYSTEM, REWRITE_TOOL_DESCRIPTION, rewriteUserText } from "./prompts.js";

export type RewriteResult = {
	reflections: Reflection[];
	summary?: string;
};

type RecordRewriteArgs = Static<typeof RecordReflectionsSchema>;

type RewriteRecordToolResult = {
	tool: AgentTool<typeof RecordReflectionsSchema>;
	accepted: () => Reflection[];
	called: () => boolean;
	recordedEmpty: () => boolean;
	rejected: () => number;
	summary: () => string | undefined;
};

function rewriteRecordTool(inputReflections: Reflection[]): RewriteRecordToolResult {
	const allowedSourceIds = inputReflections.map((reflection) => reflection.id);
	const existingReflectionIds = new Set(allowedSourceIds);
	const existingReflectionContents = new Set(inputReflections.map((reflection) => reflection.content));
	const accumulated = new Map<string, Reflection>();
	let called = false;
	let recordedEmpty = false;
	let rejected = 0;
	let summary: string | undefined;

	const tool: AgentTool<typeof RecordReflectionsSchema> = {
		name: "record_rewritten_reflections",
		label: "Record rewritten reflections",
		description: REWRITE_TOOL_DESCRIPTION,
		parameters: RecordReflectionsSchema,
		execute: async (_id, params: RecordRewriteArgs) => {
			called = true;
			recordedEmpty ||= params.reflections.length === 0;
			summary = params.summary ? normalizeReflectionContent(params.summary) : undefined;
			const reject = (message: string): never => {
				rejected++;
				accumulated.clear();
				throw new Error(message);
			};

			for (const proposal of params.reflections) {
				const content = normalizeReflectionContent(proposal.content);
				const sources = normalizeAllowedIdsStrict(proposal.sources, allowedSourceIds);
				if (!content || !sources) {
					return reject("Rejected invalid rewrite: each reflection needs single-line content and direct input ref_* sources only.");
				}
				const id = reflectionId(hashId(content));
				if (existingReflectionIds.has(id) || existingReflectionContents.has(content)) {
					return reject("Rejected unsafe rewrite: unchanged reflection content would be retired by the rewrite.");
				}
				if (accumulated.has(id)) {
					return reject("Rejected invalid rewrite: duplicate replacement reflection content.");
				}
				accumulated.set(id, { id, kind: "reflection", content, sources, createdAt: new Date().toISOString() });
			}

			return {
				content: [{ type: "text", text: `Accepted ${accumulated.size} rewritten reflection${accumulated.size === 1 ? "" : "s"}.` }],
				details: { accepted: accumulated.size, rejected },
				terminate: true,
			};
		},
	};

	return {
		tool,
		accepted: () => Array.from(accumulated.values()),
		called: () => called,
		recordedEmpty: () => recordedEmpty,
		rejected: () => rejected,
		summary: () => summary,
	};
}

interface RunRewriteArgs {
	model: Model<any>;
	apiKey: string;
	headers?: Record<string, string>;
	reflections: Reflection[];
	signal?: AbortSignal;
	agentLoop?: typeof agentLoop;
	maxTurns?: number;
	thinkingLevel?: ModelThinkingLevel;
	onUsage?: (usage: MemoryAgentUsage) => void;
}

export async function runRewrite(args: RunRewriteArgs): Promise<RewriteResult | undefined> {
	const { model, apiKey, headers, reflections, signal } = args;
	if (reflections.length === 0) return undefined;

	const recorder = rewriteRecordTool(reflections);
	const userText = rewriteUserText(joinOrEmpty(reflections.map(reflectionToSummaryLine)));
	debugLog("rewrite.prompt", { reflectionCount: reflections.length, allowedSourceIdCount: reflections.length, userTextTokenEstimate: estimateStringTokens(userText) });
	await runMemoryAgentLoop({
		model,
		apiKey,
		headers,
		signal,
		agentLoop: args.agentLoop,
		maxTurns: args.maxTurns,
		thinkingLevel: args.thinkingLevel,
		systemPrompt: REWRITE_SYSTEM,
		userText,
		tools: [recorder.tool as AgentTool<any>],
		agentName: "rewrite",
		maxNoToolRetries: 2,
		toolCallReminder: "You must call record_rewritten_reflections. Use { reflections: [] } if no safe emergency rewrite exists.",
		onUsage: args.onUsage,
	});

	const accepted = recorder.accepted();
	if (!recorder.called() || accepted.length === 0) {
		debugLog("rewrite.result", { reason: recorder.called() ? "empty_or_invalid" : "no_tool_call", acceptedCount: accepted.length, rejected: recorder.rejected() });
		return undefined;
	}
	return { reflections: accepted, summary: recorder.summary() };
}
