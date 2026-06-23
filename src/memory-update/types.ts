import type { MemoryUpdatePhase, ResolveResult } from "../runtime.js";

export type ResolvedModel = Extract<ResolveResult, { ok: true }>;

export type MemoryUpdateCtx = {
	cwd: string;
	hasUI: boolean;
	ui?: { notify: (message: string, type?: "warning" | "info" | "error") => void };
	model: unknown;
	modelRegistry: any;
	sessionManager: {
		getBranch: () => unknown;
		getSessionId?: () => string;
		getSessionFile?: () => string | undefined;
	};
};

export type StageOutcome = "continue" | "abort";

export type ResolveMemoryModel = (stage: MemoryUpdatePhase) => Promise<ResolvedModel | undefined>;
