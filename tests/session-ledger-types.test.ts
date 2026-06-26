import { describe, expect, it } from "vitest";
import {
	OM_CHECKPOINT_COVERAGE_ADVANCED,
	OM_CHECKPOINT_RECORDED,
	OM_OBSERVATIONS_RECORDED,
	buildCheckpointCoverageAdvancedData,
	buildCheckpointRecordedData,
	buildObservationsRecordedData,
	isCheckpointCoverageAdvancedData,
	isCheckpointCoverageAdvancedEntry,
	isCheckpointMemoryDetails,
	isCheckpointRecordedData,
	isCheckpointRecordedEntry,
	isObservationsRecordedData,
	isObservationsRecordedEntry,
} from "../src/session-ledger/types.js";
import { checkpoint, checkpointCoverageAdvancedEntry, checkpointMemoryDetails, checkpointRecordedEntry, observation, observationsRecordedEntry } from "./fixtures/session.js";

describe("session-ledger type guards and builders", () => {
	const obs = observation("aaaaaaaaaaaa");
	const check = checkpoint("cccccccccccc");

	it("exports the live custom type constants", () => {
		expect(OM_OBSERVATIONS_RECORDED).toBe("om.observations.recorded");
		expect(OM_CHECKPOINT_RECORDED).toBe("om.checkpoint.recorded");
		expect(OM_CHECKPOINT_COVERAGE_ADVANCED).toBe("om.checkpoint.coverage_advanced");
	});

	it("accepts current ledger data", () => {
		expect(isObservationsRecordedData({ observations: [obs], coversUpToId: "raw-1" })).toBe(true);
		expect(isCheckpointRecordedData({ mode: "update", checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] })).toBe(true);
		expect(isCheckpointCoverageAdvancedData({ coversUpToObservationId: obs.id, observationIds: [obs.id], reason: "No changes." })).toBe(true);
	});

	it("rejects invalid ledger data", () => {
		expect(isObservationsRecordedData({ observations: [], coversUpToId: "raw-1" })).toBe(true);
		expect(isCheckpointRecordedData({ mode: "update", checkpoint: { ...check, content: "missing headings" }, coversUpToObservationId: obs.id, observationIds: [obs.id] })).toBe(false);
		expect(isCheckpointCoverageAdvancedData({ coversUpToObservationId: obs.id, observationIds: [obs.id], reason: "" })).toBe(false);
	});

	it("builders return marker data", () => {
		expect(buildObservationsRecordedData([], "raw-1")).toEqual({ observations: [], coversUpToId: "raw-1" });
		expect(buildCheckpointRecordedData({ mode: "update", checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] })).toBeDefined();
		expect(buildCheckpointCoverageAdvancedData({ coversUpToObservationId: obs.id, observationIds: [obs.id], reason: "No changes." })).toBeDefined();
	});

	it("recognizes memory entries and details", () => {
		expect(isObservationsRecordedEntry(observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }))).toBe(true);
		expect(isCheckpointRecordedEntry(checkpointRecordedEntry("om-check", { checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] }))).toBe(true);
		expect(isCheckpointCoverageAdvancedEntry(checkpointCoverageAdvancedEntry("om-check-coverage", { coversUpToObservationId: obs.id, observationIds: [obs.id] }))).toBe(true);
		expect(isCheckpointMemoryDetails(checkpointMemoryDetails(check, { coversUpToObservationId: obs.id }))).toBe(true);
	});
});
