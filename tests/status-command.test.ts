import { describe, expect, it, vi } from "vitest";

import { registerStatusCommand } from "../src/commands/status.js";
import type { Runtime } from "../src/runtime.js";
import { PI_USAGE_RECORDED } from "../src/usage.js";
import {
	compactionEntry,
	memoryDetails,
	observation,
	observationsRecordedEntry,
	reflection,
	reflectionsRecordedEntry,
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
			observeEveryMessages: 10,
			reflectEveryObservations: 20,
			maintainEveryNewReflections: 10,
			reflectionsPoolMaxTokens: 30,
		},
		memoryUpdateInFlight: false,
		memoryUpdatePhase: undefined,
		compactHookInFlight: false,
		lastObserverError: undefined,
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
	it("renders concise default status", async () => {
		const output = await setup({ entries: [] }).run();

		expect(output).toContain("── Memory ──");
		expect(output).toContain("Context:      0 reflections");
		expect(output).not.toContain("Next context:");
		expect(output).toContain("Size:         ~0 context tokens; active reflections ~0 / 30 budget tokens");
		expect(output).toContain("Observe: 0 / 10 source entries");
		expect(output).toContain("Reflect: 0 / 20 observations");
		expect(output).toContain("Maintain: 0 / 10 new reflections");
		expect(output).toContain("Rewrite: ~0 / 30 active-reflection tokens");
		expect(output).not.toContain("Strategy:");
	});

	it("shows context and progress clocks", async () => {
		const obs = observation("aaaaaaaaaaaa");
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [ref], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "bbbbbbbb"),
			compactionEntry("cmp", { firstKeptEntryId: "raw-2", details: memoryDetails({ reflections: [ref] }) }),
		];

		const output = await setup({ entries }).run();

		expect(output).toContain("Context:      1 reflections");
		expect(output).not.toContain("Next context:");
		expect(output).toContain("Observe: 2 / 10 source entries");
		expect(output).toContain("Reflect: 0 / 20 observations");
		expect(output).toContain("Maintain: 1 / 10 new reflections");
		expect(output).toContain("Rewrite: ~");
	});

	it("shows full details on request", async () => {
		const obs = observation("aaaaaaaaaaaa");
		const entries = [
			textCustomMessage("raw-1", "aaaaaaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
		];

		const output = await setup({ entries }).run("full");

		expect(output).toContain("── Details ──");
		expect(output).toContain("Strategy: replacement");
		expect(output).toContain("Ledger observations: 1 recorded");
		expect(output).toContain("Source entries since reflection cursor: 1");
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
				agent: "reflector",
				usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 0, totalTokens: 125, cost: 0.0123 },
			},
		};

		const output = await setup({ entries: [usageEntry] }).run("full");

		expect(output).toContain("── Usage ──");
		expect(output).toContain("Total: ~125 tokens, $0.0123");
		expect(output).toContain("reflector: ~125 tokens, $0.0123");
	});

	it("shows last maintainer and rewrite skips", async () => {
		const output = await setup({
			entries: [],
			runtime: {
				lastMaintainerSkip: { reason: "no_op", reflectionCount: 10 },
				lastRewriteSkip: { reason: "unchanged_after_noop", reflectionCount: 12, activeTokens: 96, maxTokens: 30, resultTokens: 88 },
			},
		}).run();

		expect(output).toContain("── Last skip ──");
		expect(output).toContain("Maintainer: no_op (10 reflections)");
		expect(output).toContain("Rewrite: unchanged_after_noop (12 reflections, ~96 active tokens, 30 budget, result ~88 tokens)");
	});

	it("rejects unsupported status arguments", async () => {
		const output = await setup({ entries: [] }).run("debug");

		expect(output).toBe("Usage: /om:status [full]");
	});

	it("shows disabled config in full mode, memory update in flight, compaction hook in flight, and stage-specific last errors", async () => {
		const output = await setup({
			entries: [],
			runtime: {
				config: { strategy: "off", observeEveryMessages: 10, reflectEveryObservations: 20, maintainEveryNewReflections: 10, reflectionsPoolMaxTokens: 30 },
				memoryUpdateInFlight: true,
				memoryUpdatePhase: "reflector",
				compactHookInFlight: true,
				lastObserverError: "observer failed",
				lastReflectorError: "reflect failed",
				lastMaintainerError: "maintainer failed",
			},
		}).run("full");

		expect(output).toContain("Strategy: off");
		expect(output).toContain("Memory update: running (reflector)");
		expect(output).toContain("Compaction hook: running");
		expect(output).toContain("Observer: observer failed");
		expect(output).toContain("Reflector: reflect failed");
		expect(output).toContain("Maintainer: maintainer failed");
	});

	it("shows memory update in flight without phase when phase is unavailable", async () => {
		const output = await setup({ entries: [], runtime: { memoryUpdateInFlight: true } }).run();

		expect(output).toContain("Memory update: running");
		expect(output).not.toContain("Memory update: running (");
	});
});
