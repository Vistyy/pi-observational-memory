import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgents = vi.hoisted(() => ({
	runObserver: vi.fn(),
	runCheckpointEditor: vi.fn(),
}));

vi.mock("../src/agents/observer/agent.js", () => ({ runObserver: mockAgents.runObserver }));
vi.mock("../src/agents/checkpoint-editor/agent.js", () => ({ runCheckpointEditor: mockAgents.runCheckpointEditor }));

import { ensureCheckpointedBeforeCompaction, ensureObservedBeforeCompaction } from "../src/memory-update/compaction.js";
import { registerMemoryUpdateHook } from "../src/memory-update/scheduler.js";
import { EMPTY_CHECKPOINT_MARKDOWN } from "../src/memory/checkpoint.js";
import type { Runtime } from "../src/runtime.js";
import {
	OM_CHECKPOINT_COVERAGE_ADVANCED,
	OM_CHECKPOINT_RECORDED,
	OM_OBSERVATIONS_RECORDED,
	checkpointCoverageAdvancedEntry,
	observation,
	observationsRecordedEntry,
	rawMessage,
	type TestEntry,
} from "./fixtures/session.js";
import { memoryUpdateApi, type AgentStartHandler, type MessageEndHandler, type TurnEndHandler } from "./fixtures/pi.js";

beforeEach(() => {
	mockAgents.runObserver.mockReset();
	mockAgents.runCheckpointEditor.mockReset();
	mockAgents.runObserver.mockResolvedValue(undefined);
	mockAgents.runCheckpointEditor.mockResolvedValue({
		content: EMPTY_CHECKPOINT_MARKDOWN.replace("None known.", "Updated by test."),
		reason: "test update",
		changed: true,
	});
});

function setup(args: {
	entries: TestEntry[];
	observeEveryMessages?: number;
	observeHardCapRecords?: number;
	maxInitialObserveTokens?: number;
	strategy?: "replacement" | "off";
	memoryUpdateInFlight?: boolean;
	inFlightObserverStagePromise?: Promise<void> | null;
}) {
	let entries = [...args.entries];
	const handlers: { agent_start?: AgentStartHandler; message_end?: MessageEndHandler; turn_end?: TurnEndHandler } = {};
	const appendEntry = vi.fn((customType: string, data: unknown) => {
		const id = `appended-${appendEntry.mock.calls.length}`;
		entries = [...entries, { type: "custom", id, parentId: entries.at(-1)?.id ?? null, timestamp: "2026-05-02T10:00:00.000Z", customType, data }];
		return id;
	});
	const pi = memoryUpdateApi(handlers, appendEntry);
	let launchedWork: (() => Promise<void>) | undefined;
	const runtime = {
		config: {
			strategy: args.strategy ?? "replacement",
			debugLog: false,
			observeEveryMessages: args.observeEveryMessages ?? 1,
			observeHardCapRecords: args.observeHardCapRecords ?? 32,
			maxInitialObserveTokens: args.maxInitialObserveTokens ?? 100_000,
			observerToolResultSummaryMaxLines: 4,
			observerToolResultErrorMaxLines: 20,
			observerToolResultLineMaxChars: 300,
			observerToolOutputPolicies: {},
			agentMaxTurns: 9,
			model: { provider: "anthropic", id: "memory", thinking: "minimal" },
			observerThinking: "minimal",
		},
		memoryUpdateInFlight: args.memoryUpdateInFlight ?? false,
		memoryUpdateRerunRequested: false,
		inFlightObserverStagePromise: args.inFlightObserverStagePromise ?? null,
		memoryUpdatePhase: undefined as "observer" | "checkpoint-editor" | undefined,
		resolveFailureNotified: false,
		lastObserverError: undefined as string | undefined,
		lastCheckpointEditorError: undefined as string | undefined,
		ensureConfig: vi.fn(),
		resolveModel: vi.fn(async () => ({ ok: true, model: { reasoning: true }, apiKey: "key", headers: { h: "v" } })),
		launchMemoryUpdateTask: vi.fn((_ctx, work) => {
			runtime.memoryUpdateInFlight = true;
			launchedWork = work;
			return Promise.resolve();
		}),
		recordMemoryUpdateStageError: vi.fn((ctx, phase: "observer" | "checkpoint-editor", error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			if (phase === "observer") runtime.lastObserverError = message;
			if (phase === "checkpoint-editor") runtime.lastCheckpointEditorError = message;
			ctx.ui?.notify(`Observational memory: ${phase} failed: ${message}`, "warning");
			return message;
		}),
	};
	registerMemoryUpdateHook(pi, runtime as Runtime);
	if (!handlers.agent_start || !handlers.message_end || !handlers.turn_end) throw new Error("memory update handler not registered");
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
		fireAgentStart: () => handlers.agent_start!({ type: "agent_start" } as never, ctx),
		fireMessageEnd: () => handlers.message_end!({ type: "message_end" } as never, ctx),
		fireTurnEnd: () => handlers.turn_end!({ type: "turn_end" } as never, ctx),
		runLaunchedWork: async () => launchedWork?.(),
		getMemoryAppends: () => appendEntry.mock.calls.map(([customType, data]) => ({ customType, data })),
	};
}

