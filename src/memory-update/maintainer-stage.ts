import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runMaintainer } from "../agents/maintainer/agent.js";
import { debugLog } from "../debug-log.js";
import type { Runtime } from "../runtime.js";
import {
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_REWRITTEN,
	buildReflectionsRecordedData,
	buildReflectionsRewrittenData,
	type Entry,
	type Reflection,
} from "../session-ledger/index.js";
import { commonAgentArgs } from "./agent-args.js";
import type { MemoryUpdateCtx, ResolveMemoryModel, StageOutcome } from "./types.js";

export async function runMaintainerStage(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: MemoryUpdateCtx,
	resolveModel: ResolveMemoryModel,
	reflections: Reflection[],
): Promise<StageOutcome> {
	if (reflections.length === 0) return "continue";
	if (ctx.hasUI) ctx.ui?.notify(`Observational memory: maintainer running (${reflections.length.toLocaleString()} reflections)`, "info");
	const resolved = await resolveModel("maintainer");
	if (!resolved) return "abort";

	const result = await runMaintainer({
		...commonAgentArgs(pi, runtime, resolved, runtime.config.maintainerThinking),
		reflections,
	});
	if (!result || result.retireReflectionIds.length === 0 || result.reflections.length === 0) {
		const reason = result ? "no_op" : "invalid_or_no_tool";
		runtime.lastMaintainerSkip = { reason, reflectionCount: reflections.length };
		debugLog("maintainer.skip", { reason, reflectionCount: reflections.length });
		return "continue";
	}

	const entries = ctx.sessionManager.getBranch() as Entry[];
	const recordedData = buildReflectionsRecordedData(result.reflections, entries.at(-1)?.id ?? "maintainer");
	const rewrittenData = buildReflectionsRewrittenData({ retiredReflectionIds: result.retireReflectionIds });
	if (!recordedData || !rewrittenData) return "continue";
	runtime.lastMaintainerSkip = undefined;
	pi.appendEntry(OM_REFLECTIONS_RECORDED, recordedData);
	pi.appendEntry(OM_REFLECTIONS_REWRITTEN, rewrittenData);
	return "continue";
}
