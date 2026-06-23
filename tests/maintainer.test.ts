import { describe, expect, it } from "vitest";

import { runMaintainer } from "../src/agents/maintainer/agent.js";
import { hashId } from "../src/memory/ids.js";
import { fakeAgentLoop } from "./fixtures/agent-loop.js";
import { reflection } from "./fixtures/session.js";

describe("maintainer agent", () => {
	const oldA = reflection("aaaaaaaaaaaa", ["obs_111111111111"], { content: "Use pnpm for package commands." });
	const oldB = reflection("bbbbbbbbbbbb", ["obs_222222222222"], { content: "Use pnpm instead of npm in this repo." });
	const oldC = reflection("cccccccccccc", ["obs_333333333333"], { content: "Compaction must not run memory agents synchronously." });
	const baseArgs = { model: {}, apiKey: "test", reflections: [oldA, oldB, oldC] };

	it("records valid local replacement with direct parent sources", async () => {
		const content = "Use pnpm instead of npm for package commands in this repo.";
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				retireReflectionIds: [oldB.id, oldA.id],
				reflections: [{ content, sources: [oldB.id, oldA.id] }],
			});
		});

		const result = await runMaintainer({ ...baseArgs, agentLoop: loop });

		expect(result?.retireReflectionIds).toEqual([oldA.id, oldB.id]);
		expect(result?.reflections[0].id).toBe(`ref_${hashId(content)}`);
		expect(result?.reflections.map(({ content, sources }) => ({ content, sources }))).toEqual([
			{ content, sources: [oldA.id, oldB.id] },
		]);
	});

	it("accepts explicit no-op", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", { retireReflectionIds: [], reflections: [] });
		});

		await expect(runMaintainer({ ...baseArgs, agentLoop: loop })).resolves.toEqual({ retireReflectionIds: [], reflections: [] });
	});

	it("rejects invented retire ids", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				retireReflectionIds: [oldA.id, "ref_missing000000"],
				reflections: [{ content: "Use pnpm.", sources: [oldA.id] }],
			});
		});

		await expect(runMaintainer({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("rejects obs sources and sources outside retired parents", async () => {
		await expect(runMaintainer({ ...baseArgs, agentLoop: fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				retireReflectionIds: [oldA.id, oldB.id],
				reflections: [{ content: "Use pnpm.", sources: ["obs_111111111111", oldB.id] }],
			});
		}) })).resolves.toBeUndefined();

		await expect(runMaintainer({ ...baseArgs, agentLoop: fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				retireReflectionIds: [oldA.id, oldB.id],
				reflections: [{ content: "Use pnpm.", sources: [oldA.id, oldC.id] }],
			});
		}) })).resolves.toBeUndefined();
	});

	it("rejects deletion without replacement", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", { retireReflectionIds: [oldA.id], reflections: [] });
		});

		await expect(runMaintainer({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("requires every retired ref to be cited by a replacement", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				retireReflectionIds: [oldA.id, oldB.id],
				reflections: [{ content: "Use pnpm.", sources: [oldA.id] }],
			});
		});

		await expect(runMaintainer({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("dedupes duplicate replacement content", async () => {
		const content = "Use pnpm for package commands.";
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				retireReflectionIds: [oldA.id, oldB.id],
				reflections: [
					{ content, sources: [oldA.id, oldB.id] },
					{ content, sources: [oldA.id, oldB.id] },
				],
			});
		});

		const result = await runMaintainer({ ...baseArgs, agentLoop: loop });

		expect(result?.reflections).toHaveLength(1);
		expect(result?.reflections[0].sources).toEqual([oldA.id, oldB.id]);
	});

	it("rejects single-ref paraphrase maintenance", async () => {
		await expect(runMaintainer({ ...baseArgs, agentLoop: fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				retireReflectionIds: [oldA.id],
				reflections: [{ content: "Use pnpm for package commands.", sources: [oldA.id] }],
			});
		}) })).resolves.toBeUndefined();
	});

	it("returns undefined for empty input, no tool call, or all invalid proposals", async () => {
		await expect(runMaintainer({ ...baseArgs, reflections: [] })).resolves.toBeUndefined();
		await expect(runMaintainer({ ...baseArgs, agentLoop: fakeAgentLoop(() => {}) })).resolves.toBeUndefined();
		await expect(runMaintainer({ ...baseArgs, agentLoop: fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				retireReflectionIds: [oldA.id],
				reflections: [{ content: "Two\nlines", sources: [oldA.id] }],
			});
		}) })).resolves.toBeUndefined();
	});
});