describe("memory update hook", () => {
	it("turn_end launches observer only when at least 8 ready records are pending", () => {
		const seven = setup({ entries: Array.from({ length: 7 }, (_, i) => rawMessage(`raw-${i + 1}`, "aaaaaaaa")), observeEveryMessages: 8 });
		seven.fireTurnEnd();
		expect(seven.runtime.launchMemoryUpdateTask).not.toHaveBeenCalled();

		const eight = setup({ entries: Array.from({ length: 8 }, (_, i) => rawMessage(`raw-${i + 1}`, "aaaaaaaa")), observeEveryMessages: 8 });
		eight.fireTurnEnd();
		expect(eight.runtime.launchMemoryUpdateTask).toHaveBeenCalledOnce();
	});

	it("message_end launches observer only at the hard cap", () => {
		const thirtyOne = setup({ entries: Array.from({ length: 31 }, (_, i) => rawMessage(`raw-${i + 1}`, "aaaaaaaa")), observeEveryMessages: 8, observeHardCapRecords: 32 });
		thirtyOne.fireMessageEnd();
		expect(thirtyOne.runtime.launchMemoryUpdateTask).not.toHaveBeenCalled();

		const thirtyTwo = setup({ entries: Array.from({ length: 32 }, (_, i) => rawMessage(`raw-${i + 1}`, "aaaaaaaa")), observeEveryMessages: 8, observeHardCapRecords: 32 });
		thirtyTwo.fireMessageEnd();
		expect(thirtyTwo.runtime.launchMemoryUpdateTask).toHaveBeenCalledOnce();
	});

	it("does not launch when strategy is off or while update is already running", () => {
		const disabled = setup({ entries: [rawMessage("raw-1", "aaaaaaaa")], strategy: "off" });
		disabled.fireTurnEnd();
		expect(disabled.runtime.launchMemoryUpdateTask).not.toHaveBeenCalled();

		const locked = setup({ entries: [rawMessage("raw-1", "aaaaaaaa")], memoryUpdateInFlight: true });
		locked.fireTurnEnd();
		expect(locked.runtime.launchMemoryUpdateTask).not.toHaveBeenCalled();
		expect(locked.runtime.memoryUpdateRerunRequested).toBe(true);
	});

	it("runs observer and then checkpoint update in the same memory update", async () => {
		const obs = observation("cccccccccccc", { sourceEntryIds: ["raw-1"] });
		mockAgents.runObserver.mockResolvedValueOnce([obs]);
		const entries = [rawMessage("raw-1", "aaaaaaaa")];
		const { fireTurnEnd, runLaunchedWork, getMemoryAppends } = setup({ entries });

		fireTurnEnd();
		await runLaunchedWork();

		expect(mockAgents.runObserver).toHaveBeenCalledWith(expect.objectContaining({ allowedSourceEntryIds: ["raw-1"], maxTurns: 9, thinkingLevel: "minimal" }));
		expect(mockAgents.runCheckpointEditor).toHaveBeenCalledWith(expect.objectContaining({ observationsText: expect.stringContaining(obs.id), purpose: "update" }));
		expect(getMemoryAppends()).toEqual([
			{ customType: OM_OBSERVATIONS_RECORDED, data: { observations: [obs], coversUpToId: "raw-1" } },
			expect.objectContaining({ customType: OM_CHECKPOINT_RECORDED }),
		]);
	});

	it("runs checkpoint-only when observations are uncheckpointed", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const { fireTurnEnd, runLaunchedWork } = setup({ entries: [rawMessage("raw-1", "aaaaaaaa"), observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" })], observeEveryMessages: 999 });

		fireTurnEnd();
		await runLaunchedWork();

		expect(mockAgents.runObserver).not.toHaveBeenCalled();
		expect(mockAgents.runCheckpointEditor).toHaveBeenCalledOnce();
	});

	it("does not rerun checkpoint when coverage is current", () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const setupResult = setup({ entries: [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			checkpointCoverageAdvancedEntry("om-check", { coversUpToObservationId: obs.id, observationIds: [obs.id] }),
		], observeEveryMessages: 999 });

		setupResult.fireTurnEnd();

		expect(setupResult.runtime.launchMemoryUpdateTask).not.toHaveBeenCalled();
	});

	it("advances checkpoint coverage when the editor reports no content change", async () => {
		mockAgents.runCheckpointEditor.mockResolvedValueOnce({ content: EMPTY_CHECKPOINT_MARKDOWN, reason: "already covered", changed: false });
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const { fireTurnEnd, runLaunchedWork, getMemoryAppends } = setup({ entries: [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
		], observeEveryMessages: 999 });

		fireTurnEnd();
		await runLaunchedWork();

		expect(getMemoryAppends()).toEqual([
			{ customType: OM_CHECKPOINT_COVERAGE_ADVANCED, data: { coversUpToObservationId: obs.id, observationIds: [obs.id], reason: "already covered" } },
		]);
	});

	it("does not advance checkpoint coverage for invalid editor content", async () => {
		mockAgents.runCheckpointEditor.mockResolvedValueOnce({ content: "# Invalid", reason: "bad draft", changed: true });
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const { ctx, fireTurnEnd, runLaunchedWork, getMemoryAppends } = setup({ entries: [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
		], observeEveryMessages: 999 });

		fireTurnEnd();
		await runLaunchedWork();

		expect(getMemoryAppends()).toEqual([]);
		expect(ctx.ui.notify).toHaveBeenCalledWith("Observational memory: checkpoint editor produced invalid checkpoint", "warning");
	});

	it("does not advance checkpoint coverage when the editor does not finish", async () => {
		mockAgents.runCheckpointEditor.mockResolvedValueOnce(undefined);
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const { ctx, fireTurnEnd, runLaunchedWork, getMemoryAppends } = setup({ entries: [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
		], observeEveryMessages: 999 });

		fireTurnEnd();
		await runLaunchedWork();

		expect(getMemoryAppends()).toEqual([]);
		expect(ctx.ui.notify).toHaveBeenCalledWith("Observational memory: checkpoint editor did not finish", "warning");
	});

	it("records changed checkpoint content with a check id", async () => {
		const content = EMPTY_CHECKPOINT_MARKDOWN.replace("None known.", "Updated by test.");
		mockAgents.runCheckpointEditor.mockResolvedValueOnce({ content, reason: "new handoff", changed: true });
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const { fireTurnEnd, runLaunchedWork, getMemoryAppends } = setup({ entries: [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
		], observeEveryMessages: 999 });

		fireTurnEnd();
		await runLaunchedWork();

		expect(getMemoryAppends()).toEqual([
			{ customType: OM_CHECKPOINT_RECORDED, data: expect.objectContaining({
				checkpoint: expect.objectContaining({ id: expect.stringMatching(/^check_[0-9a-f]{12}$/), content, contentFormat: "markdown" }),
				coversUpToObservationId: obs.id,
				observationIds: [obs.id],
				mode: "update",
			}) },
		]);
	});

	it("skips initial observer backfill when the existing session is too large", async () => {
		const entries = [rawMessage("raw-1", "aaaaaaaa")];
		const { fireTurnEnd, runLaunchedWork, getMemoryAppends, ctx } = setup({ entries, maxInitialObserveTokens: 1 });

		fireTurnEnd();
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

	it("preserves stage failure boundaries", async () => {
		mockAgents.runObserver.mockRejectedValueOnce(new Error("observe failed"));
		const observerFailure = setup({ entries: [rawMessage("raw-1", "aaaaaaaa")] });
		observerFailure.fireTurnEnd();
		await observerFailure.runLaunchedWork();
		expect(observerFailure.runtime.lastObserverError).toBe("observe failed");
		expect(mockAgents.runCheckpointEditor).not.toHaveBeenCalled();

		mockAgents.runObserver.mockReset();
		mockAgents.runObserver.mockResolvedValue(undefined);
		mockAgents.runCheckpointEditor.mockReset();
		mockAgents.runCheckpointEditor.mockRejectedValueOnce(new Error("checkpoint failed"));
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const checkpointFailure = setup({ entries: [rawMessage("raw-1", "aaaaaaaa"), observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" })], observeEveryMessages: 999 });
		checkpointFailure.fireTurnEnd();
		await checkpointFailure.runLaunchedWork();
		expect(checkpointFailure.runtime.lastCheckpointEditorError).toBe("checkpoint failed");
		expect(checkpointFailure.getMemoryAppends()).toEqual([]);
	});
});

describe("compaction observe catch-up", () => {
	it("force-observes unobserved records before the compaction kept tail", async () => {
		const obs = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-1"] });
		mockAgents.runObserver.mockResolvedValueOnce([obs]);
		const entries = [rawMessage("raw-1", "aaaa"), rawMessage("raw-2", "bbbb")];
		const setupResult = setup({ entries, observeEveryMessages: 999 });

		await expect(ensureObservedBeforeCompaction({ appendEntry: vi.fn() } as never, setupResult.runtime as Runtime, setupResult.ctx as never, { firstKeptEntryId: "raw-2" })).resolves.toEqual([obs]);

		expect(mockAgents.runObserver).toHaveBeenCalledOnce();
	});

	it("force-checkpoints uncheckpointed observations before the compaction kept tail", async () => {
		const obs = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-1"] });
		const setupResult = setup({ entries: [
			rawMessage("raw-1", "aaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			rawMessage("raw-2", "bbbb"),
		], observeEveryMessages: 999 });

		await expect(ensureCheckpointedBeforeCompaction(setupResult.pi, setupResult.runtime as Runtime, setupResult.ctx as never, { firstKeptEntryId: "raw-2" })).resolves.toBe(true);

		expect(mockAgents.runCheckpointEditor).toHaveBeenCalledWith(expect.objectContaining({ observationsText: expect.stringContaining(obs.id), purpose: "update" }));
		expect(setupResult.getMemoryAppends()).toEqual([expect.objectContaining({ customType: OM_CHECKPOINT_RECORDED })]);
	});
});
