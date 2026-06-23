import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import observationalMemory from "../src/index.js";
import {
	RECALL_OBSERVATION_TOOL_NAME,
	formatRecallCallForTui,
	formatRecallRenderedResultForTui,
	recallObservationTool,
	registerRecallTool,
	type RecallObservationToolDetails,
} from "../src/tools/recall.js";
import { toolApi } from "./fixtures/pi.js";
import {
	observation,
	observationsRecordedEntry,
	rawMessage,
	reflection,
	reflectionsRecordedEntry,
	reflectionsRewrittenEntry,
	type TestEntry,
} from "./fixtures/session.js";

function fakeCtx(entries: TestEntry[]) {
	const getBranch = vi.fn(() => entries);
	const getEntries = vi.fn(() => {
		throw new Error("recall tool must not use getEntries");
	});
	return { ctx: { sessionManager: { getBranch, getEntries } } as unknown as ExtensionContext, getBranch, getEntries };
}

async function execute(id: string, entries: TestEntry[], params: Record<string, unknown> = {}) {
	const { ctx, getBranch, getEntries } = fakeCtx(entries);
	const result = await recallObservationTool.execute("tool-1", { id, ...params }, undefined, undefined, ctx) as AgentToolResult<RecallObservationToolDetails>;
	const text = result.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n");
	return { result, text, getBranch, getEntries };
}

