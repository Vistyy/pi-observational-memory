import { describe, expect, it } from "vitest";
import { recallMemorySources, type Entry, type Observation, type Reflection } from "../src/session-ledger/recall.js";
import { OM_OBSERVATIONS_RECORDED, OM_REFLECTIONS_RECORDED, OM_REFLECTIONS_REWRITTEN } from "../src/session-ledger/types.js";

const OBS_1 = "obs_aaaaaaaaaaaa";
const OBS_2 = "obs_bbbbbbbbbbbb";
const REF_1 = "ref_cccccccccccc";
const REF_2 = "ref_dddddddddddd";
const REF_3 = "ref_ffffffffffff";
const MISSING_OBS = "obs_eeeeeeeeeeee";
const MISSING_REF = "ref_111111111111";

function sourceEntry(id: string, content = `source ${id}`): Entry {
	return { type: "custom_message", id, timestamp: "2026-05-19T00:00:00.000Z", content };
}

function nonSourceEntry(id: string): Entry {
	return { type: "custom", id, customType: "not-source", data: {} };
}

function observation(id: string, sourceEntryIds: string[]): Observation {
	return { id, kind: "observation", content: `Observation ${id}`, createdAt: "2026-05-19 00:00", timestamp: "2026-05-19 00:00", sourceEntryIds };
}

function reflection(id: string, sources: string[]): Reflection {
	return { id, kind: "reflection", content: `Reflection ${id}`, sources, createdAt: "2026-05-19T00:00:00.000Z" };
}

function observationsEntry(id: string, observations: Observation[], coversUpToId = "src-1"): Entry {
	return { type: "custom", id, customType: OM_OBSERVATIONS_RECORDED, data: { observations, coversUpToId } };
}

function reflectionsEntry(id: string, reflections: Reflection[], coversUpToId = "src-1"): Entry {
	return { type: "custom", id, timestamp: "2026-05-19T00:00:00.000Z", customType: OM_REFLECTIONS_RECORDED, data: { reflections, coversUpToId } };
}

function reflectionsRewrittenEntry(id: string, retiredReflectionIds: string[]): Entry {
	return { type: "custom", id, customType: OM_REFLECTIONS_REWRITTEN, data: { retiredReflectionIds, summary: "merged" } };
}

