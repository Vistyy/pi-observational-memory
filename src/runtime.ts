import { type Config, DEFAULTS, loadConfig } from "./config.js";

export type ResolveResult =
	| { ok: true; model: unknown; apiKey: string; headers?: Record<string, string> }
	| { ok: false; reason: string };

type NotifyLevel = "warning" | "info" | "error";
type Notify = (message: string, type?: NotifyLevel) => void;
export type MemoryUpdatePhase = "observer" | "reflector" | "maintainer" | "rewrite";

export type MaintainerSkip = {
	reason: string;
	reflectionCount: number;
};

export type RewriteSkip = {
	reason: string;
	reflectionCount: number;
	activeTokens: number;
	maxTokens?: number;
	resultReflectionCount?: number;
	resultTokens?: number;
};

export interface RuntimeCtx {
	model?: unknown;
	modelRegistry?: any;
	hasUI: boolean;
	ui?: { notify: Notify };
}

export class Runtime {
	config: Config = { ...DEFAULTS };
	configLoaded = false;
	memoryUpdateInFlight = false;
	inFlightObserverStagePromise: Promise<void> | null = null;
	memoryUpdatePhase: MemoryUpdatePhase | undefined;
	compactHookInFlight = false;
	resolveFailureNotified = false;
	lastObserverError: string | undefined;
	lastReflectorError: string | undefined;
	lastMaintainerError: string | undefined;
	lastMaintainerSkip: MaintainerSkip | undefined;
	lastRewriteSkip: RewriteSkip | undefined;
	rewriteSkippedActiveIds: Set<string> | undefined;

	ensureConfig(cwd: string): void {
		if (this.configLoaded) return;
		this.config = loadConfig(cwd);
		this.configLoaded = true;
	}

	async resolveModel(ctx: RuntimeCtx & { model: unknown; modelRegistry: any }): Promise<ResolveResult> {
		let model = ctx.model;
		if (this.config.model) {
			const configured = ctx.modelRegistry.find(this.config.model.provider, this.config.model.id);
			if (configured) {
				model = configured;
			} else if (ctx.hasUI && ctx.ui) {
				ctx.ui.notify(
					`Observational memory: configured model ${this.config.model.provider}/${this.config.model.id} not found, using session model`,
					"warning",
				);
			}
		}
		if (!model) return { ok: false, reason: "no model available (session has no model and no observational-memory model configured)" };
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) {
			const provider = (model as { provider?: string }).provider ?? "unknown";
			return { ok: false, reason: `no API key for provider "${provider}"` };
		}
		return { ok: true, model, apiKey: auth.apiKey as string, headers: auth.headers as Record<string, string> | undefined };
	}

	launchMemoryUpdateTask(ctx: RuntimeCtx, work: () => Promise<void>): Promise<void> {
		this.memoryUpdateInFlight = true;
		this.memoryUpdatePhase = undefined;
		this.lastObserverError = undefined;
		this.lastReflectorError = undefined;
		this.lastMaintainerError = undefined;
		return this.launchTrackedTask(ctx, "memory update", work, () => {
			this.memoryUpdateInFlight = false;
			this.memoryUpdatePhase = undefined;
		});
	}

	recordMemoryUpdateStageError(ctx: RuntimeCtx, phase: MemoryUpdatePhase, error: unknown): string {
		const message = error instanceof Error ? error.message : String(error);
		if (phase === "observer") this.lastObserverError = message;
		if (phase === "reflector") this.lastReflectorError = message;
		if (phase === "maintainer") this.lastMaintainerError = message;
		if (ctx.hasUI && ctx.ui) ctx.ui.notify(`Observational memory: ${phase} failed: ${message}`, "warning");
		return message;
	}

	private launchTrackedTask(
		ctx: RuntimeCtx,
		label: string,
		work: () => Promise<void>,
		onFinally: (error: string | undefined) => void,
	): Promise<void> {
		const hasUI = ctx.hasUI;
		const ui = ctx.ui;
		return (async () => {
			let errorMessage: string | undefined;
			try {
				await work();
			} catch (error) {
				errorMessage = error instanceof Error ? error.message : String(error);
				if (hasUI && ui) ui.notify(`Observational memory: ${label} failed: ${errorMessage}`, "warning");
			} finally {
				onFinally(errorMessage);
			}
		})();
	}
}
