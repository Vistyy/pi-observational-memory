import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { runCheckpointEditor, type CheckpointEditorResult } from "../../../src/agents/checkpoint-editor/agent.js";
import { EMPTY_CHECKPOINT_MARKDOWN } from "../../../src/memory/checkpoint.js";
import type { MemoryAgentUsage } from "../../../src/agents/common.js";

type EvalCase = {
	id: string;
	purpose: "update" | "prune";
	initialContent: string;
	observationsText: string;
	maxTurns?: number;
	grade: (result: CheckpointEditorResult | undefined) => Grade;
};

type Grade = {
	passed: boolean;
	reason: string;
	missing?: string[];
	incorrect?: string[];
};

type EvalRecord = {
	id: string;
	passed: boolean;
	reason: string;
	missing: string[];
	incorrect: string[];
	changed?: boolean;
	content?: string;
	usage: MemoryAgentUsage[];
	durationMs: number;
	error?: string;
};

const DEFAULT_MODEL = "openai-codex/gpt-5.4-mini";
const THINKING_VALUES = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

function parseModelSpec(spec: string): [provider: string, id: string] {
	const [provider, ...rest] = spec.split("/");
	const id = rest.join("/");
	if (!provider || !id) throw new Error(`model must be provider/id, got: ${spec}`);
	return [provider, id];
}

function parseArgs(argv: string[]): { model: string; thinking: ModelThinkingLevel; caseIds?: Set<string>; json: boolean } {
	let model = DEFAULT_MODEL;
	let thinking: ModelThinkingLevel = "low";
	let caseIds: Set<string> | undefined;
	let json = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--") continue;
		if (arg === "--model") model = argv[++i] ?? model;
		else if (arg === "--thinking") {
			const value = argv[++i];
			if (!THINKING_VALUES.has(value)) throw new Error(`unknown thinking level: ${value}`);
			thinking = value as ModelThinkingLevel;
		} else if (arg === "--case") {
			caseIds = new Set((argv[++i] ?? "").split(",").map((id) => id.trim()).filter(Boolean));
		} else if (arg === "--json") json = true;
		else if (arg === "--help" || arg === "-h") {
			console.log("Usage: pnpm checkpoint-evals [--model provider/id] [--thinking low] [--case id[,id]] [--json]");
			process.exit(0);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return { model, thinking, caseIds, json };
}

function includesAll(content: string, terms: string[]): string[] {
	const lower = content.toLowerCase();
	return terms.filter((term) => !lower.includes(term.toLowerCase()));
}

function forbidsAny(content: string, terms: string[]): string[] {
	const lower = content.toLowerCase();
	return terms.filter((term) => lower.includes(term.toLowerCase()));
}

function gradeContent(result: CheckpointEditorResult | undefined, args: { requireChanged?: boolean; requireUnchanged?: boolean; requireAll?: string[]; forbidAny?: string[] }): Grade {
	if (!result) return { passed: false, reason: "checkpoint editor did not finish", missing: ["finish_checkpoint_edit"] };
	const missing = includesAll(result.content, args.requireAll ?? []);
	const incorrect = forbidsAny(result.content, args.forbidAny ?? []);
	if (args.requireChanged === true && !result.changed) missing.push("changed checkpoint");
	if (args.requireUnchanged === true && result.changed) incorrect.push("changed checkpoint for already-covered observations");
	return {
		passed: missing.length === 0 && incorrect.length === 0,
		reason: missing.length === 0 && incorrect.length === 0 ? "mechanical checks passed" : "mechanical checks failed",
		missing,
		incorrect,
	};
}

const baseWithObjective = EMPTY_CHECKPOINT_MARKDOWN.replace("None known.", "Continue OM checkpoint migration.");

const cases: EvalCase[] = [
	{
		id: "checkpoint-preserves-operational-anchors",
		purpose: "update",
		initialContent: EMPTY_CHECKPOINT_MARKDOWN,
		observationsText: [
			"Observation 1:",
			"id: obs_111111111111",
			"time: 2026-06-26T10:00:00.000Z",
			"sourceEntryIds: user-1, tool-1",
			"content: Current task is migrating OM to checkpoint memory in /home/syzom/projects/pi-extensions/pi-observational-memory. Validation passed with `pnpm typecheck && pnpm test -- --reporter=dot`, 14 test files and 85 tests passed.",
		].join("\n"),
		maxTurns: 8,
		grade: (result) => gradeContent(result, {
			requireChanged: true,
			requireAll: ["/home/syzom/projects/pi-extensions/pi-observational-memory", "pnpm typecheck", "pnpm test", "14", "85"],
		}),
	},
	{
		id: "checkpoint-replaces-stale-current-detail",
		purpose: "update",
		initialContent: baseWithObjective.replace("None known.", "apiMode=legacy is the current API mode."),
		observationsText: [
			"Observation 1:",
			"id: obs_222222222222",
			"time: 2026-06-26T10:05:00.000Z",
			"sourceEntryIds: user-2",
			"content: The old apiMode=legacy statement is stale. Current API mode is apiMode=streaming, and legacy must not guide implementation.",
		].join("\n"),
		grade: (result) => gradeContent(result, {
			requireChanged: true,
			requireAll: ["apiMode=streaming", "legacy", "stale"],
			forbidAny: ["apiMode=legacy is the current API mode"],
		}),
	},
	{
		id: "checkpoint-noops-already-covered-observation",
		purpose: "update",
		initialContent: baseWithObjective.replace("None known.", "Checkpoint updates preserve exact commands, paths, ids, blockers, and stale/current transitions."),
		observationsText: [
			"Observation 1:",
			"id: obs_333333333333",
			"time: 2026-06-26T10:10:00.000Z",
			"sourceEntryIds: user-3",
			"content: Reminder: checkpoint updates should preserve exact commands, paths, ids, blockers, and stale/current transitions.",
		].join("\n"),
		grade: (result) => gradeContent(result, {
			requireUnchanged: true,
			requireAll: ["exact commands", "paths", "ids", "blockers", "stale/current"],
		}),
	},
];

async function resolveModel(spec: string): Promise<{ model: Model<any>; apiKey: string; headers?: Record<string, string> }> {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const [provider, id] = parseModelSpec(spec);
	const model = modelRegistry.find(provider, id) as Model<any> | undefined;
	if (!model) throw new Error(`unknown model: ${provider}/${id}`);
	const auth = await modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) throw new Error(`no API key for provider: ${provider}`);
	return { model, apiKey: auth.apiKey as string, headers: auth.headers as Record<string, string> | undefined };
}

