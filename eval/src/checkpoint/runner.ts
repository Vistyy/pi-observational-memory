import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { runCheckpointEditor } from "../../../src/agents/checkpoint-editor/agent.js";
import type { MemoryAgentRequestDiagnostics, MemoryAgentUsage } from "../../../src/agents/common.js";
import { normalizeUsage, PI_USAGE_RECORDED, type UsageRecordedData } from "../../../src/usage.js";
import { runSessionReplayCase } from "./session-replay.js";
import type { EditorEvalCase, EvalCase, EvalRecord, EvalSummary, EvalUsageBucket, EvalUsageSummary, SessionReplayEvalCase } from "./types.js";

export type ResolvedEvalModel = { model: Model<any>; apiKey: string; headers?: Record<string, string> };

function emptyUsageBucket(): EvalUsageBucket {
	return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
}

function addUsage(bucket: EvalUsageBucket, usageValue: unknown): void {
	const usage = normalizeUsage(usageValue);
	bucket.requests++;
	bucket.input += usage.input;
	bucket.output += usage.output;
	bucket.cacheRead += usage.cacheRead;
	bucket.cacheWrite += usage.cacheWrite;
	bucket.totalTokens += usage.totalTokens;
	bucket.cost += usage.cost;
}

function summarizeEvalUsage(entries: Array<{ agent?: string; operation?: string; usage: unknown }>): EvalUsageSummary {
	const byAgent: Record<string, EvalUsageBucket> = {};
	const byOperation: Record<string, EvalUsageBucket> = {};
	for (const entry of entries) {
		const agent = entry.agent ?? "unknown";
		byAgent[agent] ??= emptyUsageBucket();
		addUsage(byAgent[agent], entry.usage);
		if (entry.operation) {
			byOperation[entry.operation] ??= emptyUsageBucket();
			addUsage(byOperation[entry.operation], entry.usage);
		}
	}
	return { byAgent, byOperation };
}

function isUsageRecordedData(value: unknown): value is UsageRecordedData {
	return !!value && typeof value === "object" && (value as { schemaVersion?: unknown }).schemaVersion === 1 && (value as { source?: unknown }).source === "extension" && (value as { usage?: unknown }).usage !== undefined;
}

function extractReplayUsage(result: Awaited<ReturnType<typeof runSessionReplayCase>>, thinking: ModelThinkingLevel): MemoryAgentUsage[] {
	const requestIndexes = new Map<string, number>();
	return result.appendedEntries
		.filter((entry) => entry.type === "custom" && entry.customType === PI_USAGE_RECORDED && isUsageRecordedData(entry.data))
		.map((entry) => entry.data as UsageRecordedData)
		.map((data) => {
			const agent = data.agent ?? "unknown";
			const requestIndex = (requestIndexes.get(agent) ?? 0) + 1;
			requestIndexes.set(agent, requestIndex);
			return {
				agent: data.agent === "observer" || data.agent === "checkpoint-editor" ? data.agent : undefined,
				requestIndex,
				model: data.model,
				thinkingLevel: thinking,
				durationMs: 0,
				usage: data.usage,
			};
		});
}

function extractReplayUsageSummary(result: Awaited<ReturnType<typeof runSessionReplayCase>>): EvalUsageSummary {
	return summarizeEvalUsage(result.appendedEntries
		.filter((entry) => entry.type === "custom" && entry.customType === PI_USAGE_RECORDED && isUsageRecordedData(entry.data))
		.map((entry) => entry.data as UsageRecordedData));
}

export function parseModelSpec(spec: string): [provider: string, id: string] {
	const [provider, ...rest] = spec.split("/");
	const id = rest.join("/");
	if (!provider || !id) throw new Error(`model must be provider/id, got: ${spec}`);
	return [provider, id];
}

export async function resolveModel(spec: string): Promise<ResolvedEvalModel> {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const [provider, id] = parseModelSpec(spec);
	const model = modelRegistry.find(provider, id) as Model<any> | undefined;
	if (!model) throw new Error(`unknown model: ${provider}/${id}`);
	const auth = await modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) throw new Error(`no API key for provider: ${provider}`);
	return { model, apiKey: auth.apiKey as string, headers: auth.headers as Record<string, string> | undefined };
}

