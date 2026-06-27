import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgents = vi.hoisted(() => ({
	runObserver: vi.fn(),
	runCheckpointEditor: vi.fn(),
}));

vi.mock("../src/agents/observer/agent.js", () => ({ runObserver: mockAgents.runObserver }));
vi.mock("../src/agents/checkpoint-editor/agent.js", () => ({ runCheckpointEditor: mockAgents.runCheckpointEditor }));

import { EMPTY_CHECKPOINT_MARKDOWN } from "../src/memory/checkpoint.js";
import { MemoryLifecycle } from "../src/memory-update/lifecycle.js";
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
import { registerMemoryUpdateHook } from "../src/hooks/memory-update-hook.js";

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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function tick(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(args: {
	entries: TestEntry[];
	observeEveryMessages?: number;
	observeHardCapRecords?: number;
	maxInitialObserveTokens?: number;
	strategy?: "replacement" | "off";
}) {
	let entries = [...args.entries];
	const appendEntry = vi.fn((customType: string, data: unknown) => {
		const id = `appended-${appendEntry.mock.calls.length}`;
		entries = [...entries, { type: "custom", id, parentId: entries.at(-1)?.id ?? null, timestamp: "2026-05-02T10:00:00.000Z", customType, data }];
		return id;
	});
	const pi = { appendEntry } as never;
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
		resolveFailureNotified: false,
		ensureConfig: vi.fn(),
		resolveModel: vi.fn(async () => ({ ok: true, model: { reasoning: true }, apiKey: "key", headers: { h: "v" } })),
	};
	const lifecycle = new MemoryLifecycle(pi, runtime as Runtime);
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
		lifecycle,
		ctx,
		setEntries: (next: TestEntry[]) => {
			entries = next;
		},
		getEntries: () => entries,
		getMemoryAppends: () => appendEntry.mock.calls.map(([customType, data]) => ({ customType, data })),
	};
}

