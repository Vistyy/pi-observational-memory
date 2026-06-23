import { describe, expect, it, vi } from "vitest";

import { registerViewCommand } from "../src/commands/view.js";
import type { Runtime } from "../src/runtime.js";
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

function setup(entries: TestEntry[]) {
	let handler: CommandHandler | undefined;
	const pi = commandApi((name, command) => {
		expect(name).toBe("om:view");
		handler = command.handler;
	});
	const runtime = { ensureConfig: vi.fn() } as Pick<Runtime, "ensureConfig">;
	registerViewCommand(pi, runtime as Runtime);
	if (!handler) throw new Error("view handler not registered");
	const notify = vi.fn();
	const ctx = commandCtx({ cwd: "/tmp/project", ui: { notify }, sessionManager: { getBranch: () => entries } });
	const run = async (args = "") => {
		await handler(args, ctx);
		return { output: notify.mock.calls.at(-1)?.[0] as string };
	};
	return { run, notify };
}

describe("/om:view", () => {
	it("renders no-memory context output as content-only sections", async () => {
		const { output } = await setup([]).run();
		const expected = [
			"── Reflections ──",
			"No context reflections.",
			"",
			"── Observations ──",
			"No context observations.",
		].join("\n");

		expect(output).toBe(expected);
	});

	it("default view renders latest context om.folded memory content only", async () => {
		const obs = observation("aaaaaaaaaaaa");
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("om-obs", { observations: [observation("bbbbbbbbbbbb")], coversUpToId: "raw-1" }),
			compactionEntry("cmp", { firstKeptEntryId: "raw-1", details: memoryDetails({ reflections: [ref] }) }),
		];

		const { output } = await setup(entries).run();

		expect(output).toContain("── Reflections ──");
		expect(output).toContain("[ref_eeeeeeeeeeee] Reflection eeeeeeeeeeee");
		expect(output).toContain("── Observations ──");
		expect(output).toContain("No context observations.");
		expect(output).not.toContain("obs_bbbbbbbbbbbb");
	});

	it("recorded view renders recorded empty states", async () => {
		const { output } = await setup([]).run("recorded");
		const expected = [
			"── Reflections ──",
			"No recorded reflections.",
			"",
			"── Observations ──",
			"No recorded observations.",
		].join("\n");

		expect(output).toBe(expected);
	});

	it("rejects unsupported view arguments", async () => {
		const { output } = await setup([]).run("diff");

		expect(output).toBe("Usage: /om:view [context|recorded]");
	});
});
