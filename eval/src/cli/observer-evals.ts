import { join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { loadObserverEvalCases } from "../observer/cases.js";
import { printObserverSummary, runObserverCases, summarizeObserverRecords, writeObserverArtifacts } from "../observer/runner.js";

const DEFAULT_MODEL = "openai-codex/gpt-5.4-mini";
const THINKING_VALUES = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

type Args = {
	model: string;
	thinking: ModelThinkingLevel;
	caseIds?: Set<string>;
	suite: "baseline" | "stress" | "all";
	json: boolean;
	repeat: number;
	outDir?: string;
	writeArtifacts: boolean;
	failFast: boolean;
};

function timestampForPath(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv: string[]): Args {
	let model = DEFAULT_MODEL;
	let thinking: ModelThinkingLevel = "low";
	let caseIds: Set<string> | undefined;
	let suite: Args["suite"] = "baseline";
	let json = false;
	let repeat = 1;
	let outDir: string | undefined;
	let shouldWriteArtifacts = true;
	let failFast = false;
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
		} else if (arg === "--suite") {
			const value = argv[++i] as Args["suite"];
			if (!["baseline", "stress", "all"].includes(value)) throw new Error(`unknown suite: ${value}`);
			suite = value;
		} else if (arg === "--repeat") {
			repeat = Number.parseInt(argv[++i] ?? "1", 10);
			if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer");
		} else if (arg === "--out") {
			outDir = argv[++i];
			if (!outDir) throw new Error("--out requires a path");
		} else if (arg === "--fail-fast") failFast = true;
		else if (arg === "--no-artifacts") shouldWriteArtifacts = false;
		else if (arg === "--json") json = true;
		else if (arg === "--help" || arg === "-h") {
			console.log("Usage: pnpm observer-evals [--model provider/id] [--thinking low] [--case id[,id]] [--suite baseline|stress|all] [--repeat N] [--out dir] [--fail-fast] [--no-artifacts] [--json]");
			process.exit(0);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return { model, thinking, caseIds, suite, json, repeat, outDir, writeArtifacts: shouldWriteArtifacts, failFast };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const startedAt = new Date().toISOString();
	const cases = loadObserverEvalCases();
	const suiteCases = cases.filter((testCase) => args.suite === "all" || testCase.suite === args.suite);
	const selected = args.caseIds ? suiteCases.filter((testCase) => args.caseIds?.has(testCase.id)) : suiteCases;
	if (selected.length === 0) throw new Error("no observer eval cases selected");
	const records = await runObserverCases({ cases: selected, model: args.model, thinking: args.thinking, repeat: args.repeat, failFast: args.failFast });
	const summary = summarizeObserverRecords({ records, startedAt, model: args.model, thinking: args.thinking, repeat: args.repeat });
	if (args.writeArtifacts) {
		const outDir = args.outDir ?? join("runs", "observer-evals", timestampForPath(new Date(startedAt)));
		await writeObserverArtifacts(outDir, summary, records);
		if (!args.json) console.log(`artifacts: ${outDir}`);
	}
	if (args.json) console.log(JSON.stringify({ summary, records }, null, 2));
	else printObserverSummary(summary, records);
	if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exitCode = 1;
});
