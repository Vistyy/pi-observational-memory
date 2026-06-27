import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MemoryLifecycle } from "../memory-update/lifecycle.js";

export function registerCompactionHook(pi: ExtensionAPI, lifecycle: MemoryLifecycle): void {
	(pi.on as any)("session_before_compact", async (event: any, ctx: any) => {
		const result = await lifecycle.prepareForCompaction(ctx, event.preparation ?? {});
		if (result.kind === "noop") return;
		if (result.kind === "cancel") return { cancel: true };
		return {
			compaction: {
				summary: result.summary,
				firstKeptEntryId: result.firstKeptEntryId,
				tokensBefore: result.tokensBefore,
				details: result.details,
			},
		};
	});
}
