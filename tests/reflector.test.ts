import { describe, expect, it } from "vitest";

import {
	normalizeSourceIds,
	runReflector,
} from "../src/agents/reflector/agent.js";
import { hashId } from "../src/memory/ids.js";
import { fakeAgentLoop } from "./fixtures/agent-loop.js";
import { observation, reflection } from "./fixtures/session.js";

describe("reflector agent", () => {
	const obsA = observation("aaaaaaaaaaaa");
	const obsB = observation("bbbbbbbbbbbb");
	const baseArgs = {
		model: {},
		apiKey: "test",
		reflections: [],
		observations: [obsA, obsB],
	};

	it("renders active observation lines and touched-file context for the reflector", async () => {
		let userText = "";
		const loop = fakeAgentLoop((prompts) => {
			userText = prompts[0].content[0].text;
		});

		await runReflector({ ...baseArgs, touchedFiles: ["src/config.ts"], agentLoop: loop });

		expect(userText).toContain("[obs_aaaaaaaaaaaa]");
		expect(userText).toContain("Observation aaaaaaaaaaaa");
		expect(userText).toContain("KNOWN STRUCTURED FILE-TOOL TOUCHES SINCE LAST REFLECTION:");
		expect(userText).toContain("- src/config.ts");
		expect(userText).toContain("not semantic evidence");
		expect(userText).not.toContain("coverage:");
	});

	it("normalizes source observation ids by active observation order", () => {
		expect(normalizeSourceIds(["obs_bbbbbbbbbbbb", "obs_aaaaaaaaaaaa", "obs_aaaaaaaaaaaa"], ["obs_aaaaaaaaaaaa", "obs_bbbbbbbbbbbb"])).toEqual(["obs_aaaaaaaaaaaa", "obs_bbbbbbbbbbbb"]);
		expect(normalizeSourceIds(["obs_aaaaaaaaaaaa", "missing"], ["obs_aaaaaaaaaaaa"])).toBeUndefined();
		expect(normalizeSourceIds([], ["obs_aaaaaaaaaaaa"])).toBeUndefined();
	});

	it("records one-line reflections with code-computed ids", async () => {
		const content = "User prefers source-backed memory.";
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				reflections: [{ content, sources: ["obs_bbbbbbbbbbbb", "obs_aaaaaaaaaaaa"] }],
			});
		});

		const result = await runReflector({ ...baseArgs, agentLoop: loop });

		expect(result?.map(({ id, content, sources }) => ({ id, content, sources }))).toEqual([{ id: `ref_${hashId(content)}`, content, sources: ["obs_aaaaaaaaaaaa", "obs_bbbbbbbbbbbb"] }]);
	});

	it("rejects invented support ids and multiline content", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				reflections: [
					{ content: "Bad support", sources: ["missing"] },
					{ content: "Two\nlines", sources: ["obs_aaaaaaaaaaaa"] },
				],
			});
		});

		await expect(runReflector({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("dedupes proposals and skips existing reflection ids", async () => {
		const content = "User prefers terse updates.";
		const existing = reflection(hashId(content), ["aaaaaaaaaaaa"], { content });
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				reflections: [
					{ content, sources: ["obs_aaaaaaaaaaaa"] },
					{ content: "New durable fact.", sources: ["obs_aaaaaaaaaaaa"] },
					{ content: "New durable fact.", sources: ["obs_bbbbbbbbbbbb"] },
				],
			});
		});

		const result = await runReflector({ ...baseArgs, reflections: [existing], agentLoop: loop });

		expect(result?.map((item) => item.content)).toEqual(["New durable fact."]);
	});

	it("returns empty array when explicitly recorded with no reflections", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			expect(context.tools.map((tool) => tool.name)).toEqual(["record_reflections"]);
			await context.tools[0].execute("tool-1", { reflections: [] });
		});
		await expect(runReflector({ ...baseArgs, agentLoop: loop })).resolves.toEqual([]);
	});

	it("returns undefined when no tool call records reflections", async () => {
		const loop = fakeAgentLoop(() => {});
		await expect(runReflector({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});
});
