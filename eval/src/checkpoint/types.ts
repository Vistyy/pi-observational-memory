import type { MemoryAgentUsage } from "../../../src/agents/common.js";
import type { CheckpointEditorResult } from "../../../src/agents/checkpoint-editor/agent.js";

export type CheckpointEvalPurpose = "update" | "prune";

export type Grade = {
	passed: boolean;
	reason: string;
	missing?: string[];
	incorrect?: string[];
};

export type EvalCase = {
	id: string;
	purpose: CheckpointEvalPurpose;
	initialContent: string;
	observationsText: string;
	maxTurns?: number;
	metadata?: Record<string, unknown>;
	grade: (result: CheckpointEditorResult | undefined) => Grade;
};

export type EvalRecord = {
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
