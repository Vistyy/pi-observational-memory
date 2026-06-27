import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckpointEditor = vi.hoisted(() => ({ runCheckpointEditor: vi.fn() }));

vi.mock("../src/agents/checkpoint-editor/agent.js", () => ({ runCheckpointEditor: mockCheckpointEditor.runCheckpointEditor }));

import { EMPTY_CHECKPOINT_MARKDOWN } from "../src/memory/checkpoint.js";
import { runCheckpointLifecycle } from "../src/memory-update/checkpoint-lifecycle.js";
import type { Runtime } from "../src/runtime.js";
import { OM_CHECKPOINT_COVERAGE_ADVANCED, OM_CHECKPOINT_RECORDED, checkpoint, checkpointRecordedEntry, observation, observationsRecordedEntry, rawMessage, type TestEntry } from "./fixtures/session.js";

beforeEach(() => {
	mockCheckpointEditor.runCheckpointEditor.mockReset();
});

function setup(entries: TestEntry[]) {
	let branch = [...entries];
	const appendEntry = vi.fn((customType: string, data: unknown) => {
		const entry = {
			type: "custom",
			id: `appended-${appendEntry.mock.calls.length}`,
			parentId: branch.at(-1)?.id ?? null,
			timestamp: "2026-05-02T10:00:00.000Z",
			customType,
			data,
		};
		branch = [...branch, entry];
		return entry.id;
	});
	const runtime = {
		config: {
			strategy: "replacement",
			debugLog: false,
			agentMaxTurns: 4,
			checkpointEditorThinking: "low",
			model: { provider: "anthropic", id: "memory", thinking: "minimal" },
		},
	} as unknown as Runtime;
	const ctx = {
		cwd: "/tmp/project",
		hasUI: true,
		ui: { notify: vi.fn() },
		model: { provider: "session" },
		modelRegistry: {},
		sessionManager: { getBranch: () => branch },
	} as unknown as ExtensionContext;
	const resolveModel = vi.fn(async () => ({ ok: true as const, model: {}, apiKey: "key" }));
	return {
		pi: { appendEntry } as never,
		runtime,
		ctx,
		resolveModel,
		appends: () => appendEntry.mock.calls.map(([customType, data]) => ({ customType, data })),
	};
}

describe("runCheckpointLifecycle", () => {
	it("records changed update checkpoints", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const content = EMPTY_CHECKPOINT_MARKDOWN.replace("None known.", "Updated objective.");
		mockCheckpointEditor.runCheckpointEditor.mockResolvedValueOnce({ content, reason: "updated", changed: true });
		const env = setup([rawMessage("raw-1", "one"), observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" })]);

		await runCheckpointLifecycle({ pi: env.pi, runtime: env.runtime, ctx: env.ctx as never, resolveModel: env.resolveModel, request: { purpose: "update", observations: [obs] } });

		expect(env.appends()).toEqual([{ customType: OM_CHECKPOINT_RECORDED, data: expect.objectContaining({ mode: "update", coversUpToObservationId: obs.id, observationIds: [obs.id] }) }]);
	});

	it("advances update coverage when content is unchanged", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		mockCheckpointEditor.runCheckpointEditor.mockResolvedValueOnce({ content: EMPTY_CHECKPOINT_MARKDOWN, reason: "already covered", changed: false });
		const env = setup([rawMessage("raw-1", "one"), observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" })]);

		await runCheckpointLifecycle({ pi: env.pi, runtime: env.runtime, ctx: env.ctx as never, resolveModel: env.resolveModel, request: { purpose: "update", observations: [obs] } });

		expect(env.appends()).toEqual([{ customType: OM_CHECKPOINT_COVERAGE_ADVANCED, data: { coversUpToObservationId: obs.id, observationIds: [obs.id], reason: "already covered" } }]);
	});

	it("records nothing for invalid update content", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		mockCheckpointEditor.runCheckpointEditor.mockResolvedValueOnce({ content: "# Invalid", reason: "bad", changed: true });
		const env = setup([rawMessage("raw-1", "one"), observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" })]);

		await runCheckpointLifecycle({ pi: env.pi, runtime: env.runtime, ctx: env.ctx as never, resolveModel: env.resolveModel, request: { purpose: "update", observations: [obs] } });

		expect(env.appends()).toEqual([]);
		expect(env.ctx.ui?.notify).toHaveBeenCalledWith("Observational memory: checkpoint editor produced invalid checkpoint", "warning");
	});

	it("records changed prune checkpoints without advancing coverage", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const check = checkpoint("cccccccccccc");
		const content = check.content.replace("None known.", "Pruned objective.");
		mockCheckpointEditor.runCheckpointEditor.mockResolvedValueOnce({ content, reason: "pruned", changed: true });
		const env = setup([
			rawMessage("raw-1", "one"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			checkpointRecordedEntry("om-check", { checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] }),
		]);

		await runCheckpointLifecycle({ pi: env.pi, runtime: env.runtime, ctx: env.ctx as never, resolveModel: env.resolveModel, request: { purpose: "prune", reason: "health" } });

		expect(env.appends()).toEqual([{ customType: OM_CHECKPOINT_RECORDED, data: expect.objectContaining({ mode: "prune", coversUpToObservationId: obs.id, observationIds: [] }) }]);
	});

	it("records no ledger event for unchanged prune", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const check = checkpoint("cccccccccccc");
		mockCheckpointEditor.runCheckpointEditor.mockResolvedValueOnce({ content: check.content, reason: "already concise", changed: false });
		const env = setup([
			rawMessage("raw-1", "one"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			checkpointRecordedEntry("om-check", { checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] }),
		]);

		await runCheckpointLifecycle({ pi: env.pi, runtime: env.runtime, ctx: env.ctx as never, resolveModel: env.resolveModel, request: { purpose: "prune", reason: "health" } });

		expect(env.appends()).toEqual([]);
	});

	it("does not call the editor for prune without an existing checkpoint", async () => {
		const env = setup([rawMessage("raw-1", "one")]);

		await runCheckpointLifecycle({ pi: env.pi, runtime: env.runtime, ctx: env.ctx as never, resolveModel: env.resolveModel, request: { purpose: "prune", reason: "health" } });

		expect(mockCheckpointEditor.runCheckpointEditor).not.toHaveBeenCalled();
		expect(env.appends()).toEqual([]);
	});

	it("records nothing for invalid prune content", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const check = checkpoint("cccccccccccc");
		mockCheckpointEditor.runCheckpointEditor.mockResolvedValueOnce({ content: "# Invalid", reason: "bad", changed: true });
		const env = setup([
			rawMessage("raw-1", "one"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			checkpointRecordedEntry("om-check", { checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] }),
		]);

		await runCheckpointLifecycle({ pi: env.pi, runtime: env.runtime, ctx: env.ctx as never, resolveModel: env.resolveModel, request: { purpose: "prune", reason: "health" } });

		expect(env.appends()).toEqual([]);
	});
});
