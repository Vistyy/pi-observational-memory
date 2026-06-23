import { describe, expect, it } from "vitest";

import { runRewrite } from "../src/agents/rewrite/agent.js";
import { hashId } from "../src/memory/ids.js";
import { fakeAgentLoop } from "./fixtures/agent-loop.js";
import { reflection } from "./fixtures/session.js";

describe("rewrite agent", () => {
	const oldA = reflection("aaaaaaaaaaaa", ["obs_111111111111"], { content: "Old verbose preference about exact paths." });
	const oldB = reflection("bbbbbbbbbbbb", ["obs_222222222222"], { content: "Old verbose blocker with command output." });
	const baseArgs = { model: {}, apiKey: "test", reflections: [oldA, oldB] };

	it("records compact rewritten reflections with audit metadata", async () => {
		const content = "User needs exact paths and blocker commands preserved.";
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				summary: "Merged duplicate verbose details.",
				reflections: [{ content, sources: [oldB.id, oldA.id] }],
			});
		});

		const result = await runRewrite({ ...baseArgs, agentLoop: loop });

		expect(result?.summary).toBe("Merged duplicate verbose details.");
		expect(result?.reflections[0].id).toBe(`ref_${hashId(content)}`);
		expect(result?.reflections.map(({ content, sources }) => ({ content, sources }))).toEqual([
			{ content, sources: [oldA.id, oldB.id] },
		]);
	});

	it("rejects invented sources and multiline content", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				summary: "Invalid proposals.",
				reflections: [
					{ content: "Invented source", sources: ["obs_missing0000"] },
					{ content: "Two\nlines", sources: [oldA.id] },
				],
			});
		});

		await expect(runRewrite({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("rejects duplicate replacement content", async () => {
		const content = "Compact rewritten fact.";
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				summary: "Duplicate proposal.",
				reflections: [
					{ content, sources: [oldA.id] },
					{ content, sources: [oldB.id] },
				],
			});
		});

		await expect(runRewrite({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("rejects unchanged replacement content because rewrite retires old ids", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				reflections: [{ content: oldA.content, sources: [oldA.id] }],
			});
		});

		await expect(runRewrite({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("returns undefined for no-op cases", async () => {
		await expect(runRewrite({ ...baseArgs, reflections: [] })).resolves.toBeUndefined();
		await expect(runRewrite({ ...baseArgs, agentLoop: fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", { reflections: [] });
		}) })).resolves.toBeUndefined();
		await expect(runRewrite({ ...baseArgs, agentLoop: fakeAgentLoop(() => {}) })).resolves.toBeUndefined();
	});
});
