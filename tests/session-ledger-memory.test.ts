import { describe, expect, it } from "vitest";
import { activeReflections } from "../src/session-ledger/active-memory.js";
import { buildCompactionMemory } from "../src/session-ledger/compaction-memory.js";
import { checkpoint, checkpointRecordedEntry, compactionEntry, memoryDetails, observation, observationsRecordedEntry, reflection, reflectionsRecordedEntry, reflectionsRewrittenEntry, rawMessage } from "./fixtures/session.js";

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

	it("compaction memory stores the latest checkpoint in details", () => {
		const obs = observation("aaaaaaaaaaaa");
		const check = checkpoint("cccccccccccc");
		const memory = buildCompactionMemory([
			rawMessage("raw-1", "source"),
			observationsRecordedEntry("om-obs", { observations: [obs], coversUpToId: "raw-1" }),
			checkpointRecordedEntry("om-check", { checkpoint: check, coversUpToObservationId: obs.id, observationIds: [obs.id] }),
		], {});

		expect(memory.checkpoint).toEqual(check);
		expect(memory.details).toEqual({ type: "om.checkpoint", checkpoint: check, coversUpToObservationId: obs.id });
	});
});
