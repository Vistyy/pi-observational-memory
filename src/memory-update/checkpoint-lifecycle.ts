import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runCheckpointEditor } from "../agents/checkpoint-editor/agent.js";
import { thinkingForAgent } from "../config.js";
import { debugLog } from "../debug-log.js";
import { checkpointFromMarkdown, EMPTY_CHECKPOINT_MARKDOWN, renderObservationsForCheckpointEditor } from "../memory/checkpoint.js";
import type { Runtime } from "../runtime.js";
import {
	OM_CHECKPOINT_COVERAGE_ADVANCED,
	OM_CHECKPOINT_RECORDED,
	buildCheckpointCoverageAdvancedData,
	buildCheckpointRecordedData,
	buildSessionMemoryState,
	type Entry,
	type Observation,
} from "../session-ledger/index.js";
import { commonAgentArgs } from "./agent-args.js";
import type { MemoryUpdateCtx, ResolveMemoryModel, StageOutcome } from "./types.js";

export type CheckpointLifecycleRequest =
	| { purpose: "update"; observations: Observation[] }
	| { purpose: "prune"; reason: "health" | "compaction-pressure" };

function checkpointEditorNotice(ctx: MemoryUpdateCtx, message: string): void {
	if (ctx.hasUI) ctx.ui?.notify(message, "warning");
}

export async function runCheckpointLifecycle(args: {
	pi: ExtensionAPI;
	runtime: Runtime;
	ctx: MemoryUpdateCtx;
	resolveModel: ResolveMemoryModel;
	request: CheckpointLifecycleRequest;
}): Promise<StageOutcome> {
	const entries = args.ctx.sessionManager.getBranch() as Entry[];
	const state = buildSessionMemoryState(entries);
	const folded = state.folded;
	const previousContent = folded.checkpoint?.content ?? EMPTY_CHECKPOINT_MARKDOWN;
	const observations = args.request.purpose === "update" ? args.request.observations : [];
	const coversUpToObservationId = args.request.purpose === "update"
		? observations.at(-1)?.id
		: folded.lastCheckpointCoverageObservationId;
	if (args.request.purpose === "update" && observations.length === 0) return "continue";
	if (args.request.purpose === "prune" && !folded.checkpoint) return "continue";
	if (!coversUpToObservationId) return "continue";
	const observationIds = observations.map((observation) => observation.id);
	const resolved = await args.resolveModel("checkpoint-editor" as never);
	if (!resolved) return "abort";

	const dir = await mkdtemp(join(tmpdir(), "om-checkpoint-editor-"));
	const draftPath = join(dir, "checkpoint.md");
	try {
		const result = await runCheckpointEditor({
			...commonAgentArgs(args.pi, args.runtime, resolved, thinkingForAgent(args.runtime.config, "checkpoint-editor"), "checkpoint-editor"),
			draftPath,
			initialContent: previousContent,
			observationsText: args.request.purpose === "update" ? renderObservationsForCheckpointEditor(observations) : "",
			purpose: args.request.purpose,
		});
		if (!result) {
			debugLog("checkpoint_editor.no_finish", { purpose: args.request.purpose, coversUpToObservationId, observationIds });
			checkpointEditorNotice(args.ctx, "Observational memory: checkpoint editor did not finish");
			return "continue";
		}

		if (!result.changed) {
			if (args.request.purpose === "prune") {
				debugLog("checkpoint.prune_unchanged", { coversUpToObservationId, reason: result.reason });
				return "continue";
			}
			const data = buildCheckpointCoverageAdvancedData({
				coversUpToObservationId,
				observationIds,
				reason: result.reason,
			});
			if (data) args.pi.appendEntry(OM_CHECKPOINT_COVERAGE_ADVANCED, data);
			debugLog("checkpoint.coverage_advanced", { coversUpToObservationId, observationCount: observationIds.length, reason: result.reason });
			return "continue";
		}

		const checkpoint = checkpointFromMarkdown(result.content);
		if (!checkpoint) {
			debugLog("checkpoint.invalid", { purpose: args.request.purpose, coversUpToObservationId });
			checkpointEditorNotice(args.ctx, "Observational memory: checkpoint editor produced invalid checkpoint");
			return "continue";
		}

		const data = buildCheckpointRecordedData({
			mode: args.request.purpose,
			checkpoint,
			coversUpToObservationId,
			observationIds,
		});
		if (data) args.pi.appendEntry(OM_CHECKPOINT_RECORDED, data);
		debugLog("checkpoint.recorded", { checkpointId: checkpoint.id, purpose: args.request.purpose, coversUpToObservationId, observationCount: observationIds.length });
		if (args.ctx.hasUI) args.ctx.ui?.notify(`Observational memory: checkpoint ${checkpoint.id} recorded`, "info");
		return "continue";
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
