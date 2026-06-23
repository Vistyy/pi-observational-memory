import { describe, expect, it } from "vitest";
import {
	OM_OBSERVATIONS_RECORDED,
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_REWRITTEN,
	buildObservationsRecordedData,
	buildReflectionsRecordedData,
	buildReflectionsRewrittenData,
	isMemoryDetails,
	isObservationsRecordedData,
	isObservationsRecordedEntry,
	isReflection,
	isReflectionsRecordedData,
	isReflectionsRecordedEntry,
	isReflectionsRewrittenData,
	isReflectionsRewrittenEntry,
} from "../src/session-ledger/types.js";
import { memoryDetails, observation, observationsRecordedEntry, reflection, reflectionsRecordedEntry, reflectionsRewrittenEntry } from "./fixtures/session.js";

describe("session-ledger type guards and builders", () => {
	const obs = observation("aaaaaaaaaaaa");
	const ref = reflection("eeeeeeeeeeee", [obs.id]);

	it("exports the live custom type constants", () => {
		expect(OM_OBSERVATIONS_RECORDED).toBe("om.observations.recorded");
		expect(OM_REFLECTIONS_RECORDED).toBe("om.reflections.recorded");
		expect(OM_REFLECTIONS_REWRITTEN).toBe("om.reflections.rewritten");
	});

	it("accepts current ledger data", () => {
		expect(isObservationsRecordedData({ observations: [obs], coversUpToId: "raw-1" })).toBe(true);
		expect(isReflectionsRecordedData({ reflections: [ref], coversUpToId: "raw-1" })).toBe(true);
		expect(isReflectionsRecordedData({ reflections: [], coversUpToId: "raw-1" })).toBe(true);
		expect(isReflectionsRewrittenData({ retiredReflectionIds: [ref.id], summary: "merged" })).toBe(true);
	});

	it("rejects invalid ledger data", () => {
		expect(isObservationsRecordedData({ observations: [], coversUpToId: "raw-1" })).toBe(true);
		expect(isReflectionsRecordedData({ reflections: [{ ...ref, sources: [] }], coversUpToId: "raw-1" })).toBe(false);
		expect(isReflectionsRewrittenData({ retiredReflectionIds: [], summary: "" })).toBe(false);
	});

	it("builders return marker data", () => {
		expect(buildObservationsRecordedData([], "raw-1")).toEqual({ observations: [], coversUpToId: "raw-1" });
		expect(buildReflectionsRecordedData([], "raw-1")).toEqual({ reflections: [], coversUpToId: "raw-1" });
		expect(buildReflectionsRewrittenData({ retiredReflectionIds: [ref.id], summary: "merged" })).toBeDefined();
	});

	it("recognizes memory entries and details", () => {
		expect(isObservationsRecordedEntry(observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }))).toBe(true);
		expect(isReflectionsRecordedEntry(reflectionsRecordedEntry("om-ref", { reflections: [ref], coversUpToId: "raw-1" }))).toBe(true);
		expect(isReflectionsRewrittenEntry(reflectionsRewrittenEntry("om-rw", { retiredReflectionIds: [ref.id], summary: "merged" }))).toBe(true);
		expect(isMemoryDetails(memoryDetails({ reflections: [ref] }))).toBe(true);
		expect(isMemoryDetails({ type: "om.folded", fullFold: false, observations: [obs], reflections: [ref] })).toBe(true);
		expect(isReflection({ ...ref, sources: undefined })).toBe(false);
	});
});
