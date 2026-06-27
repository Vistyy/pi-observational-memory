import { describe, expect, it } from "vitest";
import { CHECKPOINT_EDITOR_SYSTEM, checkpointEditorPruneUserText, checkpointEditorUpdateUserText, checkpointEditorUserText } from "../src/agents/checkpoint-editor/prompts.js";
import { renderObservationsForCheckpointEditor } from "../src/memory/checkpoint.js";
import { CHECKPOINT_MARKDOWN_HEADINGS, EMPTY_CHECKPOINT_MARKDOWN, isValidCheckpointMarkdown } from "../src/memory/checkpoint-format.js";

const SENTINEL_OBSERVATION = "THIS_SENTINEL_OBSERVATION_MUST_NOT_APPEAR";

describe("checkpoint format", () => {
	it("validates the shared empty checkpoint template", () => {
		expect(isValidCheckpointMarkdown(EMPTY_CHECKPOINT_MARKDOWN)).toBe(true);
		expect(isValidCheckpointMarkdown(EMPTY_CHECKPOINT_MARKDOWN.replace("## Next", "## Work left"))).toBe(false);
	});

	it("renders required headings into the checkpoint editor system prompt", () => {
		for (const heading of CHECKPOINT_MARKDOWN_HEADINGS) expect(CHECKPOINT_EDITOR_SYSTEM).toContain(heading);
	});

	it("keeps durable artifacts referenced instead of duplicated", () => {
		expect(CHECKPOINT_EDITOR_SYSTEM).toContain("Do not duplicate durable artifacts");
		expect(CHECKPOINT_EDITOR_SYSTEM).toContain("Redact secrets and private data");
	});
});

describe("checkpoint observation rendering", () => {
	it("passes observation content without ledger ids to the checkpoint editor", () => {
		const text = renderObservationsForCheckpointEditor([{
			id: "obs_aaaaaaaaaaaa",
			kind: "observation",
			content: "Preserve the exact command pnpm typecheck.",
			createdAt: "2026-06-27T10:00:00.000Z",
			timestamp: "2026-06-27T10:00:00.000Z",
			sourceEntryIds: ["raw-1", "raw-2"],
		}]);

		expect(text).toContain("Observation 1:");
		expect(text).toContain("Preserve the exact command pnpm typecheck.");
		expect(text).not.toContain("obs_aaaaaaaaaaaa");
		expect(text).not.toContain("raw-1");
		expect(text).not.toContain("sourceEntryIds");
	});
});

describe("checkpoint editor prompt branches", () => {
	it("renders pending observations only for update", () => {
		const prompt = checkpointEditorUpdateUserText({ observationsText: SENTINEL_OBSERVATION });

		expect(prompt).toContain("Purpose: update");
		expect(prompt).toContain("Pending observations:");
		expect(prompt).toContain(SENTINEL_OBSERVATION);
		expect(prompt).toContain("Merge pending observations");
		expect(prompt).toContain("Use edit for small local changes");
		expect(prompt).toContain("Use write with the full checkpoint");
	});

	it("does not render observation framing for prune", () => {
		const prompt = checkpointEditorUserText({ purpose: "prune", observationsText: SENTINEL_OBSERVATION });

		expect(prompt).toContain("Purpose: prune");
		expect(prompt).not.toContain("Pending observations:");
		expect(prompt).not.toContain(SENTINEL_OBSERVATION);
		expect(prompt).toContain("Do not add facts");
		expect(prompt).toContain("Use write to replace checkpoint.md");
	});

	it("keeps prune prompt focused on a smaller handoff rewrite", () => {
		const prompt = checkpointEditorPruneUserText();

		expect(prompt).toContain("smaller routing handoff");
		expect(prompt).toContain("Reference durable artifacts instead of copying them");
		expect(prompt).toContain("useful suggested tools or skills");
	});

	it("can render eval-only prune size guidance", () => {
		const prompt = checkpointEditorPruneUserText({ sizeGuidance: "Aim for at least 25% smaller." });

		expect(prompt).toContain("Size guidance:");
		expect(prompt).toContain("Aim for at least 25% smaller.");
	});
});
