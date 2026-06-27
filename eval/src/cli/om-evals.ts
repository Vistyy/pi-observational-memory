import { join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { loadCheckpointEvalCases } from "../checkpoint/cases.js";
import { printSummary, runCases, summarizeRecords, writeArtifacts } from "../checkpoint/runner.js";
import { loadObserverEvalCases } from "../observer/cases.js";
import { printObserverSummary, runObserverCases, summarizeObserverRecords, writeObserverArtifacts } from "../observer/runner.js";

const DEFAULT_MODEL = "openai-codex/gpt-5.4-mini";
const THINKING_VALUES = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

type Args = {
	model: string;
	thinking: ModelThinkingLevel;
	outDir?: string;
	failFast: boolean;
	json: boolean;
};

function timestampForPath(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv: string[]): Args {
	let model = DEFAULT_MODEL;
	let thinking: ModelThinkingLevel = "low";
	let outDir: string | undefined;
	let failFast = false;
	let json = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--") continue;
		if (arg === "--model") model = argv[++i] ?? model;
		else if (arg === "--thinking") {
			const value = argv[++i];
			if (!THINKING_VALUES.has(value)) throw new Error(`unknown thinking level: ${value}`);
			thinking = value as ModelThinkingLevel;
		} else if (arg === "--out") {
			outDir = argv[++i];
			if (!outDir) throw new Error("--out requires a path");
		} else if (arg === "--fail-fast") failFast = true;
		else if (arg === "--json") json = true;
		else if (arg === "--help" || arg === "-h") {
			console.log("Usage: pnpm om-evals [--model provider/id] [--thinking low] [--out dir] [--fail-fast] [--json]");
			process.exit(0);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return { model, thinking, outDir, failFast, json };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const startedAt = new Date().toISOString();
	const outDir = args.outDir ?? join("runs", "om-evals", timestampForPath(new Date(startedAt)));

	const observerRecords = await runObserverCases({
		cases: loadObserverEvalCases(),
		model: args.model,
		thinking: args.thinking,
		repeat: 1,
		failFast: args.failFast,
	});
	const observerSummary = summarizeObserverRecords({ records: observerRecords, startedAt, model: args.model, thinking: args.thinking, repeat: 1 });
	await writeObserverArtifacts(join(outDir, "observer"), observerSummary, observerRecords);
	if (args.failFast && observerSummary.failed > 0) {
		if (args.json) console.log(JSON.stringify({ observer: { summary: observerSummary, records: observerRecords } }, null, 2));
		else {
			console.log(`artifacts: ${outDir}`);
			printObserverSummary(observerSummary, observerRecords);
		}
		process.exitCode = 1;
		return;
	}

	const checkpointRecords = await runCases({
		cases: loadCheckpointEvalCases(),
		model: args.model,
		thinking: args.thinking,
		repeat: 1,
		failFast: args.failFast,
	});
	const checkpointSummary = summarizeRecords({ records: checkpointRecords, startedAt, model: args.model, thinking: args.thinking, repeat: 1 });
	await writeArtifacts(join(outDir, "checkpoint"), checkpointSummary, checkpointRecords);

	const total = observerSummary.total + checkpointSummary.total;
	const passed = observerSummary.passed + checkpointSummary.passed;
	const summary = {
		startedAt,
		model: args.model,
		thinking: args.thinking,
		passed,
		total,
		failed: total - passed,
		observer: observerSummary,
		checkpoint: checkpointSummary,
	};
	if (args.json) console.log(JSON.stringify({ summary, observerRecords, checkpointRecords }, null, 2));
	else {
		console.log(`artifacts: ${outDir}`);
		console.log(`om evals: ${passed}/${total} passed`);
		printObserverSummary(observerSummary, observerRecords);
		printSummary(checkpointSummary, checkpointRecords);
	}
	if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exitCode = 1;
});
