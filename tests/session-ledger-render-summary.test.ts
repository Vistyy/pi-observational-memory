import { describe, expect, it } from "vitest";

import { observationToSummaryLine, renderCheckpointSummary } from "../src/session-ledger/index.js";
import { checkpoint, observation } from "./fixtures/session.js";

describe("session-ledger summary rendering", () => {
	it("renders empty checkpoint memory as an empty summary", () => {
		expect(renderCheckpointSummary(undefined)).toBe("");
	});

	it("renders checkpoint summaries as resume handoffs", () => {
		const check = checkpoint("cccccccccccc", { content: checkpoint("cccccccccccc").content.replace("None known.", "Continue checkpoint migration.") });

		const summary = renderCheckpointSummary(check);

		expect(summary).toContain("previous agent left this handoff");
		expect(summary).toContain("continue without repeating work");
		expect(summary).toContain("Continue checkpoint migration.");
	});

	it("renders observation summary lines", () => {
		const obs = observation("aaaaaaaaaaaa", {
			content: "Typecheck passed with pnpm typecheck.",
		});

		expect(observationToSummaryLine(obs)).toContain("[obs_aaaaaaaaaaaa]");
		expect(observationToSummaryLine(obs)).toContain("Typecheck passed");
	});
});
