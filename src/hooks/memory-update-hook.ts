import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MemoryLifecycle } from "../memory-update/lifecycle.js";
import type { MemoryUpdateTrigger } from "../memory-update/due.js";
import type { MemoryUpdateCtx } from "../memory-update/types.js";

export function registerMemoryUpdateHook(pi: ExtensionAPI, lifecycle: MemoryLifecycle): void {
	const launch = (trigger: MemoryUpdateTrigger) => (_event: unknown, ctx: MemoryUpdateCtx) => {
		lifecycle.handleTrigger(trigger, ctx);
	};
	pi.on("agent_start", launch("agent_start"));
	pi.on("message_end", launch("message_end"));
	pi.on("turn_end", launch("turn_end"));
}
