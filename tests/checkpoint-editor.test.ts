import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { runCheckpointEditor } from "../src/agents/checkpoint-editor/agent.js";
import { EMPTY_CHECKPOINT_MARKDOWN } from "../src/memory/checkpoint.js";
import { fakeAgentLoop } from "./fixtures/agent-loop.js";

describe("runCheckpointEditor", () => {
	let root: string | undefined;

	afterEach(async () => {
		if (root) await rm(root, { recursive: true, force: true });
		root = undefined;
	});

	async function draftPath() {
		root = await mkdtemp(join(tmpdir(), "om-checkpoint-editor-"));
		return join(root, "checkpoint.md");
	}

	type TurnAction =
		| { tool: "read"; params: { path: string } }
		| { tool: "edit"; params: { path: string; oldText: string; newText: string } }
		| { tool: "finish_checkpoint_edit"; params: { reason: string } }
		| { tool: "none" };

	function turnBasedAgentLoop(runs: TurnAction[][]) {
		let runIndex = 0;
		return fakeAgentLoop(async (_prompts, context, config) => {
			const actions = runs[runIndex++] ?? [];
			for (let i = 0; i < actions.length; i++) {
				const action = actions[i];
				if (action.tool === "none") {
					const stop = config.shouldStopAfterTurn?.({ toolResults: [] }) ?? false;
					await config.getFollowUpMessages?.();
					if (stop) return;
					continue;
				}
				const tool = context.tools.find((candidate) => candidate.name === action.tool)!;
				const result = await tool.execute(`${action.tool}-${i}`, action.params) as any;
				if (result?.terminate) return;
				const stop = config.shouldStopAfterTurn?.({ toolResults: [{ isError: result?.isError === true }] }) ?? false;
				if (stop) return;
			}
		});
	}

	it("edits a restricted checkpoint draft and finishes", async () => {
		const path = await draftPath();
		const next = EMPTY_CHECKPOINT_MARKDOWN.replace("None known.", "Implement checkpoint editor.");
		const loop = fakeAgentLoop(async (_prompts, context) => {
			const read = context.tools.find((tool) => tool.name === "read")!;
			const edit = context.tools.find((tool) => tool.name === "edit")!;
			const finish = context.tools.find((tool) => tool.name === "finish_checkpoint_edit")!;
			const readResult = await read.execute("read-1", { path: "checkpoint.md" }) as any;
			expect(readResult.content[0].text).toContain("# Checkpoint");
			await edit.execute("edit-1", { path: "checkpoint.md", oldText: EMPTY_CHECKPOINT_MARKDOWN, newText: next });
			await finish.execute("finish-1", { reason: "updated objective" });
		});

		const result = await runCheckpointEditor({
			model: {},
			apiKey: "test",
			draftPath: path,
			initialContent: EMPTY_CHECKPOINT_MARKDOWN,
			observationsText: "Observation 1: User asked for checkpoint editor.",
			purpose: "update",
			agentLoop: loop,
		});

		expect(result).toEqual(expect.objectContaining({ content: next, reason: "updated objective", changed: true }));
		expect(result?.metrics).toEqual(expect.objectContaining({ readCalls: 1, editCalls: 1, successfulEditCalls: 1, finishCalls: 1, finishRetryCount: 0 }));
		expect(await readFile(path, "utf-8")).toBe(next);
	});

	it("supports a realistic one-tool-per-turn edit workflow", async () => {
		const path = await draftPath();
		const next = EMPTY_CHECKPOINT_MARKDOWN.replace("None known.", "Implement checkpoint editor.");
		const loop = turnBasedAgentLoop([[
			{ tool: "read", params: { path: "checkpoint.md" } },
			{ tool: "edit", params: { path: "checkpoint.md", oldText: EMPTY_CHECKPOINT_MARKDOWN, newText: next } },
			{ tool: "finish_checkpoint_edit", params: { reason: "updated objective" } },
		]]);

		await expect(runCheckpointEditor({
			model: {},
			apiKey: "test",
			draftPath: path,
			initialContent: EMPTY_CHECKPOINT_MARKDOWN,
			observationsText: "Observation 1: User asked for checkpoint editor.",
			purpose: "update",
			agentLoop: loop,
		})).resolves.toEqual(expect.objectContaining({ content: next, reason: "updated objective", changed: true }));
	});

	it("supports a realistic finish retry after read-only first pass", async () => {
		const path = await draftPath();
		const loop = turnBasedAgentLoop([
			[
				{ tool: "read", params: { path: "checkpoint.md" } },
				{ tool: "none" },
				{ tool: "none" },
			],
			[
				{ tool: "read", params: { path: "checkpoint.md" } },
				{ tool: "finish_checkpoint_edit", params: { reason: "already valid" } },
			],
		]);

		await expect(runCheckpointEditor({
			model: {},
			apiKey: "test",
			draftPath: path,
			initialContent: EMPTY_CHECKPOINT_MARKDOWN,
			observationsText: "None.",
			purpose: "prune",
			agentLoop: loop,
		})).resolves.toEqual(expect.objectContaining({ content: EMPTY_CHECKPOINT_MARKDOWN, reason: "already valid", changed: false }));
	});

	it("uses write for prune rewrites", async () => {
		const path = await draftPath();
		const next = EMPTY_CHECKPOINT_MARKDOWN.replace("None known.", "Pruned checkpoint handoff.");
		const loop = fakeAgentLoop(async (_prompts, context) => {
			const read = context.tools.find((tool) => tool.name === "read")!;
			const write = context.tools.find((tool) => tool.name === "write")!;
			const finish = context.tools.find((tool) => tool.name === "finish_checkpoint_edit")!;
			expect(context.tools.some((tool) => tool.name === "edit")).toBe(false);
			await read.execute("read-1", { path: "checkpoint.md" });
			await write.execute("write-1", { path: "checkpoint.md", content: next });
			await finish.execute("finish-1", { reason: "pruned handoff" });
		});

		await expect(runCheckpointEditor({
			model: {},
			apiKey: "test",
			draftPath: path,
			initialContent: EMPTY_CHECKPOINT_MARKDOWN,
			observationsText: "None.",
			purpose: "prune",
			agentLoop: loop,
		})).resolves.toEqual(expect.objectContaining({
			content: next,
			changed: true,
			metrics: expect.objectContaining({ writeCalls: 1, writeChars: next.length, editCalls: 0 }),
		}));
	});

	it("records edit failure reasons", async () => {
		const path = await draftPath();
		const toolEvents: Array<{ tool: string; ok: boolean; errorReason?: string }> = [];
		const loop = fakeAgentLoop(async (_prompts, context) => {
			const edit = context.tools.find((tool) => tool.name === "edit")!;
			const finish = context.tools.find((tool) => tool.name === "finish_checkpoint_edit")!;
			await edit.execute("edit-bad-path", { path: "other.md", oldText: "x", newText: "y" });
			await edit.execute("edit-missing", { path: "checkpoint.md", oldText: "not in checkpoint", newText: "replacement" });
			await edit.execute("edit-not-unique", { path: "checkpoint.md", oldText: "None known.", newText: "replacement" });
			await finish.execute("finish-1", { reason: "left unchanged" });
		});

		await expect(runCheckpointEditor({
			model: {},
			apiKey: "test",
			draftPath: path,
			initialContent: EMPTY_CHECKPOINT_MARKDOWN,
			observationsText: "None.",
			purpose: "update",
			agentLoop: loop,
			onToolEvent: (event) => toolEvents.push(event),
		})).resolves.toEqual(expect.objectContaining({
			changed: false,
			metrics: expect.objectContaining({
				failedEditCalls: 3,
				editFailureReasons: {
					badPath: 1,
					oldTextNotFound: 1,
					oldTextNotUnique: 1,
				},
			}),
		}));
		expect(toolEvents).toEqual([
			expect.objectContaining({ tool: "edit", ok: false, errorReason: "bad_path" }),
			expect.objectContaining({ tool: "edit", ok: false, errorReason: "old_text_not_found" }),
			expect.objectContaining({ tool: "edit", ok: false, errorReason: "old_text_not_unique" }),
			expect.objectContaining({ tool: "finish_checkpoint_edit", ok: true }),
		]);
	});

	it("returns undefined when finish is not called", async () => {
		const path = await draftPath();
		const loop = fakeAgentLoop(() => {});

		await expect(runCheckpointEditor({
			model: {},
			apiKey: "test",
			draftPath: path,
			initialContent: EMPTY_CHECKPOINT_MARKDOWN,
			observationsText: "None.",
			purpose: "prune",
			agentLoop: loop,
		})).resolves.toBeUndefined();
	});

	it("runs a finish retry when the draft is valid but finish was not called", async () => {
		const path = await draftPath();
		let callCount = 0;
		const loop = fakeAgentLoop(async (_prompts, context) => {
			callCount++;
			const read = context.tools.find((tool) => tool.name === "read")!;
			await read.execute(`read-${callCount}`, { path: "checkpoint.md" });
			if (callCount === 1) return;
			const finish = context.tools.find((tool) => tool.name === "finish_checkpoint_edit")!;
			await finish.execute("finish-1", { reason: "already valid" });
		});

		await expect(runCheckpointEditor({
			model: {},
			apiKey: "test",
			draftPath: path,
			initialContent: EMPTY_CHECKPOINT_MARKDOWN,
			observationsText: "None.",
			purpose: "prune",
			agentLoop: loop,
		})).resolves.toEqual(expect.objectContaining({
			content: EMPTY_CHECKPOINT_MARKDOWN,
			reason: "already valid",
			changed: false,
			metrics: expect.objectContaining({ finishRetryCount: 1 }),
		}));
		expect(callCount).toBe(2);
	});
});
