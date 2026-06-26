import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { debugLog } from "../debug-log.js";
import type { MemoryUpdatePhase, Runtime } from "../runtime.js";
import type { Entry } from "../session-ledger/index.js";
import { computeMemoryStageWork, type MemoryUpdateTrigger } from "./due.js";
import { makeModelResolver } from "./model-resolver.js";
import type { MemoryUpdateCtx, StageOutcome } from "./types.js";

type ObserverStageModule = typeof import("./observer-stage.js");
type CheckpointStageModule = typeof import("./checkpoint-stage.js");

let observerStageModule: Promise<ObserverStageModule> | undefined;
let checkpointStageModule: Promise<CheckpointStageModule> | undefined;

function loadObserverStage(): Promise<ObserverStageModule> {
	return observerStageModule ??= import("./observer-stage.js");
}

function loadCheckpointStage(): Promise<CheckpointStageModule> {
	return checkpointStageModule ??= import("./checkpoint-stage.js");
}

async function runTrackedStage(
	_pi: ExtensionAPI,
	runtime: Runtime,
	ctx: MemoryUpdateCtx,
	stage: MemoryUpdatePhase,
	run: () => Promise<StageOutcome>,
): Promise<StageOutcome> {
	runtime.memoryUpdatePhase = stage;
	try {
		return await run();
	} catch (error) {
		const reason = runtime.recordMemoryUpdateStageError(ctx, stage, error);
		debugLog(`${stage}.error`, { errorMessage: reason });
		return "abort";
	}
}

export async function runMemoryUpdate(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: MemoryUpdateCtx,
	trigger: MemoryUpdateTrigger = "turn_end",
): Promise<void> {
	const resolveModel = makeModelResolver(runtime, ctx);
	let entries = ctx.sessionManager.getBranch() as Entry[];
	let work = computeMemoryStageWork(entries, runtime, trigger);

	if (work.observerWork.length > 0) {
		const observerWork = runTrackedStage(
			pi,
			runtime,
			ctx,
			"observer",
			async () => {
				const { runObserverStage } = await loadObserverStage();
				return runObserverStage(pi, runtime, ctx, resolveModel, work.observerWork);
			},
		);
		const observerPromise = observerWork.then(() => undefined);
		runtime.inFlightObserverStagePromise = observerPromise;
		let observerOutcome: StageOutcome;
		try {
			observerOutcome = await observerWork;
		} finally {
			if (runtime.inFlightObserverStagePromise === observerPromise) runtime.inFlightObserverStagePromise = null;
		}
		if (observerOutcome === "abort") return;
		entries = ctx.sessionManager.getBranch() as Entry[];
		work = computeMemoryStageWork(entries, runtime, trigger);
	}

	if (work.checkpointWork.length > 0) {
		const checkpointOutcome = await runTrackedStage(
			pi,
			runtime,
			ctx,
			"checkpoint-editor",
			async () => {
				const { runCheckpointStage } = await loadCheckpointStage();
				return runCheckpointStage(pi, runtime, ctx, resolveModel, work.checkpointWork);
			},
		);
		if (checkpointOutcome === "abort") return;
	}
}
