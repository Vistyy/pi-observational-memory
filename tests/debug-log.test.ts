import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => mock.agentDir,
}));

import {
	debugLog,
	debugLogRelativePath,
	safeDebugLogSessionId,
	withDebugLogContext,
} from "../src/debug-log.js";

describe("debug logging", () => {
	let root: string;
	let agentDir: string;

	beforeEach(() => {
		root = `${tmpdir()}/om-debug-log-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		mock.agentDir = agentDir;
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function readJsonLines(path: string): Array<Record<string, unknown>> {
		return readFileSync(path, "utf-8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	}

	it("writes enabled events to a session-scoped debug file with session metadata", () => {
		withDebugLogContext({
			enabled: true,
			cwd: "/tmp/project",
			sessionId: "session-123",
			sessionFile: "/tmp/session.jsonl",
			runId: "run-1",
		}, () => {
			debugLog("reflector.result", { reason: "no_tool_call" });
		});

		const logPath = join(agentDir, "observational-memory", "debug", "session-123.ndjson");
		expect(existsSync(logPath)).toBe(true);
		expect(existsSync(join(agentDir, "observational-memory", "debug.ndjson"))).toBe(false);
		expect(readJsonLines(logPath)).toMatchObject([
			{
				event: "reflector.result",
				cwd: "/tmp/project",
				sessionId: "session-123",
				sessionFile: "/tmp/session.jsonl",
				runId: "run-1",
				data: { reason: "no_tool_call" },
			},
		]);
	});

	it("appends multiple runs for the same session to the same debug file", () => {
		withDebugLogContext({ enabled: true, sessionId: "session-abc", runId: "run-1" }, () => debugLog("one"));
		withDebugLogContext({ enabled: true, sessionId: "session-abc", runId: "run-2" }, () => debugLog("two"));

		const logPath = join(agentDir, "observational-memory", "debug", "session-abc.ndjson");
		expect(readJsonLines(logPath).map((row) => row.runId)).toEqual(["run-1", "run-2"]);
	});

	it("uses different debug files for different sessions", () => {
		withDebugLogContext({ enabled: true, sessionId: "session-a" }, () => debugLog("event"));
		withDebugLogContext({ enabled: true, sessionId: "session-b" }, () => debugLog("event"));

		expect(existsSync(join(agentDir, "observational-memory", "debug", "session-a.ndjson"))).toBe(true);
		expect(existsSync(join(agentDir, "observational-memory", "debug", "session-b.ndjson"))).toBe(true);
	});

	it("does not write debug logs without a usable session id", () => {
		withDebugLogContext({ enabled: true, cwd: "/tmp/project", runId: "run-1" }, () => debugLog("observer.start"));
		withDebugLogContext({ enabled: true, sessionId: "---" }, () => debugLog("observer.start"));

		expect(existsSync(join(agentDir, "observational-memory"))).toBe(false);
	});

	it("sanitizes session ids before using them as filenames", () => {
		expect(safeDebugLogSessionId(" session/../id:value ")).toBe("session_.._id_value");
		expect(debugLogRelativePath({ sessionId: " session/../id:value " })).toBe(join("observational-memory", "debug", "session_.._id_value.ndjson"));
		expect(debugLogRelativePath({ sessionId: "---" })).toBeUndefined();
	});

	it("does not write logs when disabled", () => {
		withDebugLogContext({ enabled: false, sessionId: "session-123" }, () => debugLog("reflector.result"));

		expect(existsSync(join(agentDir, "observational-memory"))).toBe(false);
	});
});
