import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { MemoryAgentUsage } from "../../../src/agents/common.js";
import type { Observation } from "../../../src/session-ledger/index.js";

export type ObserverGrader = {
	label: string;
	required?: boolean;
	pass: (output: Observation[] | undefined) => boolean;
	detail?: (output: Observation[] | undefined) => unknown;
};

export type ObserverScoreDimension = {
	label: string;
	required: boolean;
	passed: boolean;
	detail?: unknown;
};

export type ObserverScore = {
	hardFailed: boolean;
	score: number;
	maxScore: number;
	dimensions: ObserverScoreDimension[];
};

export type ObserverEvalRecord = {
	id: string;
	iteration: number;
	passed: boolean;
	reason: string;
	output: Observation[];
	missing: string[];
	incorrect: string[];
	durationMs: number;
	agentDurationMs?: number;
	usage: MemoryAgentUsage[];
	score: ObserverScore;
	diagnostics?: Record<string, unknown>;
	error?: string;
};

export type ObserverEvalCase = {
	id: string;
	suite: "baseline" | "stress";
	run: (args: {
		model: string;
		thinking: ModelThinkingLevel;
		iteration: number;
	}) => Promise<ObserverEvalRecord>;
};

export type ObserverEvalSummary = {
	startedAt: string;
	model: string;
	thinking: string;
	repeat: number;
	total: number;
	passed: number;
	failed: number;
	score: number;
	maxScore: number;
	cases: Array<{
		id: string;
		passed: number;
		total: number;
	}>;
};
