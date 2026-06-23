import { describe, expect, it } from "vitest";
import { foldLedger } from "../src/session-ledger/fold.js";
import { observation, observationsRecordedEntry, reflection, reflectionsRecordedEntry, reflectionsRewrittenEntry, rawMessage } from "./fixtures/session.js";

describe("session-ledger folding", () => {
	it("folds typed observations and active reflections", () => {
		const obs = observation("aaaaaaaaaaaa");
		const ref = reflection("eeeeeeeeeeee", [obs.id]);
		const entries = [
			rawMessage("raw-1", "source"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [ref], coversUpToId: "raw-1" }),
		];

		const folded = foldLedger(entries);

		expect(folded.observations).toEqual([obs]);
		expect(folded.reflections).toEqual([ref]);
	});

	it("keeps first valid record for duplicate ids", () => {
		const firstObs = observation("aaaaaaaaaaaa", { content: "first" });
		const secondObs = observation("aaaaaaaaaaaa", { content: "second" });
		const firstRef = reflection("eeeeeeeeeeee", [firstObs.id], { content: "first ref" });
		const secondRef = reflection("eeeeeeeeeeee", [firstObs.id], { content: "second ref" });

		const folded = foldLedger([
			observationsRecordedEntry("om-obs", { observations: [firstObs, secondObs], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [firstRef, secondRef], coversUpToId: "raw-1" }),
		]);

		expect(folded.observations.map((obs) => obs.content)).toEqual(["first"]);
		expect(folded.reflections.map((ref) => ref.content)).toEqual(["first ref"]);
	});

	it("retires rewritten reflections from active fold while preserving lookup history", () => {
		const oldRef = reflection("eeeeeeeeeeee");
		const newRef = reflection("ffffffffffff", [oldRef.id]);
		const folded = foldLedger([
			reflectionsRecordedEntry("om-old", { reflections: [oldRef], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-new", { reflections: [newRef], coversUpToId: "raw-1" }),
			reflectionsRewrittenEntry("om-rw", { retiredReflectionIds: [oldRef.id], summary: "merged" }),
		]);

		expect(folded.reflections.map((ref) => ref.id)).toEqual([newRef.id]);
		expect(folded.retiredReflectionIds.has(oldRef.id)).toBe(true);
	});
});
