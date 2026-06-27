import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { runObserver } from "../../../src/agents/observer/agent.js";
import type { MemoryAgentUsage } from "../../../src/agents/common.js";
import { normalizeUsage } from "../../../src/usage.js";
import { resolveModel } from "../checkpoint/runner.js";
import type { ObserverEvalCase, ObserverEvalRecord, ObserverEvalSummary } from "./types.js";

export const OBSERVER_EVAL_MAX_TURNS = 4;

export async function runObserverEval(args: {
	id: string;
	model: string;
	thinking: ModelThinkingLevel;
	chunk: string;
	allowedSourceEntryIds: string[];
	iteration: number;
}): Promise<{ output: Awaited<ReturnType<typeof runObserver>>; usage: MemoryAgentUsage[]; agentDurationMs: number; error?: string }> {
	const resolved = await resolveModel(args.model);
	const usage: MemoryAgentUsage[] = [];
	const started = Date.now();
	try {
		const output = await runObserver({
			model: resolved.model,
			apiKey: resolved.apiKey,
			headers: resolved.headers,
			chunk: args.chunk,
			allowedSourceEntryIds: args.allowedSourceEntryIds,
			thinkingLevel: args.thinking,
			maxTurns: OBSERVER_EVAL_MAX_TURNS,
			onUsage: (entry) => usage.push(entry),
		});
		return { output, usage, agentDurationMs: Date.now() - started };
	} catch (error) {
		if (error instanceof Error && error.name === "MemoryAgentProviderError") {
			return { output: undefined, usage, agentDurationMs: Date.now() - started, error: error.message };
		}
		throw error;
	}
}

export async function runObserverCases(args: {
	cases: ObserverEvalCase[];
	model: string;
	thinking: ModelThinkingLevel;
	repeat: number;
	failFast?: boolean;
}): Promise<ObserverEvalRecord[]> {
	const records: ObserverEvalRecord[] = [];
	for (let iteration = 1; iteration <= args.repeat; iteration++) {
		for (const testCase of args.cases) {
			const record = await testCase.run({ model: args.model, thinking: args.thinking, iteration });
			records.push(record);
			if (args.failFast && !record.passed) return records;
		}
	}
	return records;
}

function usageTotals(records: ObserverEvalRecord[]): { requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: number } {
	const total = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
	for (const entry of records.flatMap((record) => record.usage)) {
		const usage = normalizeUsage(entry.usage);
		total.requests++;
		total.input += usage.input;
		total.output += usage.output;
		total.cacheRead += usage.cacheRead;
		total.cacheWrite += usage.cacheWrite;
		total.totalTokens += usage.totalTokens;
		total.cost += usage.cost;
	}
	return total;
}

export function summarizeObserverRecords(args: {
	records: ObserverEvalRecord[];
	startedAt: string;
	model: string;
	thinking: string;
	repeat: number;
}): ObserverEvalSummary & { usage: ReturnType<typeof usageTotals>; agentDurationMs: number } {
	const caseIds = Array.from(new Set(args.records.map((record) => record.id))).sort();
	return {
		startedAt: args.startedAt,
		model: args.model,
		thinking: args.thinking,
		repeat: args.repeat,
		total: args.records.length,
		passed: args.records.filter((record) => record.passed).length,
		failed: args.records.filter((record) => !record.passed).length,
		score: args.records.reduce((total, record) => total + record.score.score, 0),
		maxScore: args.records.reduce((total, record) => total + record.score.maxScore, 0),
		cases: caseIds.map((id) => {
			const records = args.records.filter((record) => record.id === id);
			return { id, passed: records.filter((record) => record.passed).length, total: records.length };
		}),
		usage: usageTotals(args.records),
		agentDurationMs: args.records.reduce((total, record) => total + (record.agentDurationMs ?? 0), 0),
	};
}

export function printObserverSummary(summary: ReturnType<typeof summarizeObserverRecords>, records: ObserverEvalRecord[]): void {
	console.log(`observer evals: ${summary.passed}/${summary.total} passed, score ${summary.score}/${summary.maxScore}`);
	for (const record of records) {
		const mark = record.passed ? "PASS" : "FAIL";
		const repeat = summary.repeat > 1 ? ` #${record.iteration}` : "";
		console.log(`${mark} ${record.id}${repeat} (${record.durationMs}ms): ${record.reason} score ${record.score.score}/${record.score.maxScore}`);
		if (record.missing.length) console.log(`  missing: ${record.missing.join("; ")}`);
		if (record.incorrect.length) console.log(`  incorrect: ${record.incorrect.join("; ")}`);
		if (record.error) console.log(`  error: ${record.error}`);
	}
}

export async function writeObserverArtifacts(outDir: string, summary: ReturnType<typeof summarizeObserverRecords>, records: ObserverEvalRecord[]): Promise<void> {
	await mkdir(outDir, { recursive: true });
	await writeFile(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
	await writeFile(join(outDir, "results.json"), `${JSON.stringify(records, null, 2)}\n`, "utf-8");
}
