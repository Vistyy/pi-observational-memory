import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { STRATEGY } from "../config.js";
import { debugLog, debugSessionMetadata, withDebugLogContext } from "../debug-log.js";
import { estimateStringTokens } from "../memory/token-estimate.js";
import type { Runtime } from "../runtime.js";
import {
	buildCompactionMemory,
	buildSessionMemoryState,
	observerSourceEntriesAfterCoverage,
	renderCheckpointSummary,
	uncheckpointedObservationsBeforeEntry,
	type CheckpointMemoryDetails,
	type Entry,
	type Observation,
} from "../session-ledger/index.js";
import { runCheckpointLifecycle } from "./checkpoint-lifecycle.js";
import { computeMemoryStageWork, type MemoryUpdateTrigger } from "./due.js";
import { makeModelResolver } from "./model-resolver.js";
import { recordObserverObservations } from "./observer-recording.js";
import { runObserverStage } from "./observer-stage.js";
import type { MemoryUpdateCtx, StageOutcome } from "./types.js";

const COMPACTION_HANDOFF_OBSERVATION_MAX_COUNT = 8;
const COMPACTION_HANDOFF_OBSERVATION_MAX_TOKENS = 1_000;

export type MemoryLifecyclePhase = "observer" | "checkpoint-editor";

export type LifecycleHealth = {
	memoryUpdateInFlight: boolean;
	memoryUpdatePhase?: MemoryLifecyclePhase;
	compactHookInFlight: boolean;
	lastObserverError?: string;
	lastCheckpointEditorError?: string;
	observeGap: number;
	checkpointGap: number;
	checkpointPruneDue: boolean;
};

export type CompactionPreparation =
	| { kind: "ready"; summary: string; firstKeptEntryId?: string; tokensBefore?: number; details?: CheckpointMemoryDetails }
	| { kind: "cancel"; reason: string }
	| { kind: "noop" };

export class MemoryLifecycle {
	private memoryUpdateInFlight = false;
	private memoryUpdateRerunRequested = false;
	private inFlightObserverStagePromise: Promise<void> | null = null;
	private memoryUpdatePhase: MemoryLifecyclePhase | undefined;
	private compactHookInFlight = false;
	private lastObserverError: string | undefined;
	private lastCheckpointEditorError: string | undefined;

	constructor(private readonly pi: ExtensionAPI, private readonly runtime: Runtime) {}

	handleTrigger(trigger: MemoryUpdateTrigger, ctx: MemoryUpdateCtx): void {
		this.runtime.ensureConfig(ctx.cwd);
		if (this.runtime.config.strategy === STRATEGY.off) return;
		if (this.memoryUpdateInFlight) {
			this.memoryUpdateRerunRequested = true;
			return;
		}

		const entries = ctx.sessionManager.getBranch() as Entry[];
		const work = computeMemoryStageWork(entries, this.runtime, trigger);
		if (work.observerWork.length === 0 && work.checkpointWork.length === 0 && !work.checkpointPruneDue) return;

		void this.launchMemoryUpdateTask(ctx, async () => this.runLoop(ctx, trigger));
	}

	async runNow(trigger: MemoryUpdateTrigger, ctx: MemoryUpdateCtx): Promise<void> {
		this.runtime.ensureConfig(ctx.cwd);
		if (this.runtime.config.strategy === STRATEGY.off) return;
		this.lastObserverError = undefined;
		this.lastCheckpointEditorError = undefined;
		await this.runOnce(ctx, trigger);
	}

	async prepareForCompaction(ctx: MemoryUpdateCtx, preparation: { firstKeptEntryId?: string; tokensBefore?: number }): Promise<CompactionPreparation> {
		if (this.compactHookInFlight) {
			const reason = "another compaction is already in progress";
			if (ctx.hasUI) ctx.ui?.notify("Observational memory: another compaction is already in progress; cancelling duplicate", "warning");
			return { kind: "cancel", reason };
		}

		this.compactHookInFlight = true;
		try {
			this.runtime.ensureConfig(ctx.cwd);
			if (this.runtime.config.strategy === STRATEGY.off) return { kind: "noop" };
			const compactionHandoffObservations = await this.ensureObservedBeforeCompaction(ctx, preparation.firstKeptEntryId);
			const checkpointReady = await this.ensureCheckpointedBeforeCompaction(ctx, preparation.firstKeptEntryId);
			if (!checkpointReady) {
				const reason = "checkpoint is not ready for compaction";
				if (ctx.hasUI) ctx.ui?.notify("Observational memory: checkpoint is not ready for compaction", "warning");
				return { kind: "cancel", reason };
			}
			if (this.runtime.config.strategy !== STRATEGY.replacement) return { kind: "noop" };
			const branchEntries = ctx.sessionManager.getBranch() as Entry[];
			const memory = buildCompactionMemory(
				branchEntries,
				{
					compactionHandoffObservationMaxCount: COMPACTION_HANDOFF_OBSERVATION_MAX_COUNT,
					compactionHandoffObservationMaxTokens: COMPACTION_HANDOFF_OBSERVATION_MAX_TOKENS,
				},
				{ compactionHandoffObservations },
			);
			return {
				kind: "ready",
				summary: renderCheckpointSummary(memory.checkpoint),
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
				details: memory.details,
			};
		} finally {
			this.compactHookInFlight = false;
		}
	}

