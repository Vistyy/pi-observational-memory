export type TestEntry = {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
	message?: unknown;
	content?: unknown;
	customType?: string;
	summary?: unknown;
	data?: unknown;
	details?: unknown;
	firstKeptEntryId?: string;
	fromId?: string;
};

export type TestObservation = {
	id: string;
	kind: "observation";
	content: string;
	createdAt: string;
	timestamp: string;
	sourceEntryIds: string[];
};

export type TestCheckpoint = {
	id: string;
	content: string;
	createdAt: string;
	contentFormat: "markdown";
};

export const OM_OBSERVATIONS_RECORDED = "om.observations.recorded";
export const OM_CHECKPOINT_RECORDED = "om.checkpoint.recorded";
export const OM_CHECKPOINT_COVERAGE_ADVANCED = "om.checkpoint.coverage_advanced";
export const OM_CHECKPOINT = "om.checkpoint";

const DEFAULT_TIMESTAMP = "2026-05-02T10:00:00.000Z";

export function rawMessage(
	id: string,
	text: string,
	overrides: Partial<TestEntry> = {},
): TestEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: DEFAULT_TIMESTAMP,
		message: { role: "user", content: [{ type: "text", text }] },
		...overrides,
	};
}

export function customMessage(
	id: string,
	content: unknown,
	overrides: Partial<TestEntry> = {},
): TestEntry {
	return {
		type: "custom_message",
		id,
		parentId: null,
		timestamp: DEFAULT_TIMESTAMP,
		content,
		...overrides,
	};
}

export function textCustomMessage(
	id: string,
	text: string,
	overrides: Partial<TestEntry> = {},
): TestEntry {
	return customMessage(id, text, overrides);
}

export function branchSummary(
	id: string,
	summary: string,
	overrides: Partial<TestEntry> = {},
): TestEntry {
	return {
		type: "branch_summary",
		id,
		parentId: null,
		timestamp: DEFAULT_TIMESTAMP,
		summary,
		...overrides,
	};
}

export function compactionEntry(
	id: string,
	args: { firstKeptEntryId?: string; details?: unknown; summary?: string } = {},
	overrides: Partial<TestEntry> = {},
): TestEntry {
	return {
		type: "compaction",
		id,
		parentId: null,
		timestamp: DEFAULT_TIMESTAMP,
		firstKeptEntryId: args.firstKeptEntryId,
		summary: args.summary ?? "compacted memory",
		details: args.details,
		...overrides,
	};
}

export function checkpointMemoryDetails(
	checkpoint: TestCheckpoint,
	args: { coversUpToObservationId?: string } = {},
): unknown {
	return {
		type: OM_CHECKPOINT,
		checkpoint,
		...args,
	};
}

export function observation(
	id: string,
	overrides: Partial<TestObservation> = {},
): TestObservation {
	const sourceEntryIds = overrides.sourceEntryIds ?? ["raw-1"];
	return {
		id: id.startsWith("obs_") ? id : `obs_${id}`,
		kind: "observation",
		content: `Observation ${id}`,
		createdAt: DEFAULT_TIMESTAMP,
		timestamp: DEFAULT_TIMESTAMP,
		sourceEntryIds,
		...overrides,
	};
}

export function checkpoint(
	id: string,
	overrides: Partial<TestCheckpoint> = {},
): TestCheckpoint {
	return {
		id: id.startsWith("check_") ? id : `check_${id}`,
		content: `# Handoff\n\n## Focus\n\nNone known.\n\n## State\n\nNone known.\n\n## Next\n\nNone known.\n\n## References\n\nNone known.`,
		createdAt: DEFAULT_TIMESTAMP,
		contentFormat: "markdown",
		...overrides,
	};
}

export function observationsRecordedEntry(
	id: string,
	args: { observations: TestObservation[]; coversUpToId: string },
	overrides: Partial<TestEntry> = {},
): TestEntry {
	return {
		type: "custom",
		id,
		parentId: null,
		timestamp: DEFAULT_TIMESTAMP,
		customType: OM_OBSERVATIONS_RECORDED,
		data: args,
		...overrides,
	};
}

export function checkpointRecordedEntry(
	id: string,
	args: { checkpoint: TestCheckpoint; coversUpToObservationId: string; observationIds: string[]; mode?: "update" | "prune" },
	overrides: Partial<TestEntry> = {},
): TestEntry {
	return {
		type: "custom",
		id,
		parentId: null,
		timestamp: DEFAULT_TIMESTAMP,
		customType: OM_CHECKPOINT_RECORDED,
		data: { mode: args.mode ?? "update", checkpoint: args.checkpoint, coversUpToObservationId: args.coversUpToObservationId, observationIds: args.observationIds },
		...overrides,
	};
}

export function checkpointCoverageAdvancedEntry(
	id: string,
	args: { coversUpToObservationId: string; observationIds: string[]; reason?: string },
	overrides: Partial<TestEntry> = {},
): TestEntry {
	return {
		type: "custom",
		id,
		parentId: null,
		timestamp: DEFAULT_TIMESTAMP,
		customType: OM_CHECKPOINT_COVERAGE_ADVANCED,
		data: { coversUpToObservationId: args.coversUpToObservationId, observationIds: args.observationIds, reason: args.reason ?? "No checkpoint content change." },
		...overrides,
	};
}

export function fakeSessionContext(initialEntries: TestEntry[] = []) {
	let entries = [...initialEntries];
	return {
		appended: [] as Array<{ customType: string; data: unknown }>,
		sessionManager: {
			getBranch: () => entries,
			setBranch: (next: TestEntry[]) => {
				entries = next;
			},
			getLeafId: () => entries.at(-1)?.id,
		},
		appendEntry(customType: string, data: unknown) {
			this.appended.push({ customType, data });
			const entry = {
				type: "custom",
				id: `appended-${this.appended.length}`,
				parentId: entries.at(-1)?.id ?? null,
				timestamp: DEFAULT_TIMESTAMP,
				customType,
				data,
			};
			entries = [...entries, entry];
			return entry.id;
		},
	};
}

export function fakeCompactionContext(entries: TestEntry[]) {
	return {
		cwd: "/tmp/pi-observational-memory-test",
		sessionManager: {
			getBranch: () => entries,
		},
		isIdle: () => true,
		compactCalls: [] as unknown[],
		compact(arg?: unknown) {
			this.compactCalls.push(arg ?? true);
		},
	};
}
