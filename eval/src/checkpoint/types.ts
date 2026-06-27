import type { MemoryAgentUsage } from "../../../src/agents/common.js";
import type { CheckpointEditorResult } from "../../../src/agents/checkpoint-editor/agent.js";
import type { Checkpoint, Entry, Observation } from "../../../src/session-ledger/index.js";

export type CheckpointEvalPurpose = "update" | "prune";

export type Grade = {
	passed: boolean;
	reason: string;
	missing?: string[];
	incorrect?: string[];
};

export type EditorEvalCase = {
	kind?: "editor";
	id: string;
	purpose: CheckpointEvalPurpose;
	initialContent: string;
	observationsText: string;
	maxTurns?: number;
	metadata?: Record<string, unknown>;
	grade: (result: CheckpointEditorResult | undefined) => Grade;
};

export type SessionReplayResult = {
	initialEntryCount: number;
	finalEntryCount: number;
	appendedEntries: Entry[];
	observations: Observation[];
	checkpoint?: Checkpoint;
	content?: string;
	checkpointCount: number;
	checkpointModes: Array<"update" | "prune">;
	latestCheckpointMode?: "update" | "prune";
	latestObservationIds: string[];
	latestCoversUpToObservationId?: string;
	uncheckpointedObservationCount: number;
};

export type SessionReplayEvalCase = {
	kind: "session-replay";
	id: string;
	sessionPath: string;
	throughEntryId: string;
	maxTurns?: number;
	metadata?: Record<string, unknown>;
	grade: (result: SessionReplayResult | undefined) => Grade;
};

export type EvalCase = EditorEvalCase | SessionReplayEvalCase;

export type EvalRecord = {
	kind: EvalCase["kind"] | "editor";
	id: string;
	iteration: number;
	passed: boolean;
	reason: string;
	missing: string[];
	incorrect: string[];
	changed?: boolean;
	content?: string;
	usage: MemoryAgentUsage[];
	durationMs: number;
	error?: string;
	metadata?: Record<string, unknown>;
	initialContent?: string;
	observationsText?: string;
	initialEntryCount?: number;
	finalEntryCount?: number;
	appendedEntryTypes?: string[];
	observationCount?: number;
	checkpointCount?: number;
	checkpointModes?: Array<"update" | "prune">;
	latestCheckpointMode?: "update" | "prune";
	latestObservationIds?: string[];
	latestCoversUpToObservationId?: string;
	uncheckpointedObservationCount?: number;
};

export type EvalSummary = {
	startedAt: string;
	model: string;
	thinking: string;
	repeat: number;
	total: number;
	passed: number;
	failed: number;
	cases: Array<{
		id: string;
		passed: number;
		total: number;
	}>;
};
