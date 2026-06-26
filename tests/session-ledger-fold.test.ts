import { describe, expect, it } from "vitest";
import { foldLedger } from "../src/session-ledger/fold.js";
import { checkpoint, checkpointCoverageAdvancedEntry, checkpointRecordedEntry, observation, observationsRecordedEntry, rawMessage } from "./fixtures/session.js";

describe("session-ledger folding", () => {
	it("folds typed observations", () => {
		const obs = observation("aaaaaaaaaaaa");
		const entries = [
			rawMessage("raw-1", "source"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
		];

		const folded = foldLedger(entries);

		expect(folded.observations).toEqual([obs]);
		expect(folded.lastObservationCoverageId).toBe("raw-1");
	});

	it("keeps first valid observation record for duplicate ids", () => {
		const firstObs = observation("aaaaaaaaaaaa", { content: "first" });
		const secondObs = observation("aaaaaaaaaaaa", { content: "second" });

		const folded = foldLedger([
			observationsRecordedEntry("om-obs", { observations: [firstObs, secondObs], coversUpToId: "raw-1" }),
		]);

		expect(folded.observations.map((obs) => obs.content)).toEqual(["first"]);
	});

	it("folds checkpoint snapshots and checkpoint coverage", () => {
		const obsA = observation("aaaaaaaaaaaa");
		const obsB = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-2"] });
		const checkA = checkpoint("cccccccccccc", { content: checkpoint("cccccccccccc").content.replace("None known.", "Initial objective.") });
		const folded = foldLedger([
			rawMessage("raw-1", "source 1"),
			rawMessage("raw-2", "source 2"),
			observationsRecordedEntry("om-obs", { observations: [obsA, obsB], coversUpToId: "raw-2" }),
			checkpointRecordedEntry("om-check", { checkpoint: checkA, coversUpToObservationId: obsA.id, observationIds: [obsA.id] }),
		]);

		expect(folded.checkpoint).toEqual(checkA);
		expect(folded.checkpoints).toEqual([checkA]);
		expect(folded.lastCheckpointCoverageObservationId).toBe(obsA.id);
		expect(folded.uncheckpointedObservations).toEqual([obsB]);
	});

	it("folds checkpoint coverage advancement without replacing the current checkpoint", () => {
		const obsA = observation("aaaaaaaaaaaa");
		const obsB = observation("bbbbbbbbbbbb", { sourceEntryIds: ["raw-2"] });
		const checkA = checkpoint("cccccccccccc");
		const folded = foldLedger([
			observationsRecordedEntry("om-obs", { observations: [obsA, obsB], coversUpToId: "raw-2" }),
			checkpointRecordedEntry("om-check", { checkpoint: checkA, coversUpToObservationId: obsA.id, observationIds: [obsA.id] }),
			checkpointCoverageAdvancedEntry("om-check-coverage", { coversUpToObservationId: obsB.id, observationIds: [obsB.id] }),
		]);

		expect(folded.checkpoint).toEqual(checkA);
		expect(folded.lastCheckpointCoverageObservationId).toBe(obsB.id);
		expect(folded.uncheckpointedObservations).toEqual([]);
	});
});
