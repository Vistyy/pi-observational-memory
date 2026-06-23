import { describe, expect, it } from "vitest";

import { MemoryAgentProviderError } from "../src/agents/common.js";
import { normalizeSourceEntryIds, OBSERVATION_TIMESTAMP_PATTERN, runObserver } from "../src/agents/observer/agent.js";
import { fakeAgentLoop } from "./fixtures/agent-loop.js";

describe("OBSERVATION_TIMESTAMP_PATTERN", () => {
	it("matches local minute timestamps without regex shorthand escapes", () => {
		expect(OBSERVATION_TIMESTAMP_PATTERN).not.toContain("\\d");
		const pattern = new RegExp(OBSERVATION_TIMESTAMP_PATTERN);
		expect(pattern.test("2026-05-02 10:30")).toBe(true);
		expect(pattern.test("2026-5-02 10:30")).toBe(false);
		expect(pattern.test("2026-05-02T10:30")).toBe(false);
		expect(pattern.test("2026-05-02 10:30:00")).toBe(false);
	});
});

describe("runObserver", () => {
	const baseArgs = {
		model: {},
		apiKey: "test",
		chunk: "[Source entry id: entry-a]\nUser asked for a memory update.",
		allowedSourceEntryIds: ["entry-a"],
	};

	it("records observations with source ids", async () => {
		const content = "User asked for a memory update.";
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				observations: [{
					timestamp: "2026-05-02 10:30",
					content,
					sourceEntryIds: ["entry-a"],
				}],
			});
		});

		const observations = await runObserver({ ...baseArgs, agentLoop: loop });

		expect(observations).toHaveLength(1);
		expect(observations?.[0]).toMatchObject({
			kind: "observation",
			content,
			createdAt: "2026-05-02 10:30",
			timestamp: "2026-05-02 10:30",
			sourceEntryIds: ["entry-a"],
		});
		expect(observations?.[0].id).toMatch(/^obs_[a-f0-9]{12}$/);
	});

	it("rejects invented source ids with exact feedback and returns no observations", async () => {
		let response: any;
		const loop = fakeAgentLoop(async (_prompts, context) => {
			response = await context.tools[0].execute("tool-1", {
				observations: [{ timestamp: "2026-05-02 10:30", content: "Bad source", sourceEntryIds: ["entry-a", "missing"] }],
			});
		});

		await expect(runObserver({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
		expect(response.content[0].text).toContain("missing: invalid_source_entry_id");
		expect(response.details.rejectedDetails).toEqual([{ content: "Bad source", sourceEntryIds: [{ id: "missing", reason: "invalid_source_entry_id" }] }]);
	});

	it("dedupes deterministic ids", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				observations: [
					{ timestamp: "2026-05-02 10:30", content: "Same content", sourceEntryIds: ["entry-a"] },
					{ timestamp: "2026-05-02 10:31", content: "Same content", sourceEntryIds: ["entry-a"] },
				],
			});
		});

		const observations = await runObserver({ ...baseArgs, agentLoop: loop });

		expect(observations).toHaveLength(1);
		expect(observations?.[0].content).toBe("Same content");
	});

	it("returns an empty batch when record_observations is called with no observations", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", { observations: [] });
		});

		await expect(runObserver({ ...baseArgs, agentLoop: loop })).resolves.toEqual([]);
	});

	it("returns undefined when no tool call records observations", async () => {
		const loop = fakeAgentLoop(() => {});
		await expect(runObserver({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("requires an explicit record tool call before stopping on no-tool output", async () => {
		let shouldStopAfterTurn: any;
		let getFollowUpMessages: any;
		const loop = fakeAgentLoop((_prompts, _context, config) => {
			shouldStopAfterTurn = config.shouldStopAfterTurn;
			getFollowUpMessages = config.getFollowUpMessages;
		});

		await runObserver({ ...baseArgs, agentLoop: loop, maxTurns: 2 });

		expect(shouldStopAfterTurn).toBeTypeOf("function");
		expect(getFollowUpMessages).toBeTypeOf("function");
		expect(shouldStopAfterTurn({ toolResults: [] })).toBe(false);
		await expect(getFollowUpMessages()).resolves.toEqual([expect.objectContaining({ role: "user" })]);
		expect(shouldStopAfterTurn({ toolResults: [] })).toBe(true);
		expect(shouldStopAfterTurn({ toolResults: [{ isError: false }] })).toBe(true);
	});

	it("retries provider stopReason error before treating the run as failed", async () => {
		let calls = 0;
		const loop = ((_prompts: any, context: any) => ({
			async *[Symbol.asyncIterator]() {
				calls++;
				if (calls === 1) {
					yield { type: "turn_end", message: { role: "assistant", stopReason: "error", errorMessage: "temporary provider failure" }, toolResults: [] };
					return;
				}
				await context.tools[0].execute("tool-1", {
					observations: [{ timestamp: "2026-05-02 10:30", content: "Recovered", sourceEntryIds: ["entry-a"] }],
				});
			},
			result: async () => [],
		})) as never;

		const observations = await runObserver({ ...baseArgs, agentLoop: loop });

		expect(calls).toBe(2);
		expect(observations?.[0].content).toBe("Recovered");
	});

	it("surfaces provider stopReason error distinctly after retries are exhausted", async () => {
		let calls = 0;
		const loop = (() => ({
			async *[Symbol.asyncIterator]() {
				calls++;
				yield { type: "turn_end", message: { role: "assistant", stopReason: "error", errorMessage: "provider exploded" }, toolResults: [] };
			},
			result: async () => [],
		})) as never;

		await expect(runObserver({ ...baseArgs, agentLoop: loop, maxProviderErrorRetries: 1 })).rejects.toBeInstanceOf(MemoryAgentProviderError);
		expect(calls).toBe(2);
	});

	it("uses configured observer thinking level for reasoning models", async () => {
		let seenReasoning: unknown;
		const loop = fakeAgentLoop((_prompts, _context, config) => {
			seenReasoning = config.reasoning;
		});

		await runObserver({ ...baseArgs, model: { reasoning: true }, agentLoop: loop, thinkingLevel: "minimal" });

		expect(seenReasoning).toBe("minimal");
	});

	it("omits observer reasoning when thinkingLevel is off", async () => {
		let seenReasoning: unknown = "unset";
		const loop = fakeAgentLoop((_prompts, _context, config) => {
			seenReasoning = config.reasoning;
		});

		await runObserver({ ...baseArgs, model: { reasoning: true }, agentLoop: loop, thinkingLevel: "off" });

		expect(seenReasoning).toBeUndefined();
	});
});

describe("normalizeSourceEntryIds", () => {
	const allowed = ["entry-a", "entry-b", "entry-c"];

	it("accepts source ids from the allowed chunk and orders them by branch order", () => {
		expect(normalizeSourceEntryIds(["entry-c", "entry-a"], allowed)).toEqual(["entry-a", "entry-c"]);
	});

	it("dedupes repeated source ids", () => {
		expect(normalizeSourceEntryIds(["entry-b", "entry-b", "entry-a"], allowed)).toEqual(["entry-a", "entry-b"]);
	});

	it("rejects missing, empty, or hallucinated source ids", () => {
		expect(normalizeSourceEntryIds(undefined, allowed)).toBeUndefined();
		expect(normalizeSourceEntryIds([], allowed)).toBeUndefined();
		expect(normalizeSourceEntryIds(["entry-a", "not-in-the-chunk"], allowed)).toBeUndefined();
		expect(normalizeSourceEntryIds(["entry-a"], [])).toBeUndefined();
	});
});
