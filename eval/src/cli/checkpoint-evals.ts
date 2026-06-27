import { join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { loadCheckpointEvalCases } from "../checkpoint/cases.js";
import { printSummary, runCases, summarizeRecords, writeArtifacts } from "../checkpoint/runner.js";

const DEFAULT_MODEL = "openai-codex/gpt-5.4-mini";
const THINKING_VALUES = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

type Args = {
	model: string;
	thinking: ModelThinkingLevel;
	caseIds?: Set<string>;
	json: boolean;
	repeat: number;
	outDir?: string;
	writeArtifacts: boolean;
};

function timestampForPath(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv: string[]): Args {
	let model = DEFAULT_MODEL;
	let thinking: ModelThinkingLevel = "low";
	let caseIds: Set<string> | undefined;
	let json = false;
	let repeat = 1;
	let outDir: string | undefined;
	let shouldWriteArtifacts = true;
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
		} else if (arg === "--repeat") {
			repeat = Number.parseInt(argv[++i] ?? "1", 10);
			if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer");
		} else if (arg === "--out") {
			outDir = argv[++i];
			if (!outDir) throw new Error("--out requires a path");
		} else if (arg === "--no-artifacts") shouldWriteArtifacts = false;
		else if (arg === "--json") json = true;
		else if (arg === "--help" || arg === "-h") {
			console.log("Usage: pnpm checkpoint-evals [--model provider/id] [--thinking low] [--case id[,id]] [--repeat N] [--out dir] [--no-artifacts] [--json]");
			process.exit(0);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return { model, thinking, caseIds, json, repeat, outDir, writeArtifacts: shouldWriteArtifacts };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const startedAt = new Date().toISOString();
	const cases = loadCheckpointEvalCases();
	const selected = args.caseIds ? cases.filter((testCase) => args.caseIds?.has(testCase.id)) : cases;
	if (selected.length === 0) throw new Error("no checkpoint eval cases selected");
	const records = await runCases({ cases: selected, model: args.model, thinking: args.thinking, repeat: args.repeat });
	const summary = summarizeRecords({ records, startedAt, model: args.model, thinking: args.thinking, repeat: args.repeat });
	if (args.writeArtifacts) {
		const outDir = args.outDir ?? join("runs", "checkpoint-evals", timestampForPath(new Date(startedAt)));
		await writeArtifacts(outDir, summary, records);
		if (!args.json) console.log(`artifacts: ${outDir}`);
	}
	if (args.json) console.log(JSON.stringify({ summary, records }, null, 2));
	else printSummary(summary, records);
	if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exitCode = 1;
});
