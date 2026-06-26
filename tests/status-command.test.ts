import { describe, expect, it, vi } from "vitest";

import { registerStatusCommand } from "../src/commands/status.js";
import type { Runtime } from "../src/runtime.js";
import { PI_USAGE_RECORDED } from "../src/usage.js";
import {
	checkpoint,
	checkpointCoverageAdvancedEntry,
	checkpointRecordedEntry,
	observation,
	observationsRecordedEntry,
	textCustomMessage,
	type TestEntry,
} from "./fixtures/session.js";
import { commandApi, commandCtx, type CommandHandler } from "./fixtures/pi.js";

function setup(args: { entries: TestEntry[]; runtime?: Partial<Runtime> }) {
	let handler: CommandHandler | undefined;
	const pi = commandApi((name, command) => {
		expect(name).toBe("om:status");
		handler = command.handler;
	});
	const runtime = {
		ensureConfig: vi.fn(),
		config: {
			strategy: "replacement",
			observeEveryMessages: 8,
			observeHardCapRecords: 32,
			reflectEveryObservations: 20,
			maintainEveryNewReflections: 10,
			reflectionsPoolMaxTokens: 30,
		},
		memoryUpdateInFlight: false,
		memoryUpdatePhase: undefined,
		compactHookInFlight: false,
		lastObserverError: undefined,
		lastCheckpointEditorError: undefined,
		lastReflectorError: undefined,
		lastMaintainerError: undefined,
		lastMaintainerSkip: undefined,
		lastRewriteSkip: undefined,
		...args.runtime,
	};
	registerStatusCommand(pi, runtime as Runtime);
	if (!handler) throw new Error("status handler not registered");
	const notify = vi.fn();
	const ctx = commandCtx({ cwd: "/tmp/project", ui: { notify }, sessionManager: { getBranch: () => args.entries } });
	const run = async (commandArgs = "") => {
		await handler(commandArgs, ctx);
		return notify.mock.calls.at(-1)?.[0] as string;
	};
	return { run, notify };
}

describe("/om:status", () => {
	it("renders concise checkpoint status", async () => {
		const output = await setup({ entries: [] }).run();

		expect(output).toContain("── Checkpoint ──");
		expect(output).toContain("Current:      none");
		expect(output).toContain("Observe gap:    0 source entries");
		expect(output).toContain("Checkpoint gap: 0 observations");
		expect(output).not.toContain("Strategy:");
	});

	it("shows checkpoint coverage and gaps", async () => {
		const obsA = observation("aaaaaaaaaaaa");
		const obsB = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-2"] });
		const check = checkpoint("cccccccccccc");
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			textCustomMessage("raw-2", "bbbbbbbb"),
			observationsRecordedEntry("om-obs", { observations: [obsA, obsB], coversUpToId: "raw-2" }),
			checkpointRecordedEntry("om-check", { checkpoint: check, coversUpToObservationId: obsA.id, observationIds: [obsA.id] }),
		];

		const output = await setup({ entries }).run();

		expect(output).toContain("Current:      check_cccccccccccc");
		expect(output).toContain(`Coverage:     ${obsA.id}`);
		expect(output).toContain("Checkpoint gap: 1 observations");
	});

	it("shows full details on request", async () => {
		const obs = observation("aaaaaaaaaaaa");
		const check = checkpoint("cccccccccccc");
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			checkpointRecordedEntry("om-check", { checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] }),
			checkpointCoverageAdvancedEntry("om-check-coverage", { coversUpToObservationId: obs.id, observationIds: [obs.id] }),
		];

		const output = await setup({ entries }).run("full");

		expect(output).toContain("── Details ──");
		expect(output).toContain("Strategy: replacement");
		expect(output).toContain("Ledger observations: 1 recorded");
		expect(output).toContain("Checkpoint versions: 1 recorded");
	});

	it("shows usage totals in full mode", async () => {
		const usageEntry: TestEntry = {
			type: "custom",
			id: "usage-1",
			parentId: null,
			timestamp: "2026-05-02T10:00:00.000Z",
			customType: PI_USAGE_RECORDED,
			data: {
				schemaVersion: 1,
				source: "extension",
				extension: "observational-memory",
				agent: "checkpoint-editor",
				usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 0, totalTokens: 125, cost: 0.0123 },
			},
		};

		const output = await setup({ entries: [usageEntry] }).run("full");

		expect(output).toContain("── Usage ──");
		expect(output).toContain("Total: ~125 tokens, $0.0123");
		expect(output).toContain("checkpoint-editor: ~125 tokens, $0.0123");
	});

	it("rejects unsupported status arguments", async () => {
		const output = await setup({ entries: [] }).run("debug");

		expect(output).toBe("Usage: /om:status [full]");
	});

	it("shows disabled config, in-flight state, and stage-specific last errors", async () => {
		const output = await setup({
			entries: [],
			runtime: {
				config: { strategy: "off", observeEveryMessages: 8, observeHardCapRecords: 32, reflectEveryObservations: 20, maintainEveryNewReflections: 10, reflectionsPoolMaxTokens: 30 },
				memoryUpdateInFlight: true,
				memoryUpdatePhase: "checkpoint-editor",
				compactHookInFlight: true,
				lastObserverError: "observer failed",
				lastCheckpointEditorError: "checkpoint failed",
			},
		}).run("full");

		expect(output).toContain("Strategy: off");
		expect(output).toContain("Memory update: running (checkpoint-editor)");
		expect(output).toContain("Compaction hook: running");
		expect(output).toContain("Observer: observer failed");
		expect(output).toContain("CheckpointEditor: checkpoint failed");
	});
});
