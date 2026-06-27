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

		expect(result).toEqual({ content: next, reason: "updated objective", changed: true });
		expect(await readFile(path, "utf-8")).toBe(next);
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

	it("reminds the editor to finish after successful non-finishing tool turns", async () => {
		const path = await draftPath();
		const loop = fakeAgentLoop(async (_prompts, context, config) => {
			const read = context.tools.find((tool) => tool.name === "read")!;
			const finish = context.tools.find((tool) => tool.name === "finish_checkpoint_edit")!;
			await read.execute("read-1", { path: "checkpoint.md" });
			expect(config.shouldStopAfterTurn?.({ toolResults: [{ isError: false }] })).toBe(false);
			const followUps = await config.getFollowUpMessages?.();
			expect(followUps?.[0]?.content[0]?.text).toContain("call finish_checkpoint_edit now");
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
		})).resolves.toEqual({ content: EMPTY_CHECKPOINT_MARKDOWN, reason: "already valid", changed: false });
	});
});
