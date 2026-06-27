import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { registerCompactionHook } from "../src/hooks/compaction-hook.js";
import type { CompactionPreparation, MemoryLifecycle } from "../src/memory-update/lifecycle.js";
import { beforeCompactApi, type BeforeCompactHandler } from "./fixtures/pi.js";

function setup(result: CompactionPreparation) {
	let handler: BeforeCompactHandler | undefined;
	const pi = beforeCompactApi((cb) => {
		handler = cb;
	});
	const lifecycle = { prepareForCompaction: vi.fn(async () => result) } as unknown as MemoryLifecycle;
	registerCompactionHook(pi, lifecycle);
	if (!handler) throw new Error("compaction handler was not registered");
	const ctx = {
		cwd: "/tmp/project",
		hasUI: true,
		ui: { notify: vi.fn() },
	} as unknown as ExtensionContext;
	const event = {
		preparation: { firstKeptEntryId: "raw-1", tokensBefore: 123 },
		branchEntries: [],
		signal: undefined,
	} as SessionBeforeCompactEvent;
	const run = async () => handler!(event, ctx);
	return { lifecycle, ctx, event, run };
}

describe("compaction hook adapter", () => {
	it("returns undefined when lifecycle does not participate", async () => {
		const { run } = setup({ kind: "noop" });

		await expect(run()).resolves.toBeUndefined();
	});

	it("cancels when lifecycle says compaction is unsafe", async () => {
		const { run } = setup({ kind: "cancel", reason: "checkpoint is not ready" });

		await expect(run()).resolves.toEqual({ cancel: true });
	});

	it("returns lifecycle compaction payload when ready", async () => {
		const { run } = setup({
			kind: "ready",
			summary: "# Handoff",
			firstKeptEntryId: "raw-1",
			tokensBefore: 123,
			details: { type: "om.checkpoint", checkpoint: { id: "check_cccccccccccc", content: "# Handoff\n\n## Focus\n\nNone known.\n\n## State\n\nNone known.\n\n## Next\n\nNone known.\n\n## References\n\nNone known.", createdAt: "2026-05-02T10:00:00.000Z", contentFormat: "markdown" } },
		});

		await expect(run()).resolves.toEqual({
			compaction: {
				summary: "# Handoff",
				firstKeptEntryId: "raw-1",
				tokensBefore: 123,
				details: expect.objectContaining({ type: "om.checkpoint" }),
			},
		});
	});

	it("passes Pi preparation to lifecycle", async () => {
		const { run, lifecycle, ctx } = setup({ kind: "noop" });

		await run();

		expect(lifecycle.prepareForCompaction).toHaveBeenCalledWith(ctx, { firstKeptEntryId: "raw-1", tokensBefore: 123 });
	});
});
