import { describe, expect, it } from "vitest";
import {
	OM_CHECKPOINT_COVERAGE_ADVANCED,
	OM_CHECKPOINT_RECORDED,
	OM_OBSERVATIONS_RECORDED,
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_REWRITTEN,
	buildCheckpointCoverageAdvancedData,
	buildCheckpointRecordedData,
	buildObservationsRecordedData,
	buildReflectionsRecordedData,
	buildReflectionsRewrittenData,
	isCheckpointCoverageAdvancedData,
	isCheckpointCoverageAdvancedEntry,
	isCheckpointMemoryDetails,
	isCheckpointRecordedData,
	isCheckpointRecordedEntry,
	isMemoryDetails,
	isObservationsRecordedData,
	isObservationsRecordedEntry,
	isReflection,
	isReflectionsRecordedData,
	isReflectionsRecordedEntry,
	isReflectionsRewrittenData,
	isReflectionsRewrittenEntry,
} from "../src/session-ledger/types.js";
import { checkpoint, checkpointCoverageAdvancedEntry, checkpointMemoryDetails, checkpointRecordedEntry, memoryDetails, observation, observationsRecordedEntry, reflection, reflectionsRecordedEntry, reflectionsRewrittenEntry } from "./fixtures/session.js";

describe("session-ledger type guards and builders", () => {
	const obs = observation("aaaaaaaaaaaa");
	const ref = reflection("eeeeeeeeeeee", [obs.id]);
	const check = checkpoint("cccccccccccc");

	it("exports the live custom type constants", () => {
		expect(OM_OBSERVATIONS_RECORDED).toBe("om.observations.recorded");
		expect(OM_REFLECTIONS_RECORDED).toBe("om.reflections.recorded");
		expect(OM_REFLECTIONS_REWRITTEN).toBe("om.reflections.rewritten");
		expect(OM_CHECKPOINT_RECORDED).toBe("om.checkpoint.recorded");
		expect(OM_CHECKPOINT_COVERAGE_ADVANCED).toBe("om.checkpoint.coverage_advanced");
	});

	it("accepts current ledger data", () => {
		expect(isObservationsRecordedData({ observations: [obs], coversUpToId: "raw-1" })).toBe(true);
		expect(isReflectionsRecordedData({ reflections: [ref], coversUpToId: "raw-1" })).toBe(true);
		expect(isReflectionsRecordedData({ reflections: [], coversUpToId: "raw-1" })).toBe(true);
		expect(isReflectionsRewrittenData({ retiredReflectionIds: [ref.id], summary: "merged" })).toBe(true);
		expect(isCheckpointRecordedData({ mode: "update", checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] })).toBe(true);
		expect(isCheckpointCoverageAdvancedData({ coversUpToObservationId: obs.id, observationIds: [obs.id], reason: "No changes." })).toBe(true);
	});

	it("rejects invalid ledger data", () => {
		expect(isObservationsRecordedData({ observations: [], coversUpToId: "raw-1" })).toBe(true);
		expect(isReflectionsRecordedData({ reflections: [{ ...ref, sources: [] }], coversUpToId: "raw-1" })).toBe(false);
		expect(isReflectionsRewrittenData({ retiredReflectionIds: [], summary: "" })).toBe(false);
		expect(isCheckpointRecordedData({ mode: "update", checkpoint: { ...check, content: "missing headings" }, coversUpToObservationId: obs.id, observationIds: [obs.id] })).toBe(false);
		expect(isCheckpointCoverageAdvancedData({ coversUpToObservationId: obs.id, observationIds: [obs.id], reason: "" })).toBe(false);
	});

	it("builders return marker data", () => {
		expect(buildObservationsRecordedData([], "raw-1")).toEqual({ observations: [], coversUpToId: "raw-1" });
		expect(buildReflectionsRecordedData([], "raw-1")).toEqual({ reflections: [], coversUpToId: "raw-1" });
		expect(buildReflectionsRewrittenData({ retiredReflectionIds: [ref.id], summary: "merged" })).toBeDefined();
		expect(buildCheckpointRecordedData({ mode: "update", checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] })).toBeDefined();
		expect(buildCheckpointCoverageAdvancedData({ coversUpToObservationId: obs.id, observationIds: [obs.id], reason: "No changes." })).toBeDefined();
	});

	it("recognizes memory entries and details", () => {
		expect(isObservationsRecordedEntry(observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }))).toBe(true);
		expect(isReflectionsRecordedEntry(reflectionsRecordedEntry("om-ref", { reflections: [ref], coversUpToId: "raw-1" }))).toBe(true);
		expect(isReflectionsRewrittenEntry(reflectionsRewrittenEntry("om-rw", { retiredReflectionIds: [ref.id], summary: "merged" }))).toBe(true);
		expect(isCheckpointRecordedEntry(checkpointRecordedEntry("om-check", { checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] }))).toBe(true);
		expect(isCheckpointCoverageAdvancedEntry(checkpointCoverageAdvancedEntry("om-check-coverage", { coversUpToObservationId: obs.id, observationIds: [obs.id] }))).toBe(true);
		expect(isMemoryDetails(memoryDetails({ reflections: [ref] }))).toBe(true);
		expect(isCheckpointMemoryDetails(checkpointMemoryDetails(check, { coversUpToObservationId: obs.id }))).toBe(true);
		expect(isMemoryDetails({ type: "om.folded", fullFold: false, observations: [obs], reflections: [ref] })).toBe(true);
		expect(isReflection({ ...ref, sources: undefined })).toBe(false);
	});
});
