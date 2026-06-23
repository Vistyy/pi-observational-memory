import { debugLog } from "../debug-log.js";
import { type MemoryUpdatePhase, type ResolveResult, type Runtime } from "../runtime.js";
import type { MemoryUpdateCtx, ResolvedModel } from "./types.js";

export function makeModelResolver(runtime: Runtime, ctx: MemoryUpdateCtx): (stage: MemoryUpdatePhase) => Promise<ResolvedModel | undefined> {
	let cached: ResolveResult | undefined;
	return async (stage) => {
		cached ??= await runtime.resolveModel({
			model: ctx.model,
			modelRegistry: ctx.modelRegistry,
			hasUI: ctx.hasUI,
			ui: ctx.ui,
		});
		if (cached.ok) {
			runtime.resolveFailureNotified = false;
			return cached;
		}
		debugLog(`${stage}.model_unavailable`, { reason: cached.reason });
		if (!runtime.resolveFailureNotified && ctx.hasUI && ctx.ui) {
			ctx.ui.notify(`Observational memory: ${stage} skipped — ${cached.reason}`, "warning");
			runtime.resolveFailureNotified = true;
		}
		return undefined;
	};
}
