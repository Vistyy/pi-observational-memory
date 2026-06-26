import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { STRATEGY } from "../config.js";
import { debugSessionMetadata, withDebugLogContext } from "../debug-log.js";
import type { Runtime } from "../runtime.js";
import type { Entry } from "../session-ledger/index.js";
import { computeMemoryStageWork, type MemoryUpdateTrigger } from "./due.js";
import { runMemoryUpdate } from "./run.js";
import type { MemoryUpdateCtx } from "./types.js";

export function registerMemoryUpdateHook(pi: ExtensionAPI, runtime: Runtime): void {
	const launch = (trigger: MemoryUpdateTrigger) => (_event: unknown, ctx: MemoryUpdateCtx) => {
		maybeLaunchMemoryUpdate(pi, runtime, ctx, trigger);
	};
	pi.on("agent_start", launch("agent_start"));
	pi.on("message_end", launch("message_end"));
	pi.on("turn_end", launch("turn_end"));
}

function maybeLaunchMemoryUpdate(pi: ExtensionAPI, runtime: Runtime, ctx: MemoryUpdateCtx, trigger: MemoryUpdateTrigger): void {
	runtime.ensureConfig(ctx.cwd);
	if (runtime.config.strategy === STRATEGY.off) return;
	if (runtime.memoryUpdateInFlight) return;

	const entries = ctx.sessionManager.getBranch() as Entry[];
	const work = computeMemoryStageWork(entries, runtime, trigger);
	if (work.observerWork.length === 0 && work.checkpointWork.length === 0 && work.reflectorWork.length === 0 && work.maintainerWork.length === 0 && work.rewriteWork.length === 0) return;

	const runId = `memory-update-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
	const sessionMetadata = debugSessionMetadata(ctx);
	void runtime.launchMemoryUpdateTask(ctx, async () => withDebugLogContext({
		enabled: runtime.config.debugLog === true,
		cwd: ctx.cwd,
		...sessionMetadata,
		runId,
	}, async () => {
		await runMemoryUpdate(pi, runtime, ctx, trigger);
	}));
}
