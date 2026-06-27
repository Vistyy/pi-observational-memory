import { configuredModelForAgent } from "../config.js";
import { debugLog } from "../debug-log.js";
import { type ResolveResult, type Runtime } from "../runtime.js";
import type { MemoryUpdateCtx, MemoryUpdatePhase, ResolvedModel } from "./types.js";

export function makeModelResolver(runtime: Runtime, ctx: MemoryUpdateCtx): (stage: MemoryUpdatePhase) => Promise<ResolvedModel | undefined> {
	const cachedByStage = new Map<MemoryUpdatePhase, ResolveResult>();
	return async (stage) => {
		let result = cachedByStage.get(stage);
		if (!result) {
			result = await runtime.resolveModel({
				model: ctx.model,
				modelRegistry: ctx.modelRegistry,
				hasUI: ctx.hasUI,
				ui: ctx.ui,
			}, configuredModelForAgent(runtime.config, stage));
			cachedByStage.set(stage, result);
		}
		if (result.ok) {
			runtime.resolveFailureNotified = false;
			return result;
		}
		debugLog(`${stage}.model_unavailable`, { reason: result.reason });
		if (!runtime.resolveFailureNotified && ctx.hasUI && ctx.ui) {
			ctx.ui.notify(`Observational memory: ${stage} skipped - ${result.reason}`, "warning");
			runtime.resolveFailureNotified = true;
		}
		return undefined;
	};
}