describe("recall tool", () => {
	it("keeps the public tool name, typed-id schema, and TUI call rendering", () => {
		const pi = toolApi();
		registerRecallTool(pi);

		expect(RECALL_OBSERVATION_TOOL_NAME).toBe("recall");
		expect(recallObservationTool.name).toBe("recall");
		expect(recallObservationTool.label).toBe("Recall memory evidence");
		expect((recallObservationTool.parameters as any).properties.id.pattern).toBe("^(?:[a-f0-9]{12}|obs_[a-f0-9]{12}|ref_[a-f0-9]{12})$");
		expect((recallObservationTool.parameters as any).properties.mode).toBeTruthy();
		expect((recallObservationTool.parameters as any).properties.includeIntermediate).toBeUndefined();
		expect((recallObservationTool.parameters as any).properties.depth).toBeTruthy();
		expect(formatRecallCallForTui("obs_aaaaaaaaaaaa")).toBe("recall obs_aaaaaaaaaaaa");
		expect(pi.registerTool).toHaveBeenCalledWith(recallObservationTool);
	});

	it("registers the canonical recall tool from the extension entrypoint", () => {
		const pi = {
			registerTool: vi.fn(),
			registerCommand: vi.fn(),
			on: vi.fn(),
		} as any;

		observationalMemory(pi);

		expect(pi.registerTool).toHaveBeenCalledWith(recallObservationTool);
	});

	it("renders active observation source evidence", async () => {
		const obs = observation("aaaaaaaaaaaa", { content: "User likes tea.", sourceEntryIds: ["raw-1"] });
		const entries = [rawMessage("raw-1", "I like tea."), observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" })];

		const { result, text, getBranch, getEntries } = await execute("aaaaaaaaaaaa", entries);

		expect(getBranch).toHaveBeenCalledOnce();
		expect(getEntries).not.toHaveBeenCalled();
		expect(result.details?.status).toBe("ok");
		expect(result.details?.observations[0].observation.status).toBe("active");
		expect(text).toContain("I like tea.");
		expect(formatRecallRenderedResultForTui(result, false)).toContain("✓ observation");
	});

	it("renders reflection recall with supporting observations and sources", async () => {
		const obs = observation("aaaaaaaaaaaa", { content: "User likes tea.", sourceEntryIds: ["raw-1"] });
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"], { content: "User likes tea." });
		const entries = [
			rawMessage("raw-1", "I like tea."),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [ref], coversUpToId: "om-obs" }),
		];

		const { result, text } = await execute("eeeeeeeeeeee", entries);

		expect(result.details?.status).toBe("ok");
		expect(result.details?.reflections).toHaveLength(1);
		expect(result.details?.observations).toHaveLength(1);
		expect(text).toContain("Reflections:");
		expect(text).toContain("[ref_eeeeeeeeeeee] User likes tea.");
		expect(text).toContain("Provenance:");
		expect(text).toContain("ref_eeeeeeeeeeee -> obs_aaaaaaaaaaaa");
		expect(text).toContain("Observations:");
		expect(text).toContain("Sources:");
		expect(text).toContain("I like tea.");
	});

	it("can include intermediate reflection content", async () => {
		const obs = observation("aaaaaaaaaaaa", { content: "User likes tea.", sourceEntryIds: ["raw-1"] });
		const parent = reflection("dddddddddddd", ["aaaaaaaaaaaa"], { content: "User likes tea." });
		const child = reflection("eeeeeeeeeeee", ["ref_dddddddddddd"], { content: "User beverage preference is tea." });
		const entries = [
			rawMessage("raw-1", "I like tea."),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref-1", { reflections: [parent], coversUpToId: "om-obs" }),
			reflectionsRecordedEntry("om-ref-2", { reflections: [child], coversUpToId: "om-ref-1" }),
		];

		const compact = await execute("ref_eeeeeeeeeeee", entries);
		const provenance = await execute("ref_eeeeeeeeeeee", entries, { mode: "provenance" });

		expect(compact.text).not.toContain("Supporting reflections:");
		expect(compact.result.details?.supportingReflections.map((item) => item.id)).toEqual(["ref_dddddddddddd"]);
		expect(compact.text).toContain("ref_eeeeeeeeeeee -> ref_dddddddddddd");
		expect(provenance.text).toContain("Supporting reflections:");
		expect(provenance.text).toContain("[ref_dddddddddddd] User likes tea.");
	});

	it("recalls replacement reflections through retired parents", async () => {
		const obs = observation("aaaaaaaaaaaa", { content: "User prefers pnpm.", sourceEntryIds: ["raw-1"] });
		const retired = reflection("dddddddddddd", ["aaaaaaaaaaaa"], { content: "User prefers pnpm for package commands." });
		const replacement = reflection("eeeeeeeeeeee", ["ref_dddddddddddd"], { content: "Use pnpm for package-manager commands." });
		const entries = [
			rawMessage("raw-1", "Please use pnpm, not npm."),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref-1", { reflections: [retired], coversUpToId: "om-obs" }),
			reflectionsRewrittenEntry("om-rewrite", { retiredReflectionIds: ["ref_dddddddddddd"] }),
			reflectionsRecordedEntry("om-ref-2", { reflections: [replacement], coversUpToId: "om-rewrite" }),
		];

		const evidence = await execute("ref_eeeeeeeeeeee", entries);
		const provenance = await execute("ref_eeeeeeeeeeee", entries, { mode: "provenance" });

		expect(evidence.result.details?.status).toBe("ok");
		expect(evidence.result.details?.supportingReflections.map((item) => item.id)).toEqual(["ref_dddddddddddd"]);
		expect(evidence.text).toContain("[ref_eeeeeeeeeeee] Use pnpm for package-manager commands.");
		expect(evidence.text).toContain("ref_eeeeeeeeeeee -> ref_dddddddddddd");
		expect(evidence.text).toContain("ref_dddddddddddd -> obs_aaaaaaaaaaaa");
		expect(evidence.text).toContain("[obs_aaaaaaaaaaaa]");
		expect(evidence.text).toContain("Please use pnpm, not npm.");
		expect(evidence.text).not.toContain("Supporting reflections:");
		expect(provenance.text).toContain("Supporting reflections:");
		expect(provenance.text).toContain("[ref_dddddddddddd] User prefers pnpm for package commands.");
	});

	it("recalls retired reflections directly", async () => {
		const obs = observation("aaaaaaaaaaaa", { content: "User prefers short answers.", sourceEntryIds: ["raw-1"] });
		const retired = reflection("dddddddddddd", ["aaaaaaaaaaaa"], { content: "User prefers short answers." });
		const entries = [
			rawMessage("raw-1", "Please keep answers short."),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref-1", { reflections: [retired], coversUpToId: "om-obs" }),
			reflectionsRewrittenEntry("om-rewrite", { retiredReflectionIds: ["ref_dddddddddddd"] }),
		];

		const { result, text } = await execute("ref_dddddddddddd", entries);

		expect(result.details?.status).toBe("ok");
		expect(result.details?.reflections.map((item) => item.id)).toEqual(["ref_dddddddddddd"]);
		expect(text).toContain("[ref_dddddddddddd] User prefers short answers.");
		expect(text).toContain("[obs_aaaaaaaaaaaa]");
		expect(text).toContain("Please keep answers short.");
	});

	it("does not expose assistant thinking from source entries", async () => {
		const obs = observation("aaaaaaaaaaaa", { content: "Safe observation.", sourceEntryIds: ["assistant-raw"] });
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"], { content: "Safe reflection." });
		const assistantSource = rawMessage("assistant-raw", "", {
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "secret chain of thought" },
					{ type: "text", text: "Visible assistant answer." },
				],
			},
		});
		const entries = [
			assistantSource,
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "assistant-raw" }),
			reflectionsRecordedEntry("om-ref", { reflections: [ref], coversUpToId: "om-obs" }),
		];

		const { text, result } = await execute("ref_eeeeeeeeeeee", entries);

		expect(text).toContain("Visible assistant answer.");
		expect(text).toContain("[thinking omitted]");
		expect(text).not.toContain("secret chain of thought");
		expect(result.details?.sourceEntries[0].content).not.toContain("secret chain of thought");
	});

	it("bounds long source output deterministically", async () => {
		const longText = `start ${"x".repeat(20_000)} end`;
		const obs = observation("aaaaaaaaaaaa", { content: "Long source observation.", sourceEntryIds: ["raw-1"] });
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"], { content: "Long source reflection." });
		const entries = [
			rawMessage("raw-1", longText),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [ref], coversUpToId: "om-obs" }),
		];

		const { text, result } = await execute("ref_eeeeeeeeeeee", entries);

		expect(text).toContain("[recall sources truncated:");
		expect(text).toContain("[truncated");
		expect(text).not.toContain(" end");
		expect(text.length).toBeLessThan(13_000);
		expect(result.details?.sourceEntries[0].content?.length).toBeLessThan(4_100);
	});

	it("bounds source entry count in text and details", async () => {
		const sourceIds = Array.from({ length: 25 }, (_, index) => `raw-${index + 1}`);
		const obs = observation("aaaaaaaaaaaa", { content: "Many sources observation.", sourceEntryIds: sourceIds });
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"], { content: "Many sources reflection." });
		const entries = [
			...sourceIds.map((id) => rawMessage(id, `source ${id}`)),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-25" }),
			reflectionsRecordedEntry("om-ref", { reflections: [ref], coversUpToId: "om-obs" }),
		];

		const { text, result } = await execute("ref_eeeeeeeeeeee", entries);

		expect(text).toContain("source raw-20");
		expect(text).not.toContain("source raw-21");
		expect(text).toContain("omitted 5 entries");
		expect(result.details?.sourceEntries).toHaveLength(20);
		expect(result.details?.observations[0].sourceEntries).toHaveLength(20);
	});

	it("reports missing sources as partial", async () => {
		const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["missing-raw"] });
		const entries = [observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "om-obs" })];

		const { result, text } = await execute("aaaaaaaaaaaa", entries);

		expect(result.details?.status).toBe("partial");
		expect(result.details?.missingSourceEntryIds).toEqual(["missing-raw"]);
		expect(text).toContain("missing: missing-raw");
	});

	it("reports invalid ids without reading the branch", async () => {
		const { result, text, getBranch } = await execute("not-valid", []);

		expect(result.details?.status).toBe("invalid_id");
		expect(text).toContain("Memory id must be a typed obs_* or ref_* id");
		expect(getBranch).not.toHaveBeenCalled();
	});

});
