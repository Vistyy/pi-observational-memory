import { describe, expect, it } from "vitest";
import { CHECKPOINT_EDITOR_SYSTEM, checkpointEditorPruneUserText, checkpointEditorUpdateUserText, checkpointEditorUserText } from "../src/agents/checkpoint-editor/prompts.js";
import { CHECKPOINT_MARKDOWN_HEADINGS, EMPTY_CHECKPOINT_MARKDOWN, isValidCheckpointMarkdown } from "../src/memory/checkpoint-format.js";

const SENTINEL_OBSERVATION = "THIS_SENTINEL_OBSERVATION_MUST_NOT_APPEAR";

describe("checkpoint format", () => {
	it("validates the shared empty checkpoint template", () => {
		expect(isValidCheckpointMarkdown(EMPTY_CHECKPOINT_MARKDOWN)).toBe(true);
		expect(isValidCheckpointMarkdown(EMPTY_CHECKPOINT_MARKDOWN.replace("## Remaining work", "## Work left"))).toBe(false);
	});

	it("renders required headings into the checkpoint editor system prompt", () => {
		for (const heading of CHECKPOINT_MARKDOWN_HEADINGS) expect(CHECKPOINT_EDITOR_SYSTEM).toContain(heading);
	});

	it("keeps ledger provenance lists out of checkpoint markdown by default", () => {
		expect(CHECKPOINT_EDITOR_SYSTEM).toContain("Do not preserve observation ids or source entry ids");
		expect(CHECKPOINT_EDITOR_SYSTEM).toContain("Do not add ledger provenance lists");
	});
});

describe("checkpoint editor prompt branches", () => {
	it("renders pending observations only for update", () => {
		const prompt = checkpointEditorUpdateUserText({ observationsText: SENTINEL_OBSERVATION });

		expect(prompt).toContain("Purpose: update");
		expect(prompt).toContain("Pending observations:");
		expect(prompt).toContain(SENTINEL_OBSERVATION);
		expect(prompt).toContain("patch to merge");
	});

	it("does not render observation framing for prune", () => {
		const prompt = checkpointEditorUserText({ purpose: "prune", observationsText: SENTINEL_OBSERVATION });

		expect(prompt).toContain("Purpose: prune");
		expect(prompt).not.toContain("Pending observations:");
		expect(prompt).not.toContain(SENTINEL_OBSERVATION);
		expect(prompt).toContain("without adding facts");
		expect(prompt).toContain("Do not change the meaning");
		expect(prompt).toContain("Remove observation id lists and source entry id lists");
	});

	it("keeps prune prompt focused on shrinking or repair", () => {
		const prompt = checkpointEditorPruneUserText();

		expect(prompt).toContain("make it smaller, clearer, or better repaired");
		expect(prompt).toContain("remove the low-value detail entirely");
		expect(prompt).toContain("leave checkpoint.md unchanged");
	});
});
