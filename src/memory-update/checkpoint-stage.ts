import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runCheckpointEditor } from "../agents/checkpoint-editor/agent.js";
import { debugLog } from "../debug-log.js";
import { checkpointFromMarkdown, EMPTY_CHECKPOINT_MARKDOWN, renderObservationsForCheckpointEditor } from "../memory/checkpoint.js";
import type { Runtime } from "../runtime.js";
import {
	OM_CHECKPOINT_COVERAGE_ADVANCED,
	OM_CHECKPOINT_RECORDED,
	buildCheckpointCoverageAdvancedData,
	buildCheckpointRecordedData,
	foldLedger,
	type Entry,
	type Observation,
} from "../session-ledger/index.js";
import { commonAgentArgs } from "./agent-args.js";
import type { MemoryUpdateCtx, ResolveMemoryModel, StageOutcome } from "./types.js";

export async function runCheckpointStage(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: MemoryUpdateCtx,
	resolveModel: ResolveMemoryModel,
	observations: Observation[],
): Promise<StageOutcome> {
	if (observations.length === 0) return "continue";
	const entries = ctx.sessionManager.getBranch() as Entry[];
	const folded = foldLedger(entries);
	const previousContent = folded.checkpoint?.content ?? EMPTY_CHECKPOINT_MARKDOWN;
	const coversUpToObservationId = observations.at(-1)?.id;
	if (!coversUpToObservationId) return "continue";
	const observationIds = observations.map((observation) => observation.id);
	const resolved = await resolveModel("checkpoint-editor" as never);
	if (!resolved) return "abort";

	const dir = await mkdtemp(join(tmpdir(), "om-checkpoint-editor-"));
	const draftPath = join(dir, "checkpoint.md");
	try {
		const result = await runCheckpointEditor({
			...commonAgentArgs(pi, runtime, resolved, runtime.config.observerThinking, "checkpoint-editor"),
			draftPath,
			initialContent: previousContent,
			observationsText: renderObservationsForCheckpointEditor(observations),
			purpose: "update",
		});
		if (!result) {
			debugLog("checkpoint_editor.no_finish", { coversUpToObservationId, observationIds });
			if (ctx.hasUI) ctx.ui?.notify("Observational memory: checkpoint editor did not finish", "warning");
			return "continue";
		}

		if (!result.changed) {
			const data = buildCheckpointCoverageAdvancedData({
				coversUpToObservationId,
				observationIds,
				reason: result.reason,
			});
			if (data) pi.appendEntry(OM_CHECKPOINT_COVERAGE_ADVANCED, data);
			debugLog("checkpoint.coverage_advanced", { coversUpToObservationId, observationCount: observationIds.length, reason: result.reason });
			return "continue";
		}

		const checkpoint = checkpointFromMarkdown(result.content);
		if (!checkpoint) {
			debugLog("checkpoint.invalid", { coversUpToObservationId });
			if (ctx.hasUI) ctx.ui?.notify("Observational memory: checkpoint editor produced invalid checkpoint", "warning");
			return "continue";
		}

		const data = buildCheckpointRecordedData({
			mode: "update",
			checkpoint,
			coversUpToObservationId,
			observationIds,
		});
		if (data) pi.appendEntry(OM_CHECKPOINT_RECORDED, data);
		debugLog("checkpoint.recorded", { checkpointId: checkpoint.id, coversUpToObservationId, observationCount: observationIds.length });
		if (ctx.hasUI) ctx.ui?.notify(`Observational memory: checkpoint ${checkpoint.id} recorded`, "info");
		return "continue";
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
