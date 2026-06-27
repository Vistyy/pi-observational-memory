import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { runCheckpointEditor } from "../../../src/agents/checkpoint-editor/agent.js";
import type { MemoryAgentUsage } from "../../../src/agents/common.js";
import type { EvalCase, EvalRecord, EvalSummary } from "./types.js";

export type ResolvedEvalModel = { model: Model<any>; apiKey: string; headers?: Record<string, string> };

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

export async function runCase(testCase: EvalCase, resolved: ResolvedEvalModel, thinking: ModelThinkingLevel, iteration: number): Promise<EvalRecord> {
	const started = Date.now();
	const usage: MemoryAgentUsage[] = [];
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
		});
		const grade = testCase.grade(result);
		return {
			id: testCase.id,
			iteration,
			passed: grade.passed,
			reason: grade.reason,
			missing: grade.missing ?? [],
			incorrect: grade.incorrect ?? [],
			changed: result?.changed,
			content: result?.content,
			usage,
			durationMs: Date.now() - started,
			metadata: testCase.metadata,
		};
	} catch (error) {
		return {
			id: testCase.id,
			iteration,
			passed: false,
			reason: "runtime error",
			missing: [],
			incorrect: [],
			usage,
			durationMs: Date.now() - started,
			error: error instanceof Error ? error.message : String(error),
			metadata: testCase.metadata,
		};
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export async function runCases(args: {
	cases: EvalCase[];
	model: string;
	thinking: ModelThinkingLevel;
	repeat: number;
}): Promise<EvalRecord[]> {
	const resolved = await resolveModel(args.model);
	const records: EvalRecord[] = [];
	for (let iteration = 1; iteration <= args.repeat; iteration++) {
		for (const testCase of args.cases) records.push(await runCase(testCase, resolved, args.thinking, iteration));
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
}

export async function writeArtifacts(outDir: string, summary: EvalSummary, records: EvalRecord[]): Promise<void> {
	await mkdir(outDir, { recursive: true });
	await writeFile(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
	await writeFile(join(outDir, "results.json"), `${JSON.stringify(records, null, 2)}\n`, "utf-8");
}