	status(entries: Entry[]): LifecycleHealth {
		const work = computeMemoryStageWork(entries, this.runtime, "turn_end");
		return {
			memoryUpdateInFlight: this.memoryUpdateInFlight,
			memoryUpdatePhase: this.memoryUpdatePhase,
			compactHookInFlight: this.compactHookInFlight,
			lastObserverError: this.lastObserverError,
			lastCheckpointEditorError: this.lastCheckpointEditorError,
			observeGap: work.observerWork.length,
			checkpointGap: work.checkpointWork.length,
			checkpointPruneDue: work.checkpointPruneDue,
		};
	}

	private async launchMemoryUpdateTask(ctx: MemoryUpdateCtx, work: () => Promise<void>): Promise<void> {
		this.memoryUpdateInFlight = true;
		this.memoryUpdatePhase = undefined;
		this.lastObserverError = undefined;
		this.lastCheckpointEditorError = undefined;
		try {
			await work();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (ctx.hasUI) ctx.ui?.notify(`Observational memory: memory update failed: ${message}`, "warning");
		} finally {
			this.memoryUpdateInFlight = false;
			this.memoryUpdatePhase = undefined;
		}
	}

	private async runLoop(ctx: MemoryUpdateCtx, trigger: MemoryUpdateTrigger): Promise<void> {
		const runId = `memory-update-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
		const sessionMetadata = debugSessionMetadata(ctx);
		await withDebugLogContext({
			enabled: this.runtime.config.debugLog === true,
			cwd: ctx.cwd,
			...sessionMetadata,
			runId,
		}, async () => {
			let nextTrigger = trigger;
			while (true) {
				this.memoryUpdateRerunRequested = false;
				await this.runOnce(ctx, nextTrigger);
				if (!this.memoryUpdateRerunRequested) return;
				const nextEntries = ctx.sessionManager.getBranch() as Entry[];
				const nextWork = computeMemoryStageWork(nextEntries, this.runtime, "turn_end");
				if (nextWork.observerWork.length === 0 && nextWork.checkpointWork.length === 0 && !nextWork.checkpointPruneDue) return;
				debugLog("memory_update.rerun", {
					observerRecordsPending: nextWork.observerWork.length,
					checkpointObservationsPending: nextWork.checkpointWork.length,
					checkpointPruneDue: nextWork.checkpointPruneDue,
				});
				nextTrigger = "turn_end";
			}
		});
	}

	private async runOnce(ctx: MemoryUpdateCtx, trigger: MemoryUpdateTrigger): Promise<void> {
		const resolveModel = makeModelResolver(this.runtime, ctx);
		let entries = ctx.sessionManager.getBranch() as Entry[];
		let work = computeMemoryStageWork(entries, this.runtime, trigger);

		if (work.observerWork.length > 0) {
			const observerWork = this.runTrackedStage(ctx, "observer", async () => runObserverStage(this.pi, this.runtime, ctx, resolveModel, work.observerWork));
			const observerPromise = observerWork.then(() => undefined);
			this.inFlightObserverStagePromise = observerPromise;
			let observerOutcome: StageOutcome;
			try {
				observerOutcome = await observerWork;
			} finally {
				if (this.inFlightObserverStagePromise === observerPromise) this.inFlightObserverStagePromise = null;
			}
			if (observerOutcome === "abort") return;
			entries = ctx.sessionManager.getBranch() as Entry[];
			work = computeMemoryStageWork(entries, this.runtime, trigger);
		}

		if (work.checkpointWork.length > 0) {
			const checkpointOutcome = await this.runTrackedStage(ctx, "checkpoint-editor", async () => runCheckpointLifecycle({
				pi: this.pi,
				runtime: this.runtime,
				ctx,
				resolveModel,
				request: { purpose: "update", observations: work.checkpointWork },
			}));
			if (checkpointOutcome === "abort") return;
			entries = ctx.sessionManager.getBranch() as Entry[];
			work = computeMemoryStageWork(entries, this.runtime, trigger);
		}

		if (work.checkpointPruneDue) {
			const pruneOutcome = await this.runTrackedStage(ctx, "checkpoint-editor", async () => runCheckpointLifecycle({
				pi: this.pi,
				runtime: this.runtime,
				ctx,
				resolveModel,
				request: { purpose: "prune", reason: "health" },
			}));
			if (pruneOutcome === "abort") return;
		}
	}

	private async runTrackedStage(ctx: MemoryUpdateCtx, stage: MemoryLifecyclePhase, run: () => Promise<StageOutcome>): Promise<StageOutcome> {
		this.memoryUpdatePhase = stage;
		try {
			return await run();
		} catch (error) {
			const reason = this.recordStageError(ctx, stage, error);
			debugLog(`${stage}.error`, { errorMessage: reason });
			return "abort";
		}
	}

	private recordStageError(ctx: MemoryUpdateCtx, phase: MemoryLifecyclePhase, error: unknown): string {
		const message = error instanceof Error ? error.message : String(error);
		if (phase === "observer") this.lastObserverError = message;
		if (phase === "checkpoint-editor") this.lastCheckpointEditorError = message;
		if (ctx.hasUI) ctx.ui?.notify(`Observational memory: ${phase} failed: ${message}`, "warning");
		return message;
	}

	private async ensureObservedBeforeCompaction(ctx: MemoryUpdateCtx, firstKeptEntryId?: string): Promise<Observation[]> {
		if (this.inFlightObserverStagePromise) await this.inFlightObserverStagePromise;
		const entries = ctx.sessionManager.getBranch() as Entry[];
		const state = buildSessionMemoryState(entries);
		if (!firstKeptEntryId || !state.idToIndex.has(firstKeptEntryId)) return [];
		const sourceEntries = observerSourceEntriesAfterCoverage(state, firstKeptEntryId);
		if (sourceEntries.length === 0) return [];
		const runId = `compaction-observer-flush-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
		const sessionMetadata = debugSessionMetadata(ctx);
		return withDebugLogContext({
			enabled: this.runtime.config.debugLog === true,
			cwd: ctx.cwd,
			...sessionMetadata,
			runId,
		}, async () => this.runCompactionObserverFlush(ctx, sourceEntries));
	}