async function runCase(testCase: EvalCase, resolved: { model: Model<any>; apiKey: string; headers?: Record<string, string> }, thinking: ModelThinkingLevel): Promise<EvalRecord> {
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
			passed: grade.passed,
			reason: grade.reason,
			missing: grade.missing ?? [],
			incorrect: grade.incorrect ?? [],
			changed: result?.changed,
			content: result?.content,
			usage,
			durationMs: Date.now() - started,
		};
	} catch (error) {
		return {
			id: testCase.id,
			passed: false,
			reason: "runtime error",
			missing: [],
			incorrect: [],
			usage,
			durationMs: Date.now() - started,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function printSummary(records: EvalRecord[]): void {
	const passed = records.filter((record) => record.passed).length;
	console.log(`checkpoint evals: ${passed}/${records.length} passed`);
	for (const record of records) {
		const mark = record.passed ? "PASS" : "FAIL";
		console.log(`${mark} ${record.id} (${record.durationMs}ms): ${record.reason}`);
		if (record.missing.length) console.log(`  missing: ${record.missing.join(", ")}`);
		if (record.incorrect.length) console.log(`  incorrect: ${record.incorrect.join(", ")}`);
		if (record.error) console.log(`  error: ${record.error}`);
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const selected = args.caseIds ? cases.filter((testCase) => args.caseIds?.has(testCase.id)) : cases;
	if (selected.length === 0) throw new Error("no checkpoint eval cases selected");
	const resolved = await resolveModel(args.model);
	const records: EvalRecord[] = [];
	for (const testCase of selected) records.push(await runCase(testCase, resolved, args.thinking));
	if (args.json) console.log(JSON.stringify(records, null, 2));
	else printSummary(records);
	if (records.some((record) => !record.passed)) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exitCode = 1;
});
