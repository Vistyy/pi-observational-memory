import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildUsageRecordedData, PI_USAGE_RECORDED } from "../usage.js";
import type { MemoryAgentUsage } from "../agents/common.js";
import type { Runtime } from "../runtime.js";
import type { ResolvedModel } from "./types.js";

export function commonAgentArgs(pi: ExtensionAPI, runtime: Runtime, resolved: ResolvedModel, thinkingOverride?: ModelThinkingLevel, operation = "memory-update") {
	return {
		model: resolved.model as any,
		apiKey: resolved.apiKey,
		headers: resolved.headers,
		maxTurns: runtime.config.agentMaxTurns,
		thinkingLevel: thinkingOverride ?? runtime.config.model?.thinking ?? "low",
		onUsage: (usage: MemoryAgentUsage) => {
			pi.appendEntry(PI_USAGE_RECORDED, buildUsageRecordedData({
				extension: "observational-memory",
				agent: usage.agent,
				operation,
				model: usage.model,
				usage: usage.usage,
			}));
		},
	};
}
