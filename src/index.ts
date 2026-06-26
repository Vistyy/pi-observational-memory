import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCompactionHook } from "./hooks/compaction-hook.js";
import { registerMemoryUpdateHook } from "./memory-update/scheduler.js";
import { Runtime } from "./runtime.js";

export default function observationalMemory(pi: ExtensionAPI) {
	const runtime = new Runtime();

	registerMemoryUpdateHook(pi, runtime);
	registerCompactionHook(pi, runtime);

	registerLazyStatusCommand(pi, runtime);
	registerLazyViewCommand(pi, runtime);
}

function registerLazyStatusCommand(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerCommand("om:status", {
		description: "Show observational memory status",
		handler: async (args, ctx) => {
			const { runStatusCommand } = await import("./commands/status.js");
			return runStatusCommand(args, ctx, runtime);
		},
	});
}

function registerLazyViewCommand(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerCommand("om:view", {
		description: "Print observational memory checkpoint content",
		handler: async (args, ctx) => {
			const { runViewCommand } = await import("./commands/view.js");
			return runViewCommand(args, ctx, runtime);
		},
	});
}

