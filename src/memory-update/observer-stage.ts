import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../runtime.js";
import { buildSessionMemoryState, observerSourceEntriesAfterCoverage, type Entry } from "../session-ledger/index.js";
import { recordObserverObservations } from "./observer-recording.js";
import type { MemoryUpdateCtx, ResolveMemoryModel, StageOutcome } from "./types.js";

export async function runObserverStage(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: MemoryUpdateCtx,
	resolveModel: ResolveMemoryModel,
	workEntries?: Entry[],
): Promise<StageOutcome> {
	const entries = ctx.sessionManager.getBranch() as Entry[];
	const state = buildSessionMemoryState(entries);
	const chunkEntries = workEntries ?? observerSourceEntriesAfterCoverage(state);
	const sourceEntryCount = chunkEntries.length;
	if (sourceEntryCount === 0) return "continue";
	if (!workEntries && sourceEntryCount < runtime.config.observeEveryMessages) return "continue";

	const result = await recordObserverObservations({
		pi,
		runtime,
		ctx,
		resolveModel,
		sourceEntries: chunkEntries,
		purpose: "normal",
		skipInitialBackfillIfTooLarge: true,
	});
	return result.outcome;
}
