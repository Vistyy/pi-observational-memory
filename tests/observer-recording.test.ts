import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockObserver = vi.hoisted(() => ({ runObserver: vi.fn() }));

vi.mock("../src/agents/observer/agent.js", () => ({ runObserver: mockObserver.runObserver }));

import { recordObserverObservations } from "../src/memory-update/observer-recording.js";
import type { Runtime } from "../src/runtime.js";
import { OM_OBSERVATIONS_RECORDED, observation, rawMessage, type TestEntry } from "./fixtures/session.js";

beforeEach(() => {
	mockObserver.runObserver.mockReset();
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
			debugLog: false,
			agentMaxTurns: 4,
			maxInitialObserveTokens: 100_000,
			observerToolResultSummaryMaxLines: 4,
			observerToolResultErrorMaxLines: 20,
			observerToolResultLineMaxChars: 300,
			observerToolOutputPolicies: {},
			observerThinking: "low",
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

describe("recordObserverObservations", () => {
	it("records normal observer output and advances coverage", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		mockObserver.runObserver.mockResolvedValueOnce([obs]);
		const env = setup([rawMessage("raw-1", "Remember exact flag --safe.")]);

		const result = await recordObserverObservations({
			pi: env.pi,
			runtime: env.runtime,
			ctx: env.ctx as never,
			resolveModel: env.resolveModel,
			sourceEntries: [rawMessage("raw-1", "Remember exact flag --safe.")],
			purpose: "normal",
		});

		expect(result).toEqual({ outcome: "continue", observations: [obs] });
		expect(mockObserver.runObserver).toHaveBeenCalledWith(expect.objectContaining({ allowedSourceEntryIds: ["raw-1"], thinkingLevel: "low" }));
		expect(env.appends()).toEqual([{ customType: OM_OBSERVATIONS_RECORDED, data: { observations: [obs], coversUpToId: "raw-1" } }]);
	});

	it("uses the same append path for compaction flush", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		mockObserver.runObserver.mockResolvedValueOnce([obs]);
		const env = setup([rawMessage("raw-1", "Compaction evidence.")]);

		await recordObserverObservations({
			pi: env.pi,
			runtime: env.runtime,
			ctx: env.ctx as never,
			resolveModel: env.resolveModel,
			sourceEntries: [rawMessage("raw-1", "Compaction evidence.")],
			purpose: "compaction-flush",
		});

		expect(env.appends()).toEqual([{ customType: OM_OBSERVATIONS_RECORDED, data: { observations: [obs], coversUpToId: "raw-1" } }]);
	});

	it("advances coverage for unrenderable chunks with empty observations", async () => {
		const unrenderable = {
			type: "message",
			id: "tool-1",
			parentId: null,
			timestamp: "2026-05-02T10:00:00.000Z",
			message: { role: "toolResult", toolName: "edit", isError: false, content: [{ type: "text", text: "ok" }] },
		};
		const env = setup([unrenderable]);

		const result = await recordObserverObservations({
			pi: env.pi,
			runtime: env.runtime,
			ctx: env.ctx as never,
			resolveModel: env.resolveModel,
			sourceEntries: [unrenderable],
			purpose: "normal",
		});

		expect(result).toEqual({ outcome: "continue", observations: [] });
		expect(mockObserver.runObserver).not.toHaveBeenCalled();
		expect(env.appends()).toEqual([{ customType: OM_OBSERVATIONS_RECORDED, data: { observations: [], coversUpToId: "tool-1" } }]);
	});

	it("returns abort when no model is available", async () => {
		const env = setup([rawMessage("raw-1", "one")]);
		env.resolveModel.mockResolvedValueOnce(undefined);

		const result = await recordObserverObservations({
			pi: env.pi,
			runtime: env.runtime,
			ctx: env.ctx as never,
			resolveModel: env.resolveModel,
			sourceEntries: [rawMessage("raw-1", "one")],
			purpose: "normal",
		});

		expect(result).toEqual({ outcome: "abort", observations: [] });
		expect(env.appends()).toEqual([]);
	});

	it("propagates observer errors to the lifecycle boundary", async () => {
		mockObserver.runObserver.mockRejectedValueOnce(new Error("observer failed"));
		const env = setup([rawMessage("raw-1", "one")]);

		await expect(recordObserverObservations({
			pi: env.pi,
			runtime: env.runtime,
			ctx: env.ctx as never,
			resolveModel: env.resolveModel,
			sourceEntries: [rawMessage("raw-1", "one")],
			purpose: "normal",
		})).rejects.toThrow("observer failed");
	});
});
