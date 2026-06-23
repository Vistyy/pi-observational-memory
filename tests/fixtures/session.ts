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

export type TestReflection = {
	id: string;
	kind: "reflection";
	content: string;
	sources: string[];
	createdAt: string;
};

export const OM_OBSERVATIONS_RECORDED = "om.observations.recorded";
export const OM_REFLECTIONS_RECORDED = "om.reflections.recorded";
export const OM_REFLECTIONS_REWRITTEN = "om.reflections.rewritten";
export const OM_FOLDED = "om.folded";

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

export function memoryDetails(
	args: {
		reflections?: TestReflection[];
	} = {},
): unknown {
	return {
		type: OM_FOLDED,
		reflections: args.reflections ?? [],
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

export function reflection(
	id: string,
	sources: string[] = ["obs_aaaaaaaaaaaa"],
	overrides: Partial<TestReflection> = {},
): TestReflection {
	return {
		id: id.startsWith("ref_") ? id : `ref_${id}`,
		kind: "reflection",
		content: `Reflection ${id}`,
		sources: sources.map((source) => source.startsWith("obs_") || source.startsWith("ref_") ? source : `obs_${source}`),
		createdAt: DEFAULT_TIMESTAMP,
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

export function reflectionsRecordedEntry(
	id: string,
	args: { reflections: TestReflection[]; coversUpToId: string },
	overrides: Partial<TestEntry> = {},
): TestEntry {
	return {
		type: "custom",
		id,
		parentId: null,
		timestamp: DEFAULT_TIMESTAMP,
		customType: OM_REFLECTIONS_RECORDED,
		data: args,
		...overrides,
	};
}

export function reflectionsRewrittenEntry(
	id: string,
	args: {
		retiredReflectionIds: string[];
		summary?: string;
	},
	overrides: Partial<TestEntry> = {},
): TestEntry {
	return {
		type: "custom",
		id,
		parentId: null,
		timestamp: DEFAULT_TIMESTAMP,
		customType: OM_REFLECTIONS_REWRITTEN,
		data: args,
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
