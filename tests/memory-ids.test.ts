import { describe, expect, it } from "vitest";
import { isLegacyMemoryId, isObservationId, isReflectionId, observationId, reflectionId } from "../src/memory/ids.js";

describe("memory ids", () => {
	it("normalizes legacy ids to typed observation/reflection ids", () => {
		expect(observationId("abcdef123456")).toBe("obs_abcdef123456");
		expect(reflectionId("abcdef123456")).toBe("ref_abcdef123456");
		expect(observationId("obs_abcdef123456")).toBe("obs_abcdef123456");
		expect(reflectionId("ref_abcdef123456")).toBe("ref_abcdef123456");
	});

	it("validates supported memory ids", () => {
		expect(isLegacyMemoryId("abcdef123456")).toBe(true);
		expect(isObservationId("obs_abcdef123456")).toBe(true);
		expect(isReflectionId("ref_abcdef123456")).toBe(true);
		expect(isObservationId("rw_abcdef123456")).toBe(false);
	});
});