describe("session-ledger recall", () => {
	it("recalls an active observation with source entries", () => {
		const entries = [sourceEntry("src-1", "important source"), observationsEntry("obs-entry-1", [observation(OBS_1, ["src-1"])])];

		const result = recallMemorySources(entries, OBS_1);

		expect(result.status).toBe("found");
		if (result.status !== "found") return;
		expect(result.kind).toBe("observation");
		expect(result.observations[0].observation.id).toBe(OBS_1);
		expect(result.observations[0].status).toBe("active");
		expect(result.observations[0].sourceEntries.map((entry) => entry.id)).toEqual(["src-1"]);
		expect(result.partial).toBe(false);
	});

	it("accepts legacy ids at the recall boundary", () => {
		const entries = [sourceEntry("src-1"), observationsEntry("obs-entry-1", [observation(OBS_1, ["src-1"])])];

		const result = recallMemorySources(entries, "aaaaaaaaaaaa");

		expect(result.status).toBe("found");
		if (result.status !== "found") return;
		expect(result.observations[0].observation.id).toBe(OBS_1);
	});

	it("recalls a reflection with supporting observations", () => {
		const entries = [
			sourceEntry("src-1"),
			sourceEntry("src-2"),
			observationsEntry("obs-entry-1", [observation(OBS_1, ["src-1"]), observation(OBS_2, ["src-2"])]),
			reflectionsEntry("ref-entry-1", [reflection(REF_1, [OBS_1, OBS_2])]),
		];

		const result = recallMemorySources(entries, REF_1);

		expect(result.status).toBe("found");
		if (result.status !== "found") return;
		expect(result.kind).toBe("reflection");
		expect(result.reflections.map((match) => match.reflection.id)).toEqual([REF_1]);
		expect(result.observations.map((match) => match.observation.id)).toEqual([OBS_1, OBS_2]);
		expect(result.sourceEntries.map((entry) => entry.id)).toEqual(["src-1", "src-2"]);
		expect(result.partial).toBe(false);
	});

	it("recalls transitive ref-to-ref supporting observations", () => {
		const entries = [
			sourceEntry("src-1"),
			observationsEntry("obs-entry-1", [observation(OBS_1, ["src-1"])]),
			reflectionsEntry("ref-entry-1", [reflection(REF_1, [OBS_1])]),
			reflectionsEntry("ref-entry-2", [reflection(REF_2, [REF_1])]),
		];

		const result = recallMemorySources(entries, REF_2);

		expect(result.status).toBe("found");
		if (result.status !== "found") return;
		expect(result.reflections.map((match) => match.reflection.id)).toEqual([REF_2]);
		expect(result.supportingReflections.map((match) => match.reflection.id)).toEqual([REF_1]);
		expect(result.provenanceEdges).toEqual([{ fromId: REF_2, toId: REF_1 }, { fromId: REF_1, toId: OBS_1 }]);
		expect(result.observations.map((match) => match.observation.id)).toEqual([OBS_1]);
		expect(result.sourceEntries.map((entry) => entry.id)).toEqual(["src-1"]);
		expect(result.partial).toBe(false);
	});

	it("recalls through rewritten retired reflection chains", () => {
		const entries = [
			sourceEntry("src-1"),
			observationsEntry("obs-entry-1", [observation(OBS_1, ["src-1"])]),
			reflectionsEntry("ref-entry-1", [reflection(REF_1, [OBS_1])]),
			reflectionsRewrittenEntry("rewrite-entry-1", [REF_1]),
			reflectionsEntry("ref-entry-2", [reflection(REF_2, [REF_1])]),
		];

		const result = recallMemorySources(entries, REF_2);

		expect(result.status).toBe("found");
		if (result.status !== "found") return;
		expect(result.reflections.map((match) => match.reflection.id)).toEqual([REF_2]);
		expect(result.supportingReflections.map((match) => match.reflection.id)).toEqual([REF_1]);
		expect(result.provenanceEdges).toEqual([{ fromId: REF_2, toId: REF_1 }, { fromId: REF_1, toId: OBS_1 }]);
		expect(result.observations.map((match) => match.observation.id)).toEqual([OBS_1]);
		expect(result.sourceEntries.map((entry) => entry.id)).toEqual(["src-1"]);
		expect(result.partial).toBe(false);
	});

	it("recalls retired reflections directly for evidence lookup", () => {
		const entries = [
			sourceEntry("src-1"),
			observationsEntry("obs-entry-1", [observation(OBS_1, ["src-1"])]),
			reflectionsEntry("ref-entry-1", [reflection(REF_1, [OBS_1])]),
			reflectionsRewrittenEntry("rewrite-entry-1", [REF_1]),
		];

		const result = recallMemorySources(entries, REF_1);

		expect(result.status).toBe("found");
		if (result.status !== "found") return;
		expect(result.kind).toBe("reflection");
		expect(result.reflections.map((match) => match.reflection.id)).toEqual([REF_1]);
		expect(result.observations.map((match) => match.observation.id)).toEqual([OBS_1]);
		expect(result.sourceEntries.map((entry) => entry.id)).toEqual(["src-1"]);
		expect(result.partial).toBe(false);
	});

	it("reports missing and non-source source ids as partial recall", () => {
		const entries = [nonSourceEntry("custom-1"), observationsEntry("obs-entry-1", [observation(OBS_1, ["missing-src", "custom-1"])])];

		const result = recallMemorySources(entries, OBS_1);

		expect(result.status).toBe("found");
		if (result.status !== "found") return;
		expect(result.partial).toBe(true);
		expect(result.missingSourceEntryIds).toEqual(["missing-src"]);
		expect(result.nonSourceEntryIds).toEqual(["custom-1"]);
		expect(result.observations[0].sourceEntries).toEqual([]);
	});

	it("reports missing supporting observations as partial reflection recall", () => {
		const entries = [reflectionsEntry("ref-entry-1", [reflection(REF_1, [MISSING_OBS])])];

		const result = recallMemorySources(entries, REF_1);

		expect(result.status).toBe("found");
		if (result.status !== "found") return;
		expect(result.partial).toBe(true);
		expect(result.missingSupportingObservationIds).toEqual([MISSING_OBS]);
		expect(result.provenanceEdges).toEqual([{ fromId: REF_1, toId: MISSING_OBS }]);
		expect(result.observations).toEqual([]);
	});

	it("reports missing supporting reflections as partial reflection recall", () => {
		const entries = [reflectionsEntry("ref-entry-1", [reflection(REF_1, [MISSING_REF])])];

		const result = recallMemorySources(entries, REF_1);

		expect(result.status).toBe("found");
		if (result.status !== "found") return;
		expect(result.partial).toBe(true);
		expect(result.missingSupportingReflectionIds).toEqual([MISSING_REF]);
		expect(result.provenanceEdges).toEqual([{ fromId: REF_1, toId: MISSING_REF }]);
	});

	it("supports explicit depth-limited ref traversal", () => {
		const entries = [
			sourceEntry("src-1"),
			observationsEntry("obs-entry-1", [observation(OBS_1, ["src-1"])]),
			reflectionsEntry("ref-entry-1", [reflection(REF_1, [OBS_1])]),
			reflectionsEntry("ref-entry-2", [reflection(REF_2, [REF_1])]),
			reflectionsEntry("ref-entry-3", [reflection(REF_3, [REF_2])]),
		];

		const result = recallMemorySources(entries, REF_3, { depth: 1 });

		expect(result.status).toBe("found");
		if (result.status !== "found") return;
		expect(result.partial).toBe(true);
		expect(result.supportingReflections.map((match) => match.reflection.id)).toEqual([REF_2]);
		expect(result.depthLimitedReflectionIds).toEqual([REF_1]);
		expect(result.observations).toEqual([]);
		expect(result.provenanceEdges).toEqual([{ fromId: REF_3, toId: REF_2 }, { fromId: REF_2, toId: REF_1 }]);
	});

	it("returns not_found for unknown ids", () => {
		const entries = [sourceEntry("src-1"), observationsEntry("obs-entry-1", [observation(OBS_1, ["src-1"])])];

		expect(recallMemorySources(entries, "ffffffffffff")).toMatchObject({ status: "not_found", memoryId: "ffffffffffff" });
	});
});
