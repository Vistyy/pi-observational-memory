import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runObserver } from "../agents/observer/agent.js";
import { STRATEGY } from "../config.js";
import { debugLog, debugSessionMetadata, withDebugLogContext } from "../debug-log.js";
import { serializeObserverSourceEntries } from "../memory/serialization/observer.js";
import type { Runtime } from "../runtime.js";
import {
	OM_OBSERVATIONS_RECORDED,
	buildCompactionMemory,
	buildObservationsRecordedData,
	entryIndexById,
	foldLedger,
	renderCheckpointSummary,
	sourceEntriesAfterIndex,
	type CheckpointMemoryDetails,
	type Entry,
	type Observation,
} from "../session-ledger/index.js";
import { commonAgentArgs } from "./agent-args.js";
import { runCheckpointStage } from "./checkpoint-stage.js";
import { computeMemoryStageWork, type MemoryUpdateTrigger } from "./due.js";
import { makeModelResolver } from "./model-resolver.js";
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
		if (work.observerWork.length === 0 && work.checkpointWork.length === 0) return;

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
				if (nextWork.observerWork.length === 0 && nextWork.checkpointWork.length === 0) return;
				debugLog("memory_update.rerun", {
					observerRecordsPending: nextWork.observerWork.length,
					checkpointObservationsPending: nextWork.checkpointWork.length,
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
			const checkpointOutcome = await this.runTrackedStage(ctx, "checkpoint-editor", async () => runCheckpointStage(this.pi, this.runtime, ctx, resolveModel, work.checkpointWork));
			if (checkpointOutcome === "abort") return;
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
		const firstKeptIndex = entryIndexById(entries).get(firstKeptEntryId ?? "");
		if (firstKeptIndex === undefined) return [];
		const folded = foldLedger(entries);
		const sourceEntries = sourceEntriesAfterIndex(entries, folded.lastObservationCoverageIndex, firstKeptIndex);
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
		const entries = ctx.sessionManager.getBranch() as Entry[];
		const firstKeptIndex = entryIndexById(entries).get(firstKeptEntryId ?? "");
		if (firstKeptIndex === undefined) return true;
		const observations = this.uncheckpointedObservationsBeforeIndex(entries, firstKeptIndex);
		if (observations.length === 0) return true;
		const outcome = await this.runTrackedStage(ctx, "checkpoint-editor", async () => runCheckpointStage(this.pi, this.runtime, ctx, makeModelResolver(this.runtime, ctx), observations));
		if (outcome === "abort") return false;
		const nextEntries = ctx.sessionManager.getBranch() as Entry[];
		return this.uncheckpointedObservationsBeforeIndex(nextEntries, firstKeptIndex).length === 0;
	}

	private uncheckpointedObservationsBeforeIndex(entries: Entry[], firstKeptIndex: number): Observation[] {
		const folded = foldLedger(entries);
		const idToIndex = entryIndexById(entries);
		return folded.uncheckpointedObservations.filter((observation) => observation.sourceEntryIds.some((sourceEntryId) => {
			const sourceIndex = idToIndex.get(sourceEntryId);
			return sourceIndex === undefined || sourceIndex < firstKeptIndex;
		}));
	}

	private async runCompactionObserverFlush(ctx: MemoryUpdateCtx, sourceEntries: Entry[]): Promise<Observation[]> {
		try {
			const coversUpToId = sourceEntries.at(-1)?.id;
			if (!coversUpToId) return [];
			const { text: chunk, sourceEntryIds } = serializeObserverSourceEntries(sourceEntries, {
				toolResultSummaryMaxLines: this.runtime.config.observerToolResultSummaryMaxLines,
				toolResultErrorMaxLines: this.runtime.config.observerToolResultErrorMaxLines,
				toolResultLineMaxChars: this.runtime.config.observerToolResultLineMaxChars,
				toolOutputPolicies: this.runtime.config.observerToolOutputPolicies,
			});
			if (!chunk.trim() || sourceEntryIds.length === 0) {
				const data = buildObservationsRecordedData([], coversUpToId);
				if (data) this.pi.appendEntry(OM_OBSERVATIONS_RECORDED, data);
				debugLog("observer.compaction_flush_unrenderable", { coversUpToId });
				return [];
			}

			const resolved = await makeModelResolver(this.runtime, ctx)("observer");
			if (!resolved) return [];
			const observations = await runObserver({
				...commonAgentArgs(this.pi, this.runtime, resolved, this.runtime.config.observerThinking, "compaction-flush"),
				chunk,
				allowedSourceEntryIds: sourceEntryIds,
			});
			if (!observations) return [];
			const data = buildObservationsRecordedData(observations, coversUpToId);
			if (!data) return [];
			this.pi.appendEntry(OM_OBSERVATIONS_RECORDED, data);
			return data.observations;
		} catch (error) {
			const reason = this.recordStageError(ctx, "observer", error);
			debugLog("observer.error", { errorMessage: reason });
			return [];
		}
	}
}
