import type { CheckpointEditorResult } from "../../../src/agents/checkpoint-editor/agent.js";
import type { Config } from "../../../src/config.js";
import type { Entry } from "../../../src/session-ledger/index.js";
import type { EditorEvalCase, Grade, SessionReplayEvalCase, SessionReplayResult } from "./types.js";

export function editorUpdateScenario(args: {
	id: string;
	initialContent: string;
	observationsText: string;
	maxTurns?: number;
	metadata?: Record<string, unknown>;
	grade: (result: CheckpointEditorResult | undefined) => Grade;
}): EditorEvalCase {
	return {
		kind: "editor",
		id: args.id,
		purpose: "update",
		initialContent: args.initialContent,
		observationsText: args.observationsText,
		maxTurns: args.maxTurns,
		metadata: args.metadata,
		grade: args.grade,
	};
}

export function editorPruneScenario(args: {
	id: string;
	initialContent: string;
	maxTurns?: number;
	pruneSizeGuidance?: string;
	metadata?: Record<string, unknown>;
	grade: (result: CheckpointEditorResult | undefined) => Grade;
}): EditorEvalCase {
	return {
		kind: "editor",
		id: args.id,
		purpose: "prune",
		initialContent: args.initialContent,
		observationsText: "",
		maxTurns: args.maxTurns,
		pruneSizeGuidance: args.pruneSizeGuidance,
		metadata: args.metadata,
		grade: args.grade,
	};
}

export function sessionReplayScenario(args: {
	id: string;
	sessionPath: string;
	throughEntryId: string;
	maxTurns?: number;
	runtimeConfig?: Partial<Config>;
	prepareEntries?: (entries: Entry[]) => Entry[];
	metadata?: Record<string, unknown>;
	grade: (result: SessionReplayResult | undefined) => Grade;
}): SessionReplayEvalCase {
	return {
		kind: "session-replay",
		id: args.id,
		sessionPath: args.sessionPath,
		throughEntryId: args.throughEntryId,
		maxTurns: args.maxTurns,
		runtimeConfig: args.runtimeConfig,
		prepareEntries: args.prepareEntries,
		metadata: args.metadata,
		grade: args.grade,
	};
}
