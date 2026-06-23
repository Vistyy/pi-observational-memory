import { agentLoop, type AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { debugLog } from "../../debug-log.js";
import { hashId, reflectionId } from "../../memory/ids.js";
import { estimateStringTokens } from "../../memory/token-estimate.js";
import { reflectionToSummaryLine, type Reflection } from "../../session-ledger/index.js";
import { joinOrEmpty, normalizeAllowedIdsStrict, runMemoryAgentLoop, type MemoryAgentUsage } from "../common.js";
import { normalizeReflectionContent } from "../reflection-content.js";
import { MAINTAINER_SYSTEM, MAINTAINER_TOOL_DESCRIPTION, maintainerUserText } from "./prompts.js";

const MAX_RETIRED_REFLECTIONS = 4;
const MAX_NEW_REFLECTIONS = 2;

export type MaintenanceResult = {
	retireReflectionIds: string[];
	reflections: Reflection[];
};

const RecordMaintenanceSchema = Type.Object({
	retireReflectionIds: Type.Array(Type.String({ minLength: 1 })),
	reflections: Type.Array(Type.Object({
		content: Type.String({ minLength: 1 }),
		sources: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	})),
});

type RecordMaintenanceArgs = Static<typeof RecordMaintenanceSchema>;

type MaintenanceToolResult = {
	tool: AgentTool<typeof RecordMaintenanceSchema>;
	called: () => boolean;
	accepted: () => MaintenanceResult | undefined;
	rejected: () => number;
};

function maintenanceRecordTool(inputReflections: Reflection[]): MaintenanceToolResult {
	const allowedReflectionIds = inputReflections.map((reflection) => reflection.id);
	const existingReflectionIds = new Set(allowedReflectionIds);
	let called = false;
	let rejected = 0;
	let accepted: MaintenanceResult | undefined;

	const tool: AgentTool<typeof RecordMaintenanceSchema> = {
		name: "record_maintenance",
		label: "Record maintenance",
		description: MAINTAINER_TOOL_DESCRIPTION,
		parameters: RecordMaintenanceSchema,
		execute: async (_id, params: RecordMaintenanceArgs) => {
			called = true;
			accepted = undefined;
			const reject = (message: string): never => {
				rejected++;
				throw new Error(message);
			};

			if (params.retireReflectionIds.length === 0 && params.reflections.length === 0) {
				accepted = { retireReflectionIds: [], reflections: [] };
				return { content: [{ type: "text", text: "Accepted no-op maintenance." }], details: { accepted: 0, rejected }, terminate: true };
			}

			const retireReflectionIds = normalizeAllowedIdsStrict(params.retireReflectionIds, allowedReflectionIds);
			if (!retireReflectionIds) {
				return reject("Rejected invalid maintenance action: retired ids must be input reflections.");
			}
			if (retireReflectionIds.length < 2 || retireReflectionIds.length > MAX_RETIRED_REFLECTIONS || params.reflections.length === 0 || params.reflections.length > MAX_NEW_REFLECTIONS) {
				return reject("Rejected invalid maintenance action: non-noop maintenance must retire 2-4 input reflections and create 1-2 replacements.");
			}

			const retired = new Set(retireReflectionIds);
			const accumulated = new Map<string, Reflection>();
			let proposalRejected = 0;
			for (const proposal of params.reflections) {
				const content = normalizeReflectionContent(proposal.content);
				const sources = normalizeAllowedIdsStrict(proposal.sources, retireReflectionIds);
				if (!content || !sources || sources.some((source) => !source.startsWith("ref_"))) {
					proposalRejected++;
					continue;
				}
				const id = reflectionId(hashId(content));
				if (existingReflectionIds.has(id) || accumulated.has(id)) continue;
				accumulated.set(id, { id, kind: "reflection", content, sources, createdAt: new Date().toISOString() });
			}

			const reflections = Array.from(accumulated.values());
			const replacementSources = new Set(reflections.flatMap((reflection) => reflection.sources));
			const allRetiredCovered = retireReflectionIds.every((id) => replacementSources.has(id));
			if (reflections.length === 0 || proposalRejected > 0 || !allRetiredCovered) {
				rejected += Math.max(1, proposalRejected) - 1;
				return reject("Rejected unsafe maintenance action: replacements must cite every retired direct ref_* parent and no other source ids.");
			}

			accepted = { retireReflectionIds, reflections };
			return {
				content: [{ type: "text", text: `Accepted maintenance with ${retireReflectionIds.length} retired reflection${retireReflectionIds.length === 1 ? "" : "s"} and ${reflections.length} replacement${reflections.length === 1 ? "" : "s"}.` }],
				details: { accepted: reflections.length, retired: retireReflectionIds.length, rejected },
				terminate: true,
			};
		},
	};

	return {
		tool,
		called: () => called,
		accepted: () => accepted,
		rejected: () => rejected,
	};
}

interface RunMaintainerArgs {
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

export async function runMaintainer(args: RunMaintainerArgs): Promise<MaintenanceResult | undefined> {
	const { model, apiKey, headers, reflections, signal } = args;
	if (reflections.length === 0) return undefined;

	const recorder = maintenanceRecordTool(reflections);
	const userText = maintainerUserText(joinOrEmpty(reflections.map(reflectionToSummaryLine)));
	debugLog("maintainer.prompt", { reflectionCount: reflections.length, userTextTokenEstimate: estimateStringTokens(userText) });
	await runMemoryAgentLoop({
		model,
		apiKey,
		headers,
		signal,
		agentLoop: args.agentLoop,
		maxTurns: args.maxTurns,
		thinkingLevel: args.thinkingLevel,
		systemPrompt: MAINTAINER_SYSTEM,
		userText,
		tools: [recorder.tool as AgentTool<any>],
		agentName: "maintainer",
		maxNoToolRetries: 2,
		toolCallReminder: "You must call record_maintenance. Use { retireReflectionIds: [], reflections: [] } if no safe local maintenance exists.",
		onUsage: args.onUsage,
	});

	const accepted = recorder.accepted();
	if (!recorder.called() || !accepted) {
		debugLog("maintainer.result", { reason: recorder.called() ? "invalid" : "no_tool_call", rejected: recorder.rejected() });
		return undefined;
	}
	debugLog("maintainer.result", { retiredCount: accepted.retireReflectionIds.length, reflectionCount: accepted.reflections.length, rejected: recorder.rejected() });
	return accepted;
}
