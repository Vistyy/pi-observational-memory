import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MaintainerSkip, RewriteSkip, Runtime } from "../runtime.js";
import { reflectionsRecordedSinceLastRetirement } from "../memory-update/due.js";
import {
	activeReflections,
	foldLedger,
	reflectionTokenSum,
	sourceEntriesAfterIndex,
	type Entry,
} from "../session-ledger/index.js";
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

function formatMaintainerSkip(skip: MaintainerSkip): string {
	return `${skip.reason} (${skip.reflectionCount.toLocaleString()} reflections)`;
}

function formatRewriteSkip(skip: RewriteSkip): string {
	const parts = [`${skip.reason} (${skip.reflectionCount.toLocaleString()} reflections`, `~${skip.activeTokens.toLocaleString()} active tokens`];
	if (skip.maxTokens !== undefined) parts.push(`${skip.maxTokens.toLocaleString()} budget`);
	if (skip.resultTokens !== undefined) parts.push(`result ~${skip.resultTokens.toLocaleString()} tokens`);
	return `${parts.join(", ")})`;
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
	const reflections = activeReflections(entries);
	const contextTokens = reflectionTokenSum(reflections);
	const obsProgress = sourceEntriesAfterIndex(entries, folded.lastObservationCoverageIndex).length;
	const reflectionProgress = folded.unreflectedObservations.length;
	const maintenanceProgress = reflectionsRecordedSinceLastRetirement(entries);
	const maintainEveryNewReflections = runtime.config.maintainEveryNewReflections ?? 10;
	const lines = [
		"── Memory ──",
		`Context:      ${reflections.length.toLocaleString()} reflections`,
		`Size:         ~${contextTokens.toLocaleString()} context tokens; active reflections ~${contextTokens.toLocaleString()} / ${runtime.config.reflectionsPoolMaxTokens.toLocaleString()} budget tokens`,
		"",
		"── Next work ──",
		`Observe: ${obsProgress.toLocaleString()} / ${runtime.config.observeEveryMessages.toLocaleString()} source entries`,
		`Reflect: ${reflectionProgress.toLocaleString()} / ${runtime.config.reflectEveryObservations.toLocaleString()} observations`,
		`Maintain: ${maintenanceProgress.toLocaleString()} / ${maintainEveryNewReflections.toLocaleString()} new reflections`,
		`Rewrite: ~${contextTokens.toLocaleString()} / ${runtime.config.reflectionsPoolMaxTokens.toLocaleString()} active-reflection tokens`,
	];

	if (mode === "full") {
		lines.push(
			"",
			"── Details ──",
			`Strategy: ${runtime.config.strategy}`,
			`Ledger observations: ${folded.observations.length.toLocaleString()} recorded`,
			`Source entries since reflection cursor: ${sourceEntriesAfterIndex(entries, folded.lastReflectionCoverageIndex).length.toLocaleString()}`,
		);
		const usage = summarizeUsage(entries);
		if (usage.total.totalTokens > 0 || usage.total.cost > 0) {
			lines.push("", "── Usage ──", formatUsageLine("Total", usage.total));
			for (const [agent, totals] of Array.from(usage.byAgent.entries()).sort(([a], [b]) => a.localeCompare(b))) {
				lines.push(formatUsageLine(agent, totals));
			}
		}
	}

	if (runtime.lastMaintainerSkip || runtime.lastRewriteSkip) {
		lines.push("", "── Last skip ──");
		if (runtime.lastMaintainerSkip) lines.push(`Maintainer: ${formatMaintainerSkip(runtime.lastMaintainerSkip)}`);
		if (runtime.lastRewriteSkip) lines.push(`Rewrite: ${formatRewriteSkip(runtime.lastRewriteSkip)}`);
	}

	if (runtime.memoryUpdateInFlight || runtime.compactHookInFlight) {
		lines.push("", "── In flight ──");
		if (runtime.memoryUpdateInFlight) {
			const phase = runtime.memoryUpdatePhase ? ` (${runtime.memoryUpdatePhase})` : "";
			lines.push(`Memory update: running${phase}`);
		}
		if (runtime.compactHookInFlight) lines.push("Compaction hook: running");
	}

	if (runtime.lastObserverError || runtime.lastReflectorError || runtime.lastMaintainerError) {
		lines.push("", "── Last error ──");
		if (runtime.lastObserverError) lines.push(`Observer: ${runtime.lastObserverError}`);
		if (runtime.lastReflectorError) lines.push(`Reflector: ${runtime.lastReflectorError}`);
		if (runtime.lastMaintainerError) lines.push(`Maintainer: ${runtime.lastMaintainerError}`);
	}

	ctx.ui.notify(lines.join("\n"), "info");
}

export function registerStatusCommand(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerCommand("om:status", {
		description: "Show observational memory status",
		handler: async (args, ctx) => runStatusCommand(args, ctx, runtime),
	});
}
