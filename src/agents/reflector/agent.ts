import { agentLoop, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { debugLog } from "../../debug-log.js";
import { estimateStringTokens } from "../../memory/token-estimate.js";
import { observationToSummaryLine, reflectionToSummaryLine, type Observation, type Reflection } from "../../session-ledger/index.js";
import { joinOrEmpty, runMemoryAgentLoop, type MemoryAgentUsage } from "../common.js";
import { reflectionRecordTool } from "../record-tool.js";
import { REFLECTOR_SYSTEM, REFLECTOR_TOOL_DESCRIPTION, reflectorUserText } from "./prompts.js";

interface RunReflectorArgs {
	model: Model<any>;
	apiKey: string;
	headers?: Record<string, string>;
	reflections: Reflection[];
	observations: Observation[];
	touchedFiles?: string[];
	signal?: AbortSignal;
	agentLoop?: typeof agentLoop;
	maxTurns?: number;
	thinkingLevel?: ModelThinkingLevel;
	onUsage?: (usage: MemoryAgentUsage) => void;
}

export async function runReflector(args: RunReflectorArgs): Promise<Reflection[] | undefined> {
	const { model, apiKey, headers, reflections, observations, signal } = args;
	if (observations.length === 0) return undefined;

	debugLog("reflector.agent_start", {
		activeObservationCount: observations.length,
		reflectionCount: reflections.length,
	});

	const recorder = reflectionRecordTool({
		name: "record_reflections",
		label: "Record reflections",
		description: REFLECTOR_TOOL_DESCRIPTION,
		allowedSourceIds: observations.map((observation) => observation.id),
		existingReflectionIds: new Set(reflections.map((reflection) => reflection.id)),
	});

	const userText = reflectorUserText(joinOrEmpty(reflections.map(reflectionToSummaryLine)), joinOrEmpty(observations.map(observationToSummaryLine)), args.touchedFiles ?? []);
	debugLog("reflector.prompt", {
		reflectionCount: reflections.length,
		observationCount: observations.length,
		touchedFileCount: args.touchedFiles?.length ?? 0,
		userTextTokenEstimate: estimateStringTokens(userText),
	});
	await runMemoryAgentLoop({
		model,
		apiKey,
		headers,
		signal,
		agentLoop: args.agentLoop,
		maxTurns: args.maxTurns,
		thinkingLevel: args.thinkingLevel,
		systemPrompt: REFLECTOR_SYSTEM,
		userText,
		tools: [recorder.tool as AgentTool<any>],
		agentName: "reflector",
		onUsage: args.onUsage,
	});
	const acceptedReflections = recorder.accepted();
	debugLog("reflector.result", {
		reason: acceptedReflections.length > 0 ? "accepted_nonempty" : recorder.recordedEmpty() ? "recorded_empty" : recorder.called() ? "all_filtered" : "no_tool_call",
		acceptedCount: acceptedReflections.length,
	});
	if (acceptedReflections.length > 0) return acceptedReflections;
	return recorder.recordedEmpty() ? [] : undefined;
}

export { normalizeAllowedIdsStrict as normalizeSourceIds } from "../common.js";