describe("MemoryLifecycle", () => {
	it("turn_end observes only when at least 8 ready records are pending", async () => {
		const seven = setup({ entries: Array.from({ length: 7 }, (_, i) => rawMessage(`raw-${i + 1}`, "aaaaaaaa")), observeEveryMessages: 8 });
		await seven.lifecycle.runNow("turn_end", seven.ctx as never);
		expect(mockAgents.runObserver).not.toHaveBeenCalled();

		const eight = setup({ entries: Array.from({ length: 8 }, (_, i) => rawMessage(`raw-${i + 1}`, "aaaaaaaa")), observeEveryMessages: 8 });
		await eight.lifecycle.runNow("turn_end", eight.ctx as never);
		expect(mockAgents.runObserver).toHaveBeenCalledOnce();
	});

	it("message_end observes only at the hard cap", async () => {
		const thirtyOne = setup({ entries: Array.from({ length: 31 }, (_, i) => rawMessage(`raw-${i + 1}`, "aaaaaaaa")), observeEveryMessages: 8, observeHardCapRecords: 32 });
		await thirtyOne.lifecycle.runNow("message_end", thirtyOne.ctx as never);
		expect(mockAgents.runObserver).not.toHaveBeenCalled();

		const thirtyTwo = setup({ entries: Array.from({ length: 32 }, (_, i) => rawMessage(`raw-${i + 1}`, "aaaaaaaa")), observeEveryMessages: 8, observeHardCapRecords: 32 });
		await thirtyTwo.lifecycle.runNow("message_end", thirtyTwo.ctx as never);
		expect(mockAgents.runObserver).toHaveBeenCalledOnce();
	});

	it("does no work when strategy is off", async () => {
		const disabled = setup({ entries: [rawMessage("raw-1", "aaaaaaaa")], strategy: "off" });

		await disabled.lifecycle.runNow("turn_end", disabled.ctx as never);
		disabled.lifecycle.handleTrigger("turn_end", disabled.ctx as never);

		expect(mockAgents.runObserver).not.toHaveBeenCalled();
		expect(disabled.lifecycle.status(disabled.getEntries() as never).memoryUpdateInFlight).toBe(false);
	});

	it("reruns immediately when work arrives while an update is in flight", async () => {
		const first = deferred<unknown[]>();
		mockAgents.runObserver.mockReturnValueOnce(first.promise).mockResolvedValueOnce([]);
		const setupResult = setup({ entries: [rawMessage("raw-1", "aaaaaaaa")], observeEveryMessages: 1 });

		setupResult.lifecycle.handleTrigger("turn_end", setupResult.ctx as never);
		expect(setupResult.lifecycle.status(setupResult.getEntries() as never).memoryUpdateInFlight).toBe(true);
		setupResult.setEntries([...setupResult.getEntries(), rawMessage("raw-2", "bbbbbbbb")]);
		setupResult.lifecycle.handleTrigger("turn_end", setupResult.ctx as never);

		first.resolve([]);
		await tick();
		await tick();

		expect(mockAgents.runObserver).toHaveBeenCalledTimes(2);
	});

	it("runs observer and then checkpoint update in the same update", async () => {
		const obs = observation("cccccccccccc", { sourceEntryIds: ["raw-1"] });
		mockAgents.runObserver.mockResolvedValueOnce([obs]);
		const setupResult = setup({ entries: [rawMessage("raw-1", "aaaaaaaa")] });

		await setupResult.lifecycle.runNow("turn_end", setupResult.ctx as never);

		expect(mockAgents.runObserver).toHaveBeenCalledWith(expect.objectContaining({ allowedSourceEntryIds: ["raw-1"], maxTurns: 9, thinkingLevel: "minimal" }));
		expect(mockAgents.runCheckpointEditor).toHaveBeenCalledWith(expect.objectContaining({ observationsText: expect.stringContaining(obs.id), purpose: "update" }));
		expect(setupResult.getMemoryAppends()).toEqual([
			{ customType: OM_OBSERVATIONS_RECORDED, data: { observations: [obs], coversUpToId: "raw-1" } },
			expect.objectContaining({ customType: OM_CHECKPOINT_RECORDED }),
		]);
	});

	it("runs checkpoint-only when observations are uncheckpointed", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const setupResult = setup({ entries: [rawMessage("raw-1", "aaaaaaaa"), observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" })], observeEveryMessages: 999 });

		await setupResult.lifecycle.runNow("turn_end", setupResult.ctx as never);

		expect(mockAgents.runObserver).not.toHaveBeenCalled();
		expect(mockAgents.runCheckpointEditor).toHaveBeenCalledOnce();
	});

	it("does no work when checkpoint coverage is current", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const setupResult = setup({ entries: [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			checkpointCoverageAdvancedEntry("om-check", { coversUpToObservationId: obs.id, observationIds: [obs.id] }),
		], observeEveryMessages: 999 });

		await setupResult.lifecycle.runNow("turn_end", setupResult.ctx as never);

		expect(mockAgents.runObserver).not.toHaveBeenCalled();
		expect(mockAgents.runCheckpointEditor).not.toHaveBeenCalled();
	});

	it("advances checkpoint coverage when the editor reports no content change", async () => {
		mockAgents.runCheckpointEditor.mockResolvedValueOnce({ content: EMPTY_CHECKPOINT_MARKDOWN, reason: "already covered", changed: false });
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const setupResult = setup({ entries: [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
		], observeEveryMessages: 999 });

		await setupResult.lifecycle.runNow("turn_end", setupResult.ctx as never);

		expect(setupResult.getMemoryAppends()).toEqual([
			{ customType: OM_CHECKPOINT_COVERAGE_ADVANCED, data: { coversUpToObservationId: obs.id, observationIds: [obs.id], reason: "already covered" } },
		]);
	});

	it("does not advance checkpoint coverage for invalid editor content", async () => {
		mockAgents.runCheckpointEditor.mockResolvedValueOnce({ content: "# Invalid", reason: "bad draft", changed: true });
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const setupResult = setup({ entries: [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
		], observeEveryMessages: 999 });

		await setupResult.lifecycle.runNow("turn_end", setupResult.ctx as never);

		expect(setupResult.getMemoryAppends()).toEqual([]);
		expect(setupResult.ctx.ui.notify).toHaveBeenCalledWith("Observational memory: checkpoint editor produced invalid checkpoint", "warning");
	});

	it("does not advance checkpoint coverage when the editor does not finish", async () => {
		mockAgents.runCheckpointEditor.mockResolvedValueOnce(undefined);
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const setupResult = setup({ entries: [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
		], observeEveryMessages: 999 });

		await setupResult.lifecycle.runNow("turn_end", setupResult.ctx as never);

		expect(setupResult.getMemoryAppends()).toEqual([]);
		expect(setupResult.ctx.ui.notify).toHaveBeenCalledWith("Observational memory: checkpoint editor did not finish", "warning");
	});

	it("records changed checkpoint content with a check id", async () => {
		const content = EMPTY_CHECKPOINT_MARKDOWN.replace("None known.", "Updated by test.");
		mockAgents.runCheckpointEditor.mockResolvedValueOnce({ content, reason: "new handoff", changed: true });
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const setupResult = setup({ entries: [
			rawMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
		], observeEveryMessages: 999 });

		await setupResult.lifecycle.runNow("turn_end", setupResult.ctx as never);

		expect(setupResult.getMemoryAppends()).toEqual([
			{ customType: OM_CHECKPOINT_RECORDED, data: expect.objectContaining({
				checkpoint: expect.objectContaining({ id: expect.stringMatching(/^check_[0-9a-f]{12}$/), content, contentFormat: "markdown" }),
				coversUpToObservationId: obs.id,
				observationIds: [obs.id],
				mode: "update",
			}) },
		]);
	});

	it("skips initial observer backfill when the existing session is too large", async () => {
		const setupResult = setup({ entries: [rawMessage("raw-1", "aaaaaaaa")], maxInitialObserveTokens: 1 });

		await setupResult.lifecycle.runNow("turn_end", setupResult.ctx as never);

		expect(mockAgents.runObserver).not.toHaveBeenCalled();
		expect(setupResult.getMemoryAppends()).toEqual([
			{ customType: OM_OBSERVATIONS_RECORDED, data: { observations: [], coversUpToId: "raw-1" } },
		]);
		expect(setupResult.ctx.ui.notify).toHaveBeenCalledWith(
			"Observational memory: skipped initial backfill for large existing session (~2 tokens); observing future turns",
			"warning",
		);
	});

	it("preserves stage failure boundaries", async () => {
		mockAgents.runObserver.mockRejectedValueOnce(new Error("observe failed"));
		const observerFailure = setup({ entries: [rawMessage("raw-1", "aaaaaaaa")] });
		await observerFailure.lifecycle.runNow("turn_end", observerFailure.ctx as never);
		expect(observerFailure.lifecycle.status(observerFailure.getEntries() as never).lastObserverError).toBe("observe failed");
		expect(mockAgents.runCheckpointEditor).not.toHaveBeenCalled();

		mockAgents.runObserver.mockReset();
		mockAgents.runObserver.mockResolvedValue(undefined);
		mockAgents.runCheckpointEditor.mockReset();
		mockAgents.runCheckpointEditor.mockRejectedValueOnce(new Error("checkpoint failed"));
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const checkpointFailure = setup({ entries: [rawMessage("raw-1", "aaaaaaaa"), observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" })], observeEveryMessages: 999 });
		await checkpointFailure.lifecycle.runNow("turn_end", checkpointFailure.ctx as never);
		expect(checkpointFailure.lifecycle.status(checkpointFailure.getEntries() as never).lastCheckpointEditorError).toBe("checkpoint failed");
		expect(checkpointFailure.getMemoryAppends()).toEqual([]);
	});

	it("prepares compaction by observing and checkpointing work before the kept tail", async () => {
		const obs = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-1"] });
		mockAgents.runObserver.mockResolvedValueOnce([obs]);
		const setupResult = setup({ entries: [rawMessage("raw-1", "aaaa"), rawMessage("raw-2", "bbbb")], observeEveryMessages: 999 });

		const result = await setupResult.lifecycle.prepareForCompaction(setupResult.ctx as never, { firstKeptEntryId: "raw-2", tokensBefore: 123 });

		expect(result).toEqual(expect.objectContaining({ kind: "ready", firstKeptEntryId: "raw-2", tokensBefore: 123, summary: expect.stringContaining("# Checkpoint"), details: expect.objectContaining({ type: "om.checkpoint" }) }));
		expect(mockAgents.runObserver).toHaveBeenCalledOnce();
		expect(mockAgents.runCheckpointEditor).toHaveBeenCalledWith(expect.objectContaining({ observationsText: expect.stringContaining(obs.id), purpose: "update" }));
	});

	it("cancels compaction when checkpoint catch-up fails", async () => {
		mockAgents.runCheckpointEditor.mockRejectedValueOnce(new Error("checkpoint failed"));
		const obs = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-1"] });
		const setupResult = setup({ entries: [
			rawMessage("raw-1", "aaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			rawMessage("raw-2", "bbbb"),
		], observeEveryMessages: 999 });

		const result = await setupResult.lifecycle.prepareForCompaction(setupResult.ctx as never, { firstKeptEntryId: "raw-2" });

		expect(result).toEqual({ kind: "cancel", reason: "checkpoint is not ready for compaction" });
	});

	it("does not participate in compaction when strategy is off", async () => {
		const setupResult = setup({ entries: [rawMessage("raw-1", "aaaa")], strategy: "off" });

		await expect(setupResult.lifecycle.prepareForCompaction(setupResult.ctx as never, { firstKeptEntryId: "raw-1" })).resolves.toEqual({ kind: "noop" });
	});
});

describe("memory update hook adapter", () => {
	it("maps Pi events to lifecycle triggers", () => {
		const handlers: { agent_start?: AgentStartHandler; message_end?: MessageEndHandler; turn_end?: TurnEndHandler } = {};
		const pi = memoryUpdateApi(handlers);
		const lifecycle = { handleTrigger: vi.fn() } as unknown as MemoryLifecycle;
		const ctx = { cwd: "/tmp/project" } as never;

		registerMemoryUpdateHook(pi, lifecycle);
		handlers.agent_start!({ type: "agent_start" } as never, ctx);
		handlers.message_end!({ type: "message_end" } as never, ctx);
		handlers.turn_end!({ type: "turn_end" } as never, ctx);

		expect(lifecycle.handleTrigger).toHaveBeenNthCalledWith(1, "agent_start", ctx);
		expect(lifecycle.handleTrigger).toHaveBeenNthCalledWith(2, "message_end", ctx);
		expect(lifecycle.handleTrigger).toHaveBeenNthCalledWith(3, "turn_end", ctx);
	});
});
