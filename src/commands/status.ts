import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { estimateStringTokens } from "../memory/token-estimate.js";
import type { MemoryLifecycle } from "../memory-update/lifecycle.js";
import type { Runtime } from "../runtime.js";
import { buildSessionMemoryState, type Entry } from "../session-ledger/index.js";
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

export async function runStatusCommand(args: unknown, ctx: any, runtime: Runtime, lifecycle: MemoryLifecycle): Promise<void> {
	runtime.ensureConfig(ctx.cwd);
	const mode = firstArg(args);
	if (mode && mode !== "full") {
		ctx.ui.notify("Usage: /om:status [full]", "info");
		return;
	}

	const entries = ctx.sessionManager.getBranch() as Entry[];
	const state = buildSessionMemoryState(entries);
	const folded = state.folded;
	const checkpoint = folded.checkpoint;
	const checkpointTokens = checkpoint ? estimateStringTokens(checkpoint.content) : 0;
	const health = lifecycle.status(entries);
	const lines = [
		"── Checkpoint ──",
		`Current:      ${checkpoint ? checkpoint.id : "none"}`,
		`Format:       ${checkpoint?.contentFormat ?? "none"}`,
		`Coverage:     ${folded.lastCheckpointCoverageObservationId ?? "none"}`,
		"",
		"── Next work ──",
		`Observe gap:    ${health.observeGap.toLocaleString()} records`,
		`Checkpoint gap: ${health.checkpointGap.toLocaleString()} observations`,
		`Prune due:      ${health.checkpointPruneDue ? "yes" : "no"}`,
	];

	if (mode === "full") {
		lines.push(
			"",
			"── Details ──",
			`Strategy: ${runtime.config.strategy}`,
			`Ledger observations: ${folded.observations.length.toLocaleString()} recorded`,
			`Checkpoint versions: ${folded.checkpoints.length.toLocaleString()} recorded`,
			`Checkpoint tokens: ${checkpoint ? `~${checkpointTokens.toLocaleString()} / ${runtime.config.checkpointPruneTargetTokens.toLocaleString()} target / ${runtime.config.checkpointPruneHardMaxTokens.toLocaleString()} hard max` : "none"}`,
		);
		const usage = summarizeUsage(entries);
		if (usage.total.totalTokens > 0 || usage.total.cost > 0) {
			lines.push("", "── Usage ──", formatUsageLine("Total", usage.total));
			for (const [agent, totals] of Array.from(usage.byAgent.entries()).sort(([a], [b]) => a.localeCompare(b))) {
				lines.push(formatUsageLine(agent, totals));
			}
		}
	}

	if (health.memoryUpdateInFlight || health.compactHookInFlight) {
		lines.push("", "── In flight ──");
		if (health.memoryUpdateInFlight) {
			const phase = health.memoryUpdatePhase ? ` (${health.memoryUpdatePhase})` : "";
			lines.push(`Memory update: running${phase}`);
		}
		if (health.compactHookInFlight) lines.push("Compaction hook: running");
	}

	if (health.lastObserverError || health.lastCheckpointEditorError) {
		lines.push("", "── Last error ──");
		if (health.lastObserverError) lines.push(`Observer: ${health.lastObserverError}`);
		if (health.lastCheckpointEditorError) lines.push(`CheckpointEditor: ${health.lastCheckpointEditorError}`);
	}

	ctx.ui.notify(lines.join("\n"), "info");
}

export function registerStatusCommand(pi: ExtensionAPI, runtime: Runtime, lifecycle: MemoryLifecycle): void {
	pi.registerCommand("om:status", {
		description: "Show observational memory checkpoint status",
		handler: async (args, ctx) => runStatusCommand(args, ctx, runtime, lifecycle),
	});
}
