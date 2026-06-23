import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { debugLog } from "../debug-log.js";
import type { MemoryUpdatePhase, Runtime } from "../runtime.js";
import type { Entry } from "../session-ledger/index.js";
import { computeMemoryStageWork } from "./due.js";
import { makeModelResolver } from "./model-resolver.js";
import type { MemoryUpdateCtx, StageOutcome } from "./types.js";

type ObserverStageModule = typeof import("./observer-stage.js");
type ReflectorStageModule = typeof import("./reflector-stage.js");
type MaintainerStageModule = typeof import("./maintainer-stage.js");
type RewriteStageModule = typeof import("./rewrite-stage.js");

let observerStageModule: Promise<ObserverStageModule> | undefined;
let reflectorStageModule: Promise<ReflectorStageModule> | undefined;
let maintainerStageModule: Promise<MaintainerStageModule> | undefined;
let rewriteStageModule: Promise<RewriteStageModule> | undefined;

function loadObserverStage(): Promise<ObserverStageModule> {
	return observerStageModule ??= import("./observer-stage.js");
}

function loadReflectorStage(): Promise<ReflectorStageModule> {
	return reflectorStageModule ??= import("./reflector-stage.js");
}

function loadMaintainerStage(): Promise<MaintainerStageModule> {
	return maintainerStageModule ??= import("./maintainer-stage.js");
}

function loadRewriteStage(): Promise<RewriteStageModule> {
	return rewriteStageModule ??= import("./rewrite-stage.js");
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
): Promise<void> {
	const resolveModel = makeModelResolver(runtime, ctx);
	let entries = ctx.sessionManager.getBranch() as Entry[];
	let work = computeMemoryStageWork(entries, runtime);

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
		work = computeMemoryStageWork(entries, runtime);
	}

	if (work.reflectorWork.length > 0) {
		const reflectorOutcome = await runTrackedStage(
			pi,
			runtime,
			ctx,
			"reflector",
			async () => {
				const { runReflectorStage } = await loadReflectorStage();
				return runReflectorStage(pi, runtime, ctx, resolveModel, work.reflectorWork);
			},
		);
		if (reflectorOutcome === "abort") return;
		entries = ctx.sessionManager.getBranch() as Entry[];
		work = computeMemoryStageWork(entries, runtime);
	}

	if (work.maintainerWork.length > 0) {
		const maintainerOutcome = await runTrackedStage(
			pi,
			runtime,
			ctx,
			"maintainer",
			async () => {
				const { runMaintainerStage } = await loadMaintainerStage();
				return runMaintainerStage(pi, runtime, ctx, resolveModel, work.maintainerWork);
			},
		);
		if (maintainerOutcome === "abort") return;
		entries = ctx.sessionManager.getBranch() as Entry[];
		work = computeMemoryStageWork(entries, runtime);
	}

	if (work.rewriteWork.length > 0) {
		await runTrackedStage(
			pi,
			runtime,
			ctx,
			"rewrite",
			async () => {
				const { runRewriteStage } = await loadRewriteStage();
				return runRewriteStage(pi, runtime, ctx, resolveModel);
			},
		);
	}
}
