import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { STRATEGY } from "../config.js";
import { ensureObservedBeforeCompaction } from "../memory-update/compaction.js";
import type { Runtime } from "../runtime.js";
import { buildCompactionMemory, renderSummary, type Entry } from "../session-ledger/index.js";

const COMPACTION_HANDOFF_OBSERVATION_MAX_COUNT = 8;
const COMPACTION_HANDOFF_OBSERVATION_MAX_TOKENS = 1_000;

export function registerCompactionHook(pi: ExtensionAPI, runtime: Runtime): void {
	pi.on("session_before_compact", async (event: any, ctx: any) => {
		if (runtime.compactHookInFlight) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					"Observational memory: another compaction is already in progress; cancelling duplicate",
					"warning",
				);
			}
			return { cancel: true };
		}

		runtime.compactHookInFlight = true;
		try {
			runtime.ensureConfig(ctx.cwd);
			if (runtime.config.strategy === STRATEGY.off) return;
			const { preparation } = event;
			const { firstKeptEntryId, tokensBefore } = preparation;
			const compactionHandoffObservations = await ensureObservedBeforeCompaction(pi, runtime, ctx, { firstKeptEntryId });
			if (runtime.config.strategy !== STRATEGY.replacement) return;
			const branchEntries = ctx.sessionManager.getBranch() as Entry[];
			const memory = buildCompactionMemory(
				branchEntries,
				{
					compactionHandoffObservationMaxCount: COMPACTION_HANDOFF_OBSERVATION_MAX_COUNT,
					compactionHandoffObservationMaxTokens: COMPACTION_HANDOFF_OBSERVATION_MAX_TOKENS,
				},
				{ compactionHandoffObservations },
			);
			const summary = renderSummary(memory.reflections, memory.handoffObservations);

			return {
				compaction: {
					summary,
					firstKeptEntryId,
					tokensBefore,
					details: memory.details,
				},
			};
		} finally {
			runtime.compactHookInFlight = false;
		}
	});
}
