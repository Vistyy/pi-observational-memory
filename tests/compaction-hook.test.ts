import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { registerCompactionHook } from "../src/hooks/compaction-hook.js";
import type { Runtime } from "../src/runtime.js";
import {
	checkpoint,
	checkpointRecordedEntry,
	observation,
	observationsRecordedEntry,
	textCustomMessage,
	type TestEntry,
} from "./fixtures/session.js";
import { beforeCompactApi, type BeforeCompactHandler } from "./fixtures/pi.js";

type OmCompactionResult = {
	cancel?: boolean;
	compaction?: {
		summary: string;
		details?: {
			type: string;
			checkpoint?: { id: string };
		};
	};
};

function setup(args: { entries: TestEntry[]; compactHookInFlight?: boolean; strategy?: "replacement" | "off" }) {
	let handler: BeforeCompactHandler | undefined;
	const appendEntry = vi.fn();
	const pi = beforeCompactApi((cb) => {
		handler = cb;
	}, appendEntry);
	const runtime = {
		config: {
			strategy: args.strategy ?? "replacement",
		},
		compactHookInFlight: args.compactHookInFlight ?? false,
		observerPromise: new Promise(() => {}),
		resolveModel: vi.fn(() => {
			throw new Error("resolveModel must not be called");
		}),
		ensureConfig: vi.fn(),
	};
	registerCompactionHook(pi, runtime as Runtime);
	if (!handler) throw new Error("compaction handler was not registered");
	const ctx = {
		cwd: "/tmp/project",
		hasUI: true,
		ui: { notify: vi.fn() },
		sessionManager: { getBranch: vi.fn(() => args.entries) },
	} as unknown as ExtensionContext;
	const run = async (firstKeptEntryId = args.entries.at(-1)?.id ?? "missing"): Promise<OmCompactionResult> => handler!({
		preparation: { firstKeptEntryId, tokensBefore: 123 },
		branchEntries: args.entries,
		signal: undefined,
	} as SessionBeforeCompactEvent, ctx) as Promise<OmCompactionResult>;
	return { pi: { ...pi, appendEntry }, runtime, ctx, run };
}

describe("compaction hook", () => {
	it("does not replace default compaction when memory is off", async () => {
		const entries = [textCustomMessage("raw-1", "aaaa")];

		await expect(setup({ entries, strategy: "off" }).run("raw-1")).resolves.toBeUndefined();
	});

	it("returns empty summary when there is no checkpoint", async () => {
		const entries = [textCustomMessage("raw-1", "aaaa")];
		const { run, runtime, pi } = setup({ entries });

		const result = await run("raw-1");

		expect(result).toMatchObject({
			compaction: {
				firstKeptEntryId: "raw-1",
				tokensBefore: 123,
				summary: "",
				details: undefined,
			},
		});
		expect(runtime.resolveModel).not.toHaveBeenCalled();
		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(runtime.compactHookInFlight).toBe(false);
	});

	it("renders the current checkpoint", async () => {
		const obs1 = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const check = checkpoint("cccccccccccc", { content: checkpoint("cccccccccccc").content.replace("None known.", "Ship checkpoint compaction.") });
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("om-aaaaaaaaaaaa", { observations: [obs1], coversUpToId: "raw-1" }),
			checkpointRecordedEntry("om-check", { checkpoint: check, coversUpToObservationId: obs1.id, observationIds: [obs1.id] }),
		];
		const { run } = setup({ entries });

		const result = await run("raw-1");

		expect(result.compaction?.details).toMatchObject({ type: "om.checkpoint", checkpoint: { id: "check_cccccccccccc" } });
		expect(result.compaction?.summary).toContain("The checkpoint below is the current handoff core.");
		expect(result.compaction?.summary).toContain("Ship checkpoint compaction.");
	});


	it("does not wait for worker promises or call model resolution", async () => {
		const entries = [textCustomMessage("raw-1", "aaaa")];
		const { run, runtime } = setup({ entries });

		const result = await Promise.race([
			run("raw-1"),
			new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 50)),
		]);

		expect(result).toMatchObject({ compaction: { summary: "", details: undefined } });
		expect(runtime.resolveModel).not.toHaveBeenCalled();
	});

	it("cancels duplicate in-flight compaction and notifies the UI", async () => {
		const entries = [textCustomMessage("raw-1", "aaaa")];
		const { run, ctx } = setup({ entries, compactHookInFlight: true });

		await expect(run("raw-1")).resolves.toEqual({ cancel: true });
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"Observational memory: another compaction is already in progress; cancelling duplicate",
			"warning",
		);
	});
});
