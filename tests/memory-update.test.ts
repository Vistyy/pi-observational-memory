import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgents = vi.hoisted(() => ({
	runObserver: vi.fn(),
	runReflector: vi.fn(),
	runMaintainer: vi.fn(),
	runRewrite: vi.fn(),
}));

vi.mock("../src/agents/observer/agent.js", () => ({ runObserver: mockAgents.runObserver }));
vi.mock("../src/agents/reflector/agent.js", () => ({ runReflector: mockAgents.runReflector }));
vi.mock("../src/agents/maintainer/agent.js", () => ({ runMaintainer: mockAgents.runMaintainer }));
vi.mock("../src/agents/rewrite/agent.js", () => ({ runRewrite: mockAgents.runRewrite }));

import { ensureObservedBeforeCompaction } from "../src/memory-update/compaction.js";
import { registerMemoryUpdateHook } from "../src/memory-update/scheduler.js";
import { Runtime } from "../src/runtime.js";
import {
	OM_OBSERVATIONS_RECORDED,
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_REWRITTEN,
} from "../src/session-ledger/index.js";
import {
	observation,
	observationsRecordedEntry,
	reflection,
	reflectionsRecordedEntry,
	rawMessage,
	type TestEntry,
} from "./fixtures/session.js";
import { memoryUpdateApi, type AgentStartHandler, type TurnEndHandler } from "./fixtures/pi.js";

beforeEach(() => {
	mockAgents.runObserver.mockReset();
	mockAgents.runReflector.mockReset();
	mockAgents.runMaintainer.mockReset();
	mockAgents.runRewrite.mockReset();
	mockAgents.runObserver.mockResolvedValue(undefined);
	mockAgents.runReflector.mockResolvedValue(undefined);
	mockAgents.runMaintainer.mockResolvedValue(undefined);
	mockAgents.runRewrite.mockResolvedValue(undefined);
});

function setup(args: {
	entries: TestEntry[];
	observeEveryMessages?: number;
	reflectEveryObservations?: number;
	reflectionsPoolMaxTokens?: number;
	maintainEveryNewReflections?: number;
	maintainerMaxInputReflections?: number;
	maxInitialObserveTokens?: number;
	strategy?: "replacement" | "off";
	memoryUpdateInFlight?: boolean;
	inFlightObserverStagePromise?: Promise<void> | null;
	appendEntryReturnsId?: boolean;
}) {
	let entries = [...args.entries];
	const handlers: { agent_start?: AgentStartHandler; turn_end?: TurnEndHandler } = {};
	const appendEntry = vi.fn((customType: string, data: unknown) => {
		const id = `appended-${appendEntry.mock.calls.length}`;
		entries = [...entries, { type: "custom", id, parentId: entries.at(-1)?.id ?? null, timestamp: "2026-05-02T10:00:00.000Z", customType, data }];
		return args.appendEntryReturnsId === false ? undefined : id;
	});
	const pi = memoryUpdateApi(handlers, appendEntry);
	let launchedWork: (() => Promise<void>) | undefined;
	const runtime = {
		config: {
			strategy: args.strategy ?? "replacement",
			debugLog: false,
			observeEveryMessages: args.observeEveryMessages ?? 1,
			reflectEveryObservations: args.reflectEveryObservations ?? 1,
			maxInitialObserveTokens: args.maxInitialObserveTokens ?? 100_000,
			reflectionsPoolMaxTokens: args.reflectionsPoolMaxTokens ?? 100,
			maintainEveryNewReflections: args.maintainEveryNewReflections ?? 999,
			maintainerMaxInputReflections: args.maintainerMaxInputReflections ?? 12,
			agentMaxTurns: 9,
			model: { provider: "anthropic", id: "memory", thinking: "minimal" },
		},
		memoryUpdateInFlight: args.memoryUpdateInFlight ?? false,
		inFlightObserverStagePromise: args.inFlightObserverStagePromise ?? null,
		memoryUpdatePhase: undefined as "observer" | "reflector" | "maintainer" | "rewrite" | undefined,
		resolveFailureNotified: false,
		lastObserverError: undefined as string | undefined,
		lastReflectorError: undefined as string | undefined,
		lastMaintainerError: undefined as string | undefined,
		rewriteSkippedActiveIds: undefined as Set<string> | undefined,
		ensureConfig: vi.fn(),
		resolveModel: vi.fn(async () => ({ ok: true, model: { reasoning: true }, apiKey: "key", headers: { h: "v" } })),
		launchMemoryUpdateTask: vi.fn((_ctx, work) => {
			runtime.memoryUpdateInFlight = true;
			launchedWork = work;
			return Promise.resolve();
		}),
		recordMemoryUpdateStageError: vi.fn((ctx, phase: "observer" | "reflector" | "maintainer" | "rewrite", error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			if (phase === "observer") runtime.lastObserverError = message;
			if (phase === "reflector") runtime.lastReflectorError = message;
			if (phase === "maintainer") runtime.lastMaintainerError = message;
			ctx.ui?.notify(`Observational memory: ${phase} failed: ${message}`, "warning");
			return message;
		}),
	};
	registerMemoryUpdateHook(pi, runtime as Runtime);
	if (!handlers.agent_start) throw new Error("agent_start memory update handler not registered");
	if (!handlers.turn_end) throw new Error("turn_end memory update handler not registered");
	const ctx = {
		cwd: "/tmp/project",
		hasUI: true,
		ui: { notify: vi.fn() },
		model: { provider: "session" },
		modelRegistry: {},
		sessionManager: { getBranch: () => entries },
	} as unknown as ExtensionContext;
	return {
		pi,
		runtime,
		ctx,
		fire: (eventName: "agent_start" | "turn_end" = "turn_end") => handlers[eventName]!({ type: eventName } as never, ctx),
		fireAgentStart: () => handlers.agent_start!({ type: "agent_start" } as never, ctx),
		fireTurnEnd: () => handlers.turn_end!({ type: "turn_end" } as never, ctx),
		runLaunchedWork: async () => launchedWork?.(),
		getEntries: () => entries,
		getAppends: () => appendEntry.mock.calls.map(([customType, data]) => ({ customType, data })),
		getMemoryAppends: () => appendEntry.mock.calls
			.map(([customType, data]) => ({ customType, data })),
	};
}

