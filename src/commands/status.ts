import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../runtime.js";
import { foldLedger, sourceEntriesAfterIndex, type Entry } from "../session-ledger/index.js";
import { PI_USAGE_RECORDED, normalizeUsage, type UsageTotals } from "../usage.js";

type UsageSummary = {
	total: UsageTotals;
	byAgent: Map<string, UsageTotals>;
};

function emptyUsage(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
}

function addUsage(target: UsageTotals, usage: UsageTotals): void {
	target.input += usage.input;
	target.output += usage.output;
	target.cacheRead += usage.cacheRead;
	target.cacheWrite += usage.cacheWrite;
	target.totalTokens += usage.totalTokens;
	target.cost += usage.cost;
}

function summarizeUsage(entries: Entry[]): UsageSummary {
	const summary: UsageSummary = { total: emptyUsage(), byAgent: new Map() };
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== PI_USAGE_RECORDED || !entry.data || typeof entry.data !== "object") continue;
		const data = entry.data as { extension?: unknown; agent?: unknown; usage?: unknown };
		if (data.extension !== "observational-memory") continue;
		const usage = normalizeUsage(data.usage);
		addUsage(summary.total, usage);
		const agent = typeof data.agent === "string" && data.agent ? data.agent : "unknown";
		const agentTotal = summary.byAgent.get(agent) ?? emptyUsage();
		addUsage(agentTotal, usage);
		summary.byAgent.set(agent, agentTotal);
	}
	return summary;
}

function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`;
}

function formatUsageLine(label: string, usage: UsageTotals): string {
	return `${label}: ~${usage.totalTokens.toLocaleString()} tokens, ${formatCost(usage.cost)}`;
}

function firstArg(args: unknown): string | undefined {
	if (Array.isArray(args)) return typeof args[0] === "string" ? args[0] : undefined;
	if (typeof args === "string") return args.trim().split(/\s+/)[0] || undefined;
	if (args && typeof args === "object" && "mode" in args) {
		const mode = (args as { mode?: unknown }).mode;
		return typeof mode === "string" ? mode : undefined;
	}
	return undefined;
}

export async function runStatusCommand(args: unknown, ctx: any, runtime: Runtime): Promise<void> {
	runtime.ensureConfig(ctx.cwd);
	const mode = firstArg(args);
	if (mode && mode !== "full") {
		ctx.ui.notify("Usage: /om:status [full]", "info");
		return;
	}

	const entries = ctx.sessionManager.getBranch() as Entry[];
	const folded = foldLedger(entries);
	const checkpoint = folded.checkpoint;
	const sourceGap = sourceEntriesAfterIndex(entries, folded.lastObservationCoverageIndex).length;
	const checkpointGap = folded.uncheckpointedObservations.length;
	const lines = [
		"── Checkpoint ──",
		`Current:      ${checkpoint ? checkpoint.id : "none"}`,
		`Format:       ${checkpoint?.contentFormat ?? "none"}`,
		`Coverage:     ${folded.lastCheckpointCoverageObservationId ?? "none"}`,
		"",
		"── Next work ──",
		`Observe gap:    ${sourceGap.toLocaleString()} source entries`,
		`Checkpoint gap: ${checkpointGap.toLocaleString()} observations`,
	];

	if (mode === "full") {
		lines.push(
			"",
			"── Details ──",
			`Strategy: ${runtime.config.strategy}`,
			`Ledger observations: ${folded.observations.length.toLocaleString()} recorded`,
			`Checkpoint versions: ${folded.checkpoints.length.toLocaleString()} recorded`,
		);
		const usage = summarizeUsage(entries);
		if (usage.total.totalTokens > 0 || usage.total.cost > 0) {
			lines.push("", "── Usage ──", formatUsageLine("Total", usage.total));
			for (const [agent, totals] of Array.from(usage.byAgent.entries()).sort(([a], [b]) => a.localeCompare(b))) {
				lines.push(formatUsageLine(agent, totals));
			}
		}
	}

	if (runtime.memoryUpdateInFlight || runtime.compactHookInFlight) {
		lines.push("", "── In flight ──");
		if (runtime.memoryUpdateInFlight) {
			const phase = runtime.memoryUpdatePhase ? ` (${runtime.memoryUpdatePhase})` : "";
			lines.push(`Memory update: running${phase}`);
		}
		if (runtime.compactHookInFlight) lines.push("Compaction hook: running");
	}

	if (runtime.lastObserverError || runtime.lastCheckpointEditorError) {
		lines.push("", "── Last error ──");
		if (runtime.lastObserverError) lines.push(`Observer: ${runtime.lastObserverError}`);
		if (runtime.lastCheckpointEditorError) lines.push(`CheckpointEditor: ${runtime.lastCheckpointEditorError}`);
	}

	ctx.ui.notify(lines.join("\n"), "info");
}

export function registerStatusCommand(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerCommand("om:status", {
		description: "Show observational memory checkpoint status",
		handler: async (args, ctx) => runStatusCommand(args, ctx, runtime),
	});
}
