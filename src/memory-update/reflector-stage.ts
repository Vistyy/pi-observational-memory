import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runReflector } from "../agents/reflector/agent.js";
import { debugLog } from "../debug-log.js";
import type { Runtime } from "../runtime.js";
import {
	OM_REFLECTIONS_RECORDED,
	buildReflectionsRecordedData,
	foldLedger,
	sourceEntriesAfterIndex,
	type Entry,
	type Observation,
} from "../session-ledger/index.js";
import { commonAgentArgs } from "./agent-args.js";
import type { MemoryUpdateCtx, ResolveMemoryModel, StageOutcome } from "./types.js";

function messageRecord(entry: Entry): Record<string, any> | undefined {
	return entry.message && typeof entry.message === "object" ? entry.message as Record<string, any> : undefined;
}

function touchedFilePath(msg: Record<string, any>): string | undefined {
	const path = typeof msg.path === "string" ? msg.path : typeof msg.filePath === "string" ? msg.filePath : undefined;
	return path?.trim() || undefined;
}

export function knownStructuredTouchedFiles(entries: Entry[]): string[] {
	const paths = new Set<string>();
	for (const entry of entries) {
		const msg = messageRecord(entry);
		if (!msg || msg.role !== "toolResult" || msg.isError === true) continue;
		if (msg.toolName !== "edit" && msg.toolName !== "write") continue;
		const path = touchedFilePath(msg);
		if (path) paths.add(path);
	}
	return [...paths].sort();
}

export async function runReflectorStage(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: MemoryUpdateCtx,
	resolveModel: ResolveMemoryModel,
	workObservations?: Observation[],
): Promise<StageOutcome> {
	const entries = ctx.sessionManager.getBranch() as Entry[];
	const folded = foldLedger(entries);
	const unreflectedObservations = workObservations ?? folded.unreflectedObservations;
	const observationCoverageId = folded.lastObservationCoverageId;
	if (!observationCoverageId) {
		debugLog("reflector.skip", { reason: "no_observation_coverage" });
		return "continue";
	}

	const reflectionWorkCount = unreflectedObservations.length;
	if (!workObservations && reflectionWorkCount < runtime.config.reflectEveryObservations) {
		debugLog("reflector.skip", {
			reason: "below_observation_threshold",
			unreflectedObservationCount: unreflectedObservations.length,
			reflectionWorkCount,
			reflectEveryObservations: runtime.config.reflectEveryObservations,
			observationCount: folded.observations.length,
		});
		return "continue";
	}
	debugLog("reflector.stage_run", {
		unreflectedObservationCount: unreflectedObservations.length,
		observationCount: folded.observations.length,
		reflectionWorkCount,
		reflectionCount: folded.reflections.length,
		observationCoverageId,
	});

	if (ctx.hasUI) ctx.ui?.notify(
		`Observational memory: reflector running (${reflectionWorkCount.toLocaleString()} unreviewed observation${reflectionWorkCount === 1 ? "" : "s"})`,
		"info",
	);
	const resolved = await resolveModel("reflector");
	if (!resolved) return "abort";

	const touchedFiles = knownStructuredTouchedFiles(sourceEntriesAfterIndex(entries, folded.lastReflectionCoverageIndex, folded.lastObservationCoverageIndex + 1));
	const reflections = await runReflector({
		...commonAgentArgs(pi, runtime, resolved, runtime.config.reflectorThinking),
		reflections: folded.reflections,
		observations: unreflectedObservations,
		touchedFiles,
	});
	if (!reflections) {
		debugLog("reflector.no_tool_output", { observationCoverageId });
		return "continue";
	}
	if (reflections.length === 0) debugLog("reflector.reviewed_empty", { observationCoverageId });

	const data = buildReflectionsRecordedData(reflections, observationCoverageId);
	if (!data) return "continue";
	pi.appendEntry(OM_REFLECTIONS_RECORDED, data);
	return "continue";
}