async function runEditorCase(testCase: EditorEvalCase, resolved: ResolvedEvalModel, thinking: ModelThinkingLevel, iteration: number): Promise<EvalRecord> {
	const started = Date.now();
	const usage: MemoryAgentUsage[] = [];
	const requestDiagnostics: MemoryAgentRequestDiagnostics[] = [];
	const dir = await mkdtemp(join(tmpdir(), "om-checkpoint-eval-"));
	try {
		const result = await runCheckpointEditor({
			model: resolved.model,
			apiKey: resolved.apiKey,
			headers: resolved.headers,
			draftPath: join(dir, "checkpoint.md"),
			initialContent: testCase.initialContent,
			observationsText: testCase.observationsText,
			purpose: testCase.purpose,
			thinkingLevel: thinking,
			maxTurns: testCase.maxTurns ?? 6,
			onUsage: (entry) => usage.push(entry),
			onRequestDiagnostics: (entry) => requestDiagnostics.push(entry),
			pruneSizeGuidance: testCase.pruneSizeGuidance,
		});
		const grade = testCase.grade(result);
		const usageSummary = summarizeEvalUsage(usage.map((entry) => ({ agent: entry.agent, operation: entry.agent, usage: entry.usage })));
		return {
			kind: "editor",
			id: testCase.id,
			iteration,
			passed: grade.passed,
			reason: grade.reason,
			missing: grade.missing ?? [],
			incorrect: grade.incorrect ?? [],
			changed: result?.changed,
			content: result?.content,
			usage,
			requestDiagnostics,
			usageSummary,
			checkpointEditorMetrics: result?.metrics,
			durationMs: Date.now() - started,
			metadata: testCase.metadata,
			initialContent: testCase.initialContent,
			observationsText: testCase.observationsText,
		};
	} catch (error) {
		return runtimeErrorRecord(testCase.id, "editor", iteration, started, usage, error, testCase.metadata, requestDiagnostics);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function runReplayCase(testCase: SessionReplayEvalCase, resolved: ResolvedEvalModel, thinking: ModelThinkingLevel, iteration: number): Promise<EvalRecord> {
	const started = Date.now();
	try {
		const result = await runSessionReplayCase(testCase, resolved);
		const grade = testCase.grade(result);
		const usage = extractReplayUsage(result, thinking);
		return {
			kind: "session-replay",
			id: testCase.id,
			iteration,
			passed: grade.passed,
			reason: grade.reason,
			missing: grade.missing ?? [],
			incorrect: grade.incorrect ?? [],
			content: result.content,
			usage,
			usageSummary: extractReplayUsageSummary(result),
			durationMs: Date.now() - started,
			metadata: testCase.metadata,
			initialEntryCount: result.initialEntryCount,
			finalEntryCount: result.finalEntryCount,
			appendedEntryTypes: result.appendedEntries.map((entry) => entry.customType ?? entry.type),
			observationCount: result.observations.length,
			checkpointCount: result.checkpointCount,
			initialCheckpointCoverageObservationId: result.initialCheckpointCoverageObservationId,
			checkpointModes: result.checkpointModes,
			latestCheckpointMode: result.latestCheckpointMode,
			latestObservationIds: result.latestObservationIds,
			latestCoversUpToObservationId: result.latestCoversUpToObservationId,
			uncheckpointedObservationCount: result.uncheckpointedObservationCount,
		};
	} catch (error) {
		return runtimeErrorRecord(testCase.id, "session-replay", iteration, started, [], error, testCase.metadata);
	}
}

function runtimeErrorRecord(
	id: string,
	kind: "editor" | "session-replay",
	iteration: number,
	started: number,
	usage: MemoryAgentUsage[],
	error: unknown,
	metadata: Record<string, unknown> | undefined,
	requestDiagnostics?: MemoryAgentRequestDiagnostics[],
): EvalRecord {
	return {
		kind,
		id,
		iteration,
		passed: false,
		reason: "runtime error",
		missing: [],
		incorrect: [],
		usage,
		requestDiagnostics,
		durationMs: Date.now() - started,
		error: error instanceof Error ? error.message : String(error),
		metadata,
	};
}

export async function runCase(testCase: EvalCase, resolved: ResolvedEvalModel, thinking: ModelThinkingLevel, iteration: number): Promise<EvalRecord> {
	if (testCase.kind === "session-replay") return runReplayCase(testCase, resolved, thinking, iteration);
	return runEditorCase(testCase, resolved, thinking, iteration);
}

export async function runCases(args: {
	cases: EvalCase[];
	model: string;
	thinking: ModelThinkingLevel;
	repeat: number;
	failFast?: boolean;
}): Promise<EvalRecord[]> {
	const resolved = await resolveModel(args.model);
	const records: EvalRecord[] = [];
	for (let iteration = 1; iteration <= args.repeat; iteration++) {
		for (const testCase of args.cases) {
			const record = await runCase(testCase, resolved, args.thinking, iteration);
			records.push(record);
			if (args.failFast && !record.passed) return records;
		}
	}
	return records;
}

export function summarizeRecords(args: {
	records: EvalRecord[];
	startedAt: string;
	model: string;
	thinking: string;
	repeat: number;
}): EvalSummary {
	const caseIds = Array.from(new Set(args.records.map((record) => record.id))).sort();
	return {
		startedAt: args.startedAt,
		model: args.model,
		thinking: args.thinking,
		repeat: args.repeat,
		total: args.records.length,
		passed: args.records.filter((record) => record.passed).length,
		failed: args.records.filter((record) => !record.passed).length,
		cases: caseIds.map((id) => {
			const records = args.records.filter((record) => record.id === id);
			return { id, passed: records.filter((record) => record.passed).length, total: records.length };
		}),
	};
}

function shrinkPercent(record: EvalRecord): string {
	if (!record.initialContent || !record.content || record.initialContent.length === 0) return "n/a";
	return `${Math.round(((record.initialContent.length - record.content.length) / record.initialContent.length) * 10_000) / 100}%`;
}

function requestCount(record: EvalRecord): number {
	return record.usageSummary?.byAgent["checkpoint-editor"]?.requests ?? record.usage.length;
}

function printPruneDiagnosticTable(records: EvalRecord[]): void {
	const diagnosticRecords = records.filter((record) => record.metadata?.pruneDiagnostic === true);
	if (diagnosticRecords.length === 0) return;
	console.log("\nprune diagnostics:");
	console.log("case | fixture | variant | duration | requests | shrink | failed edits | oldText chars | newText chars");
	for (const record of diagnosticRecords) {
		const metrics = record.checkpointEditorMetrics;
		console.log([
			record.id,
			String(record.metadata?.fixtureType ?? "unknown"),
			String(record.metadata?.promptVariant ?? "unknown"),
			`${record.durationMs}ms`,
			String(requestCount(record)),
			shrinkPercent(record),
			String(metrics?.failedEditCalls ?? "n/a"),
			String(metrics?.editOldTextChars ?? "n/a"),
			String(metrics?.editNewTextChars ?? "n/a"),
		].join(" | "));
	}
}

export function printSummary(summary: EvalSummary, records: EvalRecord[]): void {
	console.log(`checkpoint evals: ${summary.passed}/${summary.total} passed`);
	for (const record of records) {
		const mark = record.passed ? "PASS" : "FAIL";
		const repeat = summary.repeat > 1 ? ` #${record.iteration}` : "";
		console.log(`${mark} ${record.id}${repeat} (${record.durationMs}ms): ${record.reason}`);
		if (record.missing.length) console.log(`  missing: ${record.missing.join(", ")}`);
		if (record.incorrect.length) console.log(`  incorrect: ${record.incorrect.join(", ")}`);
		if (record.error) console.log(`  error: ${record.error}`);
	}
	printPruneDiagnosticTable(records);
}

export async function writeArtifacts(outDir: string, summary: EvalSummary, records: EvalRecord[]): Promise<void> {
	await mkdir(outDir, { recursive: true });
	await writeFile(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
	await writeFile(join(outDir, "results.json"), `${JSON.stringify(records, null, 2)}\n`, "utf-8");
}
