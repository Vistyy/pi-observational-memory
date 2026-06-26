import { describe, expect, it, vi } from "vitest";

import { registerViewCommand } from "../src/commands/view.js";
import type { Runtime } from "../src/runtime.js";
import {
	checkpoint,
	checkpointRecordedEntry,
	observation,
	observationsRecordedEntry,
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
	it("renders no-checkpoint output", async () => {
		const { output } = await setup([]).run();

		expect(output).toBe("No checkpoint recorded.");
	});

	it("default view renders latest checkpoint Markdown", async () => {
		const obs = observation("aaaaaaaaaaaa");
		const check = checkpoint("cccccccccccc", { content: checkpoint("cccccccccccc").content.replace("None known.", "Continue checkpoint migration.") });
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			checkpointRecordedEntry("om-check", { checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] }),
		];

		const { output } = await setup(entries).run();

		expect(output).toBe(check.content);
		expect(output).toContain("Continue checkpoint migration.");
	});

	it("recorded view renders recorded observations", async () => {
		const obs = observation("aaaaaaaaaaaa");
		const { output } = await setup([
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
		]).run("recorded");

		expect(output).toContain("[obs_aaaaaaaaaaaa]");
	});

	it("rejects unsupported view arguments", async () => {
		const { output } = await setup([]).run("diff");

		expect(output).toBe("Usage: /om:view [context|recorded]");
	});
});