	private async ensureCheckpointedBeforeCompaction(ctx: MemoryUpdateCtx, firstKeptEntryId?: string): Promise<boolean> {
		if (!firstKeptEntryId) return true;
		let entries = ctx.sessionManager.getBranch() as Entry[];
		let state = buildSessionMemoryState(entries);
		if (!state.idToIndex.has(firstKeptEntryId)) return true;
		let observations = uncheckpointedObservationsBeforeEntry(state, firstKeptEntryId);
		if (observations.length > 0) {
			const outcome = await this.runTrackedStage(ctx, "checkpoint-editor", async () => runCheckpointLifecycle({
				pi: this.pi,
				runtime: this.runtime,
				ctx,
				resolveModel: makeModelResolver(this.runtime, ctx),
				request: { purpose: "update", observations },
			}));
			if (outcome === "abort") return false;
		}

		entries = ctx.sessionManager.getBranch() as Entry[];
		state = buildSessionMemoryState(entries);
		observations = uncheckpointedObservationsBeforeEntry(state, firstKeptEntryId);
		if (observations.length === 0 && !this.checkpointOverHardMax(state)) return true;
		if (!this.checkpointOverHardMax(state)) return observations.length === 0;

		const pruneOutcome = await this.runTrackedStage(ctx, "checkpoint-editor", async () => runCheckpointLifecycle({
			pi: this.pi,
			runtime: this.runtime,
			ctx,
			resolveModel: makeModelResolver(this.runtime, ctx),
			request: { purpose: "prune", reason: "compaction-pressure" },
		}));
		if (pruneOutcome === "abort") return false;

		entries = ctx.sessionManager.getBranch() as Entry[];
		state = buildSessionMemoryState(entries);
		if (this.checkpointOverHardMax(state)) return false;
		observations = uncheckpointedObservationsBeforeEntry(state, firstKeptEntryId);
		if (observations.length === 0) return true;

		const retryOutcome = await this.runTrackedStage(ctx, "checkpoint-editor", async () => runCheckpointLifecycle({
			pi: this.pi,
			runtime: this.runtime,
			ctx,
			resolveModel: makeModelResolver(this.runtime, ctx),
			request: { purpose: "update", observations },
		}));
		if (retryOutcome === "abort") return false;
		const finalState = buildSessionMemoryState(ctx.sessionManager.getBranch() as Entry[]);
		return uncheckpointedObservationsBeforeEntry(finalState, firstKeptEntryId).length === 0 && !this.checkpointOverHardMax(finalState);
	}

	private checkpointOverHardMax(state: ReturnType<typeof buildSessionMemoryState>): boolean {
		const checkpoint = state.folded.checkpoint;
		return !!checkpoint && estimateStringTokens(checkpoint.content) > this.runtime.config.checkpointPruneHardMaxTokens;
	}

	private async runCompactionObserverFlush(ctx: MemoryUpdateCtx, sourceEntries: Entry[]): Promise<Observation[]> {
		try {
			const result = await recordObserverObservations({
				pi: this.pi,
				runtime: this.runtime,
				ctx,
				resolveModel: makeModelResolver(this.runtime, ctx),
				sourceEntries,
				purpose: "compaction-flush",
			});
			return result.observations;
		} catch (error) {
			const reason = this.recordStageError(ctx, "observer", error);
			debugLog("observer.error", { errorMessage: reason });
			return [];
		}
	}
}
