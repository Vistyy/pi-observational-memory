import { describe, expect, it } from "vitest";
import { activeReflections } from "../src/session-ledger/active-memory.js";
import { buildCompactionMemory } from "../src/session-ledger/compaction-memory.js";
import { compactionEntry, memoryDetails, observation, observationsRecordedEntry, reflection, reflectionsRecordedEntry, reflectionsRewrittenEntry, rawMessage } from "./fixtures/session.js";

describe("session-ledger active and compaction memory", () => {
	it("active reflections merge folded compaction details and current ledger reflections", () => {
		const refA = reflection("eeeeeeeeeeee");
		const refB = reflection("ffffffffffff");
		const entries = [
			compactionEntry("cmp", { details: memoryDetails({ reflections: [refA] }) }),
			rawMessage("raw-2", "source"),
			reflectionsRecordedEntry("om-ref", { reflections: [refB], coversUpToId: "raw-2" }),
		];

		expect(activeReflections(entries)).toEqual([refA, refB]);
	});

	it("rewrite events retire old reflections from active reflections", () => {
		const oldRef = reflection("eeeeeeeeeeee");
		const newRef = reflection("ffffffffffff", [oldRef.id]);
		const entries = [
			rawMessage("raw-1", "source"),
			reflectionsRecordedEntry("om-old", { reflections: [oldRef], coversUpToId: "raw-1" }),
			compactionEntry("cmp", { details: memoryDetails({ reflections: [oldRef] }) }),
			reflectionsRecordedEntry("om-new", { reflections: [newRef], coversUpToId: "raw-1" }),
			reflectionsRewrittenEntry("om-rw", { retiredReflectionIds: [oldRef.id], summary: "merged" }),
		];

		expect(activeReflections(entries).map((ref) => ref.id)).toEqual([newRef.id]);
	});

	it("compaction memory stores active reflections in details", () => {
		const obs = observation("aaaaaaaaaaaa");
		const ref = reflection("eeeeeeeeeeee", [obs.id]);
		const memory = buildCompactionMemory([
			rawMessage("raw-1", "source"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [ref], coversUpToId: "raw-1" }),
		], {});

		expect(memory.handoffObservations).toEqual([]);
		expect(memory.reflections).toEqual([ref]);
		expect(memory.details.reflections).toEqual([ref]);
	});

	it("compaction memory can include only bounded handoff observations", () => {
		const oldObs = observation("aaaaaaaaaaaa");
		const tailA = observation("bbbbbbbbbbbb", { content: "Tail A" });
		const tailB = observation("cccccccccccc", { content: "Tail B" });
		const ref = reflection("eeeeeeeeeeee", [oldObs.id]);
		const memory = buildCompactionMemory([
			rawMessage("raw-1", "source"),
			observationsRecordedEntry("om-obs", { observations: [oldObs], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [ref], coversUpToId: "raw-1" }),
		], { compactionHandoffObservationMaxCount: 1 }, { compactionHandoffObservations: [tailA, tailB] });

		expect(memory.handoffObservations).toEqual([tailA]);
		expect(memory.details.reflections).toEqual([ref]);
	});
});
