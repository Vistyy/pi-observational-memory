import { describe, expect, it } from "vitest";
import { buildSessionMemoryState, checkpointGap, currentCheckpointMemoryDetails, observerSourceEntriesAfterCoverage, uncheckpointedObservationsBeforeEntry } from "../src/session-ledger/memory-state.js";
import { checkpoint, checkpointRecordedEntry, observation, observationsRecordedEntry, rawMessage } from "./fixtures/session.js";

describe("session memory state", () => {
	it("finds observer source entries after current coverage", () => {
		const entries = [
			rawMessage("raw-1", "one"),
			observationsRecordedEntry("om-obs", { observations: [], coversUpToId: "raw-1" }),
			rawMessage("raw-2", "two"),
			rawMessage("raw-3", "three"),
		];
		const state = buildSessionMemoryState(entries);

		expect(observerSourceEntriesAfterCoverage(state).map((entry) => entry.id)).toEqual(["raw-2", "raw-3"]);
		expect(observerSourceEntriesAfterCoverage(state, "raw-3").map((entry) => entry.id)).toEqual(["raw-2"]);
	});

	it("finds uncheckpointed observations before a retained tail", () => {
		const obsA = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
		const obsB = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-3"] });
		const entries = [
			rawMessage("raw-1", "one"),
			rawMessage("raw-2", "two"),
			observationsRecordedEntry("om-obs", { observations: [obsA, obsB], coversUpToId: "raw-3" }),
			rawMessage("raw-3", "three"),
		];
		const state = buildSessionMemoryState(entries);

		expect(checkpointGap(state).map((observation) => observation.id)).toEqual([obsA.id, obsB.id]);
		expect(uncheckpointedObservationsBeforeEntry(state, "raw-2").map((observation) => observation.id)).toEqual([obsA.id]);
		expect(uncheckpointedObservationsBeforeEntry(state, "missing")).toEqual([]);
	});

	it("returns latest checkpoint memory details", () => {
		const obs = observation("aaaaaaaaaaaa");
		const check = checkpoint("cccccccccccc");
		const entries = [
			rawMessage("raw-1", "one"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			checkpointRecordedEntry("om-check", { checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] }),
		];
		const state = buildSessionMemoryState(entries);

		expect(currentCheckpointMemoryDetails(state)).toEqual({
			type: "om.checkpoint",
			checkpoint: check,
			coversUpToObservationId: obs.id,
		});
	});
});
