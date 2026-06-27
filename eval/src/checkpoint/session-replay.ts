import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULTS, STRATEGY, type Config } from "../../../src/config.js";
import { MemoryLifecycle } from "../../../src/memory-update/lifecycle.js";
import type { MemoryUpdateCtx } from "../../../src/memory-update/types.js";
import { Runtime } from "../../../src/runtime.js";
import { foldLedger, isCheckpointRecordedEntry, type Entry } from "../../../src/session-ledger/index.js";
import type { ResolvedEvalModel } from "./runner.js";
import { loadSessionEntries } from "./session-fixture.js";
import type { SessionReplayEvalCase, SessionReplayResult } from "./types.js";

function cloneEntries(entries: Entry[]): Entry[] {
	return JSON.parse(JSON.stringify(entries)) as Entry[];
}

function entriesThrough(entries: Entry[], entryId: string): Entry[] {
	const index = entries.findIndex((entry) => entry.id === entryId);
	if (index === -1) throw new Error(`session replay through entry not found: ${entryId}`);
	return cloneEntries(entries.slice(0, index + 1));
}

function createEvalContext(initialEntries: Entry[], resolved: ResolvedEvalModel, sessionPath: string): {
	pi: ExtensionAPI;
	ctx: MemoryUpdateCtx;
	getEntries: () => Entry[];
	appendedEntries: Entry[];
} {
	let entries = [...initialEntries];
	const appendedEntries: Entry[] = [];
	const appendEntry = (customType: string, data: unknown): string => {
		const id = `eval-appended-${appendedEntries.length + 1}`;
		const entry = {
			type: "custom",
			id,
			parentId: entries.at(-1)?.id ?? null,
			timestamp: new Date().toISOString(),
			customType,
			data,
		} as Entry;
		appendedEntries.push(entry);
		entries = [...entries, entry];
		return id;
	};
	const modelRegistry = {
		find: () => resolved.model,
		getApiKeyAndHeaders: async () => ({ ok: true, apiKey: resolved.apiKey, headers: resolved.headers }),
	};
	const ctx: MemoryUpdateCtx = {
		cwd: "/home/syzom/projects/pi-extensions/pi-observational-memory",
		hasUI: false,
		model: resolved.model,
		modelRegistry,
		sessionManager: {
			getBranch: () => entries,
			getSessionId: () => "019efee5-f8da-7fe4-a4a8-91009462be14",
			getSessionFile: () => sessionPath,
		},
	};
	return {
		pi: { appendEntry } as unknown as ExtensionAPI,
		ctx,
		getEntries: () => entries,
		appendedEntries,
	};
}

function createReplayRuntime(maxTurns: number | undefined, configOverrides: Partial<Config> | undefined): Runtime {
	const runtime = new Runtime();
	runtime.config = {
		...DEFAULTS,
		strategy: STRATEGY.replacement,
		observeEveryMessages: 1,
		observeHardCapRecords: 1,
		maxInitialObserveTokens: 1_000_000,
		agentMaxTurns: maxTurns ?? 8,
		observerThinking: "low",
		debugLog: false,
		...configOverrides,
	};
	runtime.configLoaded = true;
	return runtime;
}

export async function runSessionReplayCase(testCase: SessionReplayEvalCase, resolved: ResolvedEvalModel): Promise<SessionReplayResult> {
	const allEntries = loadSessionEntries(testCase.sessionPath);
	const replayEntries = entriesThrough(allEntries, testCase.throughEntryId);
	const initialEntries = testCase.prepareEntries?.(replayEntries) ?? replayEntries;
	const initialFolded = foldLedger(initialEntries);
	const { pi, ctx, getEntries, appendedEntries } = createEvalContext(initialEntries, resolved, testCase.sessionPath);
	const runtime = createReplayRuntime(testCase.maxTurns, testCase.runtimeConfig);
	const lifecycle = new MemoryLifecycle(pi, runtime);
	await lifecycle.runNow("turn_end", ctx);
	const finalEntries = getEntries();
	const folded = foldLedger(finalEntries);
	const checkpointEvents = appendedEntries.filter(isCheckpointRecordedEntry);
	const latestCheckpointEvent = checkpointEvents.at(-1);
	return {
		initialEntryCount: initialEntries.length,
		finalEntryCount: finalEntries.length,
		appendedEntries,
		observations: folded.observations,
		checkpoint: folded.checkpoint,
		content: folded.checkpoint?.content,
		checkpointCount: folded.checkpoints.length,
		initialCheckpointCoverageObservationId: initialFolded.lastCheckpointCoverageObservationId,
		checkpointModes: checkpointEvents.map((entry) => entry.data.mode),
		latestCheckpointMode: latestCheckpointEvent?.data.mode,
		latestObservationIds: latestCheckpointEvent?.data.observationIds ?? [],
		latestCoversUpToObservationId: latestCheckpointEvent?.data.coversUpToObservationId,
		uncheckpointedObservationCount: folded.uncheckpointedObservations.length,
	};
}
