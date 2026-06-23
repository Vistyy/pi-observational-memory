import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const DEBUG_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const DEBUG_LOG_SESSION_DIR_RELATIVE_PATH = join("observational-memory", "debug");

export interface DebugLogContext {
	enabled: boolean;
	cwd?: string;
	sessionId?: string;
	sessionFile?: string;
	runId?: string;
}

const storage = new AsyncLocalStorage<DebugLogContext>();

export function withDebugLogContext<T>(context: DebugLogContext, fn: () => T): T {
	const parent = storage.getStore();
	return storage.run({ ...parent, ...context }, fn);
}

export function safeDebugLogSessionId(sessionId: string | undefined): string | undefined {
	const trimmed = sessionId?.trim();
	if (!trimmed) return undefined;
	const sanitized = trimmed
		.replace(/[^A-Za-z0-9._-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 128);
	if (!/[A-Za-z0-9]/.test(sanitized)) return undefined;
	return sanitized;
}

export function debugLogRelativePath(context: Pick<DebugLogContext, "sessionId">): string | undefined {
	const safeSessionId = safeDebugLogSessionId(context.sessionId);
	return safeSessionId ? join(DEBUG_LOG_SESSION_DIR_RELATIVE_PATH, `${safeSessionId}.ndjson`) : undefined;
}

export function debugSessionMetadata(ctx: { sessionManager: { getSessionId?: () => string; getSessionFile?: () => string | undefined } }): { sessionId?: string; sessionFile?: string } {
	try {
		return {
			sessionId: ctx.sessionManager.getSessionId?.(),
			sessionFile: ctx.sessionManager.getSessionFile?.(),
		};
	} catch {
		return {};
	}
}

export function debugLog(event: string, data: Record<string, unknown> = {}): void {
	const context = storage.getStore();
	if (context?.enabled !== true) return;

	try {
		const relativePath = debugLogRelativePath(context);
		if (!relativePath) return;
		const path = join(getAgentDir(), relativePath);
		mkdirSync(dirname(path), { recursive: true });
		rotateIfNeeded(path);
		const payload = {
			ts: new Date().toISOString(),
			event,
			cwd: context.cwd,
			sessionId: context.sessionId,
			sessionFile: context.sessionFile,
			runId: context.runId,
			data,
		};
		appendFileSync(path, `${JSON.stringify(payload)}\n`, "utf-8");
	} catch {
		// Debug logging must never affect memory behavior.
	}
}

function rotateIfNeeded(path: string): void {
	if (!existsSync(path)) return;
	if (statSync(path).size < DEBUG_LOG_MAX_BYTES) return;
	const backupPath = `${path}.1`;
	if (existsSync(backupPath)) unlinkSync(backupPath);
	renameSync(path, backupPath);
}
