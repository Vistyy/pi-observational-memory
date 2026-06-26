import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../runtime.js";
import { foldLedger, observationToSummaryLine, type Entry } from "../session-ledger/index.js";

function firstArg(args: unknown): string | undefined {
	if (Array.isArray(args)) return typeof args[0] === "string" ? args[0] : undefined;
	if (typeof args === "string") return args.trim().split(/\s+/)[0];
	if (args && typeof args === "object" && "mode" in args) {
		const mode = (args as { mode?: unknown }).mode;
		return typeof mode === "string" ? mode : undefined;
	}
	return undefined;
}

export async function runViewCommand(args: unknown, ctx: any, runtime: Runtime): Promise<void> {
	runtime.ensureConfig(ctx.cwd);
	const entries = ctx.sessionManager.getBranch() as Entry[];
	const folded = foldLedger(entries);
	const mode = firstArg(args);

	const notifyView = (output: string) => ctx.ui.notify(output, "info");

	if (mode === "recorded") {
		notifyView(folded.observations.length > 0
			? folded.observations.map(observationToSummaryLine).join("\n")
			: "No recorded observations.");
		return;
	}

	if (mode && mode !== "context") {
		ctx.ui.notify("Usage: /om:view [context|recorded]", "info");
		return;
	}

	notifyView(folded.checkpoint?.content ?? "No checkpoint recorded.");
}

export function registerViewCommand(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerCommand("om:view", {
		description: "Print observational memory checkpoint content",
		handler: async (args, ctx) => runViewCommand(args, ctx, runtime),
	});
}
