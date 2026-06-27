import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCompactionHook } from "./hooks/compaction-hook.js";
import { MemoryLifecycle } from "./memory-update/lifecycle.js";
import { registerMemoryUpdateHook } from "./hooks/memory-update-hook.js";
import { Runtime } from "./runtime.js";

export default function observationalMemory(pi: ExtensionAPI) {
	const runtime = new Runtime();
	const lifecycle = new MemoryLifecycle(pi, runtime);

	registerMemoryUpdateHook(pi, lifecycle);
	registerCompactionHook(pi, lifecycle);

	registerLazyStatusCommand(pi, runtime, lifecycle);
	registerLazyViewCommand(pi, runtime);
}

function registerLazyStatusCommand(pi: ExtensionAPI, runtime: Runtime, lifecycle: MemoryLifecycle): void {
	pi.registerCommand("om:status", {
		description: "Show observational memory status",
		handler: async (args, ctx) => {
			const { runStatusCommand } = await import("./commands/status.js");
			return runStatusCommand(args, ctx, runtime, lifecycle);
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