describe("memory update hook", () => {
	const obsA = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });

	it("force-observes unobserved source entries before the compaction kept tail", async () => {
		const obs = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-1"] });
		mockAgents.runObserver.mockResolvedValueOnce([obs]);
		const entries = [rawMessage("raw-1", "aaaa"), rawMessage("raw-2", "bbbb")];
		const { pi, runtime, ctx, getMemoryAppends } = setup({ entries, observeEveryMessages: 999, reflectEveryObservations: 999 });

		await ensureObservedBeforeCompaction(pi as never, runtime as Runtime, ctx as never, { firstKeptEntryId: "raw-2" });

		expect(mockAgents.runObserver).toHaveBeenCalledOnce();
		expect(mockAgents.runReflector).not.toHaveBeenCalled();
		expect(mockAgents.runObserver.mock.calls[0][0].chunk).toContain("[Source entry id: raw-1]");
		expect(mockAgents.runObserver.mock.calls[0][0].chunk).not.toContain("[Source entry id: raw-2]");
		expect(getMemoryAppends()).toEqual([
			expect.objectContaining({ customType: OM_OBSERVATIONS_RECORDED }),
		]);
	});

	it("skips compaction safety observe when compacted source entries are already observed", async () => {
		const obs = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-1"] });
		const entries = [
			rawMessage("raw-1", "aaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			rawMessage("raw-2", "bbbb"),
		];
		const { pi, runtime, ctx, getMemoryAppends } = setup({ entries, observeEveryMessages: 999, reflectEveryObservations: 999 });

		await expect(ensureObservedBeforeCompaction(pi as never, runtime as Runtime, ctx as never, { firstKeptEntryId: "raw-2" })).resolves.toEqual([]);

		expect(mockAgents.runObserver).not.toHaveBeenCalled();
		expect(getMemoryAppends()).toEqual([]);
	});

	it("does not wait for non-observer memory updates before compaction safety observe", async () => {
		const obs = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-1"] });
		mockAgents.runObserver.mockResolvedValueOnce([obs]);
		const entries = [rawMessage("raw-1", "aaaa"), rawMessage("raw-2", "bbbb")];
		const { pi, runtime, ctx } = setup({ entries, memoryUpdateInFlight: true, observeEveryMessages: 999, reflectEveryObservations: 999 });

		await expect(ensureObservedBeforeCompaction(pi as never, runtime as Runtime, ctx as never, { firstKeptEntryId: "raw-2" })).resolves.toEqual([obs]);

		expect(mockAgents.runObserver).toHaveBeenCalledOnce();
	});

	it("waits for an in-flight observer stage before deciding whether compaction safety observe is needed", async () => {
		let releaseObserver!: () => void;
		const inFlightObserverStagePromise = new Promise<void>((resolve) => { releaseObserver = resolve; });
		const entries = [rawMessage("raw-1", "aaaa"), rawMessage("raw-2", "bbbb")];
		const { pi, runtime, ctx } = setup({ entries, inFlightObserverStagePromise, observeEveryMessages: 999, reflectEveryObservations: 999 });

		let completed = false;
		const compaction = ensureObservedBeforeCompaction(pi as never, runtime as Runtime, ctx as never, { firstKeptEntryId: "raw-2" }).then(() => { completed = true; });
		await Promise.resolve();

		expect(completed).toBe(false);
		expect(mockAgents.runObserver).not.toHaveBeenCalled();

		releaseObserver();
		await compaction;

		expect(mockAgents.runObserver).toHaveBeenCalledOnce();
	});
	const obsB = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-2"] });
	const refA = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);

	it("does not launch below all thresholds from either entrypoint", () => {
		const entries = [
			rawMessage("raw-1", "aaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-1" }),
		];
		const { fireAgentStart, fireTurnEnd, runtime } = setup({ entries, observeEveryMessages: 10, reflectEveryObservations: 10 });

		fireAgentStart();
		fireTurnEnd();

		expect(runtime.launchMemoryUpdateTask).not.toHaveBeenCalled();
	});



	it("does not launch from either entrypoint when strategy is off", () => {
		const entries = [rawMessage("raw-1", "aaaaaaaa")];
		const disabled = setup({ entries, strategy: "off" });

		disabled.fireAgentStart();
		disabled.fireTurnEnd();

		expect(disabled.runtime.launchMemoryUpdateTask).not.toHaveBeenCalled();
	});

	it("does not launch from either entrypoint while memory update is already in flight", () => {
		const entries = [rawMessage("raw-1", "aaaaaaaa")];
		const locked = setup({ entries, memoryUpdateInFlight: true });

		locked.fireAgentStart();
		locked.fireTurnEnd();

		expect(locked.runtime.launchMemoryUpdateTask).not.toHaveBeenCalled();
	});

	it("uses the shared lock when agent_start fires before turn_end", () => {
		const entries = [rawMessage("raw-1", "aaaaaaaa")];
		const { fireAgentStart, fireTurnEnd, runtime } = setup({ entries });

		fireAgentStart();
		fireTurnEnd();

		expect(runtime.launchMemoryUpdateTask).toHaveBeenCalledTimes(1);
	});

	it("runs observer first and appends source-addressed observations", async () => {
		const obs = observation("cccccccccccc", { sourceEntryIds: ["raw-1"] });
		mockAgents.runObserver.mockResolvedValueOnce([obs]);
		const entries = [rawMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, pi, runtime } = setup({ entries, reflectEveryObservations: 999 });

		fire();
		await runLaunchedWork();

		expect(runtime.launchMemoryUpdateTask).toHaveBeenCalled();
		expect(mockAgents.runObserver).toHaveBeenCalledWith(expect.objectContaining({
			allowedSourceEntryIds: ["raw-1"],
			maxTurns: 9,
			thinkingLevel: "minimal",
		}));
		expect(mockAgents.runObserver.mock.calls[0][0]).not.toHaveProperty("priorReflections");
		expect(mockAgents.runObserver.mock.calls[0][0]).not.toHaveProperty("priorObservations");
		expect(pi.appendEntry).toHaveBeenCalledWith(OM_OBSERVATIONS_RECORDED, { observations: [obs], coversUpToId: "raw-1" });
	});

	it("uses existing observation coverage and retries larger ranges after no-output", async () => {
		const prior = observation("cccccccccccc", { sourceEntryIds: ["raw-1"] });
		const newObs = observation("dddddddddddd", { sourceEntryIds: ["raw-2"] });
		mockAgents.runObserver.mockResolvedValueOnce([newObs]);
		const entries = [
			rawMessage("raw-1", "aaaa"),
			observationsRecordedEntry("om-prior", { observations: [prior], coversUpToId: "raw-1" }),
			rawMessage("raw-2", "bbbbbbbb"),
			rawMessage("raw-3", "cccccccc"),
		];
		const { fire, runLaunchedWork, pi } = setup({ entries, reflectEveryObservations: 999 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runObserver).toHaveBeenCalledWith(expect.objectContaining({ allowedSourceEntryIds: ["raw-2", "raw-3"] }));
		expect(pi.appendEntry).toHaveBeenCalledWith(OM_OBSERVATIONS_RECORDED, { observations: [newObs], coversUpToId: "raw-3" });
	});

	it("skips initial observer backfill when the existing session is too large", async () => {
		const entries = [rawMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, getMemoryAppends, ctx } = setup({ entries, maxInitialObserveTokens: 1 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runObserver).not.toHaveBeenCalled();
		expect(getMemoryAppends()).toEqual([
			{ customType: OM_OBSERVATIONS_RECORDED, data: { observations: [], coversUpToId: "raw-1" } },
		]);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"Observational memory: skipped initial backfill for large existing session (~2 tokens); observing future turns",
			"warning",
		);
	});

	it("observer no-output appends nothing and does not fake observation coverage", async () => {
		const entries = [rawMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, getMemoryAppends } = setup({ entries });

		fire();
		await runLaunchedWork();

		expect(getMemoryAppends()).toEqual([]);
		expect(mockAgents.runReflector).not.toHaveBeenCalled();
	});

	it("model resolution failure skips appending and notifies once", async () => {
		const entries = [rawMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, getMemoryAppends, runtime, ctx } = setup({ entries });
		runtime.resolveModel.mockResolvedValueOnce({ ok: false, reason: "no model" });

		fire();
		await runLaunchedWork();

		expect(getMemoryAppends()).toEqual([]);
		expect(ctx.ui.notify).toHaveBeenCalledWith("Observational memory: observer skipped — no model", "warning");
	});

	it("re-reads branch so observer append can unblock reflector in the same memory update run", async () => {
		mockAgents.runObserver.mockResolvedValueOnce([obsA]);
		const newRef = reflection("ffffffffffff", ["aaaaaaaaaaaa"]);
		mockAgents.runReflector.mockResolvedValueOnce([newRef]);
		const entries = [rawMessage("raw-1", "aaaaaaaa")];
		const { fire, runLaunchedWork, getMemoryAppends } = setup({ entries });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runObserver).toHaveBeenCalled();
		expect(mockAgents.runReflector).toHaveBeenCalledWith(expect.objectContaining({ observations: [obsA] }));
		expect(getMemoryAppends()).toEqual([
			{ customType: OM_OBSERVATIONS_RECORDED, data: { observations: [obsA], coversUpToId: "raw-1" } },
			{ customType: OM_REFLECTIONS_RECORDED, data: { reflections: [newRef], coversUpToId: "raw-1" } },
		]);
	});

	it("runs reflector-only and appends non-empty reflections", async () => {
		const newRef = reflection("ffffffffffff", ["aaaaaaaaaaaa"]);
		mockAgents.runReflector.mockResolvedValueOnce([newRef]);
		const entries = [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
			rawMessage("raw-2", "bbbbbbbb"),
		];
		const { fire, runLaunchedWork, pi } = setup({ entries, observeEveryMessages: 999 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runReflector).toHaveBeenCalledWith(expect.objectContaining({ observations: [obsA], maxTurns: 9, thinkingLevel: "minimal" }));
		expect(pi.appendEntry).toHaveBeenCalledWith(OM_REFLECTIONS_RECORDED, { reflections: [newRef], coversUpToId: "raw-1" });
	});

	it("passes only unreflected observations to the reflector", async () => {
		const oldRef = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);
		const newRef = reflection("ffffffffffff", ["bbbbbbbbbbbb"]);
		mockAgents.runReflector.mockResolvedValueOnce([newRef]);
		const entries = [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs-old", { observations: [obsA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref-old", { reflections: [oldRef], coversUpToId: "raw-1" }),
			rawMessage("raw-2", "bbbbbbbb"),
			observationsRecordedEntry("om-obs-new", { observations: [obsB], coversUpToId: "raw-2" }),
		];
		const { fire, runLaunchedWork } = setup({ entries, observeEveryMessages: 999, reflectEveryObservations: 1 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runReflector).toHaveBeenCalledWith(expect.objectContaining({
			reflections: [oldRef],
			observations: [obsB],
		}));
	});

	it("passes successful structured file-tool touches from the reflection window", async () => {
		const obsTouched = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-edit"] });
		const newRef = reflection("ffffffffffff", ["aaaaaaaaaaaa"]);
		mockAgents.runReflector.mockResolvedValueOnce([newRef]);
		const editResult = rawMessage("raw-edit", "", {
			message: { role: "toolResult", toolName: "edit", isError: false, path: "src/config.ts", content: [{ type: "text", text: "Successfully replaced 1 block." }] },
		});
		const writeResult = rawMessage("raw-write", "", {
			message: { role: "toolResult", toolName: "write", isError: false, filePath: "docs/notes.md", content: [{ type: "text", text: "Successfully wrote file." }] },
		});
		const failedEdit = rawMessage("raw-failed", "", {
			message: { role: "toolResult", toolName: "edit", isError: true, path: "src/failed.ts", content: [{ type: "text", text: "Failed." }] },
		});
		const entries = [
			editResult,
			writeResult,
			failedEdit,
			observationsRecordedEntry("om-obs", { observations: [obsTouched], coversUpToId: "raw-failed" }),
		];
		const { fire, runLaunchedWork } = setup({ entries, observeEveryMessages: 999, reflectEveryObservations: 1 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runReflector).toHaveBeenCalledWith(expect.objectContaining({
			observations: [obsTouched],
			touchedFiles: ["docs/notes.md", "src/config.ts"],
		}));
	});

	it("does not launch only because the old active observation pool threshold is exceeded", async () => {
		const entries = [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" }),
		];
		const { fire, runLaunchedWork, runtime } = setup({ entries, observeEveryMessages: 999, reflectEveryObservations: 999 });

		fire();
		await runLaunchedWork();

		expect(runtime.launchMemoryUpdateTask).not.toHaveBeenCalled();
	});

	it("runs maintainer after the new-reflection threshold and appends replacements plus retirements", async () => {
		const refB = reflection("ffffffffffff", ["bbbbbbbbbbbb"]);
		const replacement = reflection("999999999999", [refA.id, refB.id], { content: "Merged durable memory." });
		mockAgents.runMaintainer.mockResolvedValueOnce({ retireReflectionIds: [refA.id, refB.id], reflections: [replacement] });
		const entries = [
			rawMessage("raw-1", "aaaaaaaa"),
			reflectionsRecordedEntry("om-ref-a", { reflections: [refA], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref-b", { reflections: [refB], coversUpToId: "raw-1" }),
		];
		const { fire, runLaunchedWork, getMemoryAppends } = setup({ entries, observeEveryMessages: 999, reflectEveryObservations: 999, maintainEveryNewReflections: 2, reflectionsPoolMaxTokens: 999 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runMaintainer).toHaveBeenCalledWith(expect.objectContaining({ reflections: [refA, refB], maxTurns: 9, thinkingLevel: "minimal" }));
		expect(getMemoryAppends()).toEqual([
			{ customType: OM_REFLECTIONS_RECORDED, data: { reflections: [replacement], coversUpToId: "om-ref-b" } },
			{ customType: OM_REFLECTIONS_REWRITTEN, data: { retiredReflectionIds: [refA.id, refB.id] } },
		]);
	});

	it("passes the newest capped active-reflection window to maintainer", async () => {
		const refB = reflection("ffffffffffff", ["bbbbbbbbbbbb"]);
		const refC = reflection("111111111111", ["cccccccccccc"]);
		const entries = [
			rawMessage("raw-1", "aaaaaaaa"),
			reflectionsRecordedEntry("om-ref", { reflections: [refA, refB, refC], coversUpToId: "raw-1" }),
		];
		const { fire, runLaunchedWork } = setup({ entries, observeEveryMessages: 999, reflectEveryObservations: 999, maintainEveryNewReflections: 3, maintainerMaxInputReflections: 2, reflectionsPoolMaxTokens: 999 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runMaintainer).toHaveBeenCalledWith(expect.objectContaining({ reflections: [refB, refC] }));
	});

	it("maintainer no-op appends nothing", async () => {
		mockAgents.runMaintainer.mockResolvedValueOnce({ retireReflectionIds: [], reflections: [] });
		const entries = [
			rawMessage("raw-1", "aaaaaaaa"),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-1" }),
		];
		const { fire, runLaunchedWork, getMemoryAppends } = setup({ entries, observeEveryMessages: 999, reflectEveryObservations: 999, maintainEveryNewReflections: 1, reflectionsPoolMaxTokens: 999 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runMaintainer).toHaveBeenCalledOnce();
		expect(getMemoryAppends()).toEqual([]);
	});

	it("runs rewrite only when emergency replacement gets active reflections under budget", async () => {
		const refs = Array.from({ length: 5 }, (_, index) => reflection(`70000000000${index}`, [`obs_${index}00000000000`], { content: `Verbose reflection ${index} with enough repeated detail to exceed the tiny emergency rewrite budget.` }));
		const replacement = reflection("999999999999", refs.map((ref) => ref.id), { content: "Compact emergency rewrite." });
		mockAgents.runRewrite.mockResolvedValueOnce({ reflections: [replacement], summary: "Emergency compacted." });
		const entries = [
			rawMessage("raw-1", "aaaaaaaa"),
			reflectionsRecordedEntry("om-ref", { reflections: refs, coversUpToId: "raw-1" }),
		];
		const { fire, runLaunchedWork, getMemoryAppends } = setup({ entries, observeEveryMessages: 999, reflectEveryObservations: 999, maintainEveryNewReflections: 999, reflectionsPoolMaxTokens: 20 });

		fire();
		await runLaunchedWork();

		expect(mockAgents.runRewrite).toHaveBeenCalledWith(expect.objectContaining({ reflections: refs, maxTurns: 9, thinkingLevel: "minimal" }));
		expect(getMemoryAppends()).toEqual([
			{ customType: OM_REFLECTIONS_RECORDED, data: { reflections: [replacement], coversUpToId: "om-ref" } },
			{ customType: OM_REFLECTIONS_REWRITTEN, data: { retiredReflectionIds: refs.map((ref) => ref.id), summary: "Emergency compacted." } },
		]);
	});

	it("skips unsafe or ineffective rewrite output", async () => {
		const refs = Array.from({ length: 5 }, (_, index) => reflection(`80000000000${index}`, [`obs_${index}11111111111`], { content: `Verbose reflection ${index} with enough repeated detail to exceed the tiny emergency rewrite budget.` }));
		const unchanged = { ...refs[0]!, sources: [refs[0]!.id] };
		mockAgents.runRewrite.mockResolvedValueOnce({ reflections: [unchanged], summary: "Unsafe unchanged." });
		const entries = [
			rawMessage("raw-1", "aaaaaaaa"),
			reflectionsRecordedEntry("om-ref", { reflections: refs, coversUpToId: "raw-1" }),
		];
		const { fire, runLaunchedWork, getMemoryAppends, runtime } = setup({ entries, observeEveryMessages: 999, reflectEveryObservations: 999, maintainEveryNewReflections: 999, reflectionsPoolMaxTokens: 20 });

		fire();
		await runLaunchedWork();

		expect(getMemoryAppends()).toEqual([]);
		expect(runtime.rewriteSkippedActiveIds).toEqual(new Set(refs.map((ref) => ref.id)));
	});

	it("maintainer failure records stage error and prevents rewrite in the same update", async () => {
		mockAgents.runMaintainer.mockRejectedValueOnce(new Error("maintain failed"));
		const entries = [
			rawMessage("raw-1", "aaaaaaaa"),
			reflectionsRecordedEntry("om-ref", { reflections: [refA], coversUpToId: "raw-1" }),
		];
		const failure = setup({ entries, observeEveryMessages: 999, reflectEveryObservations: 999, maintainEveryNewReflections: 1, reflectionsPoolMaxTokens: 1 });

		failure.fire();
		await failure.runLaunchedWork();

		expect(failure.runtime.lastMaintainerError).toBe("maintain failed");
		expect(mockAgents.runRewrite).not.toHaveBeenCalled();
	});

	it("preserves stage failure boundaries", async () => {
		mockAgents.runObserver.mockRejectedValueOnce(new Error("observe failed"));
		const observerFailure = setup({ entries: [rawMessage("raw-1", "aaaaaaaa")] });
		observerFailure.fire();
		await observerFailure.runLaunchedWork();
		expect(observerFailure.runtime.lastObserverError).toBe("observe failed");
		expect(mockAgents.runReflector).not.toHaveBeenCalled();

		mockAgents.runObserver.mockReset();
		mockAgents.runObserver.mockResolvedValue(undefined);
		mockAgents.runReflector.mockReset();
		mockAgents.runReflector.mockRejectedValueOnce(new Error("reflect failed"));
		const reflectorFailure = setup({ entries: [rawMessage("raw-1", "aaaaaaaa"), observationsRecordedEntry("om-obs", { observations: [obsA], coversUpToId: "raw-1" })], observeEveryMessages: 999 });
		reflectorFailure.fire();
		await reflectorFailure.runLaunchedWork();
		expect(reflectorFailure.runtime.lastReflectorError).toBe("reflect failed");
		expect(reflectorFailure.getMemoryAppends()).toEqual([]);
	});
});
