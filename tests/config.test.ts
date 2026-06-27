import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => mock.agentDir,
}));

import { DEFAULTS, configuredModelForAgent, loadConfig, STRATEGY, thinkingForAgent } from "../src/config.js";

function writeJson(path: string, value: unknown) {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify(value), "utf-8");
}

describe("config", () => {
	let root: string;
	let cwd: string;
	let agentDir: string;

	beforeEach(() => {
		root = `${tmpdir()}/om-memory-config-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		cwd = join(root, "project");
		agentDir = join(root, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		mock.agentDir = agentDir;
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("uses defaults", () => {
		expect(DEFAULTS).toEqual({
			strategy: STRATEGY.replacement,
			observeEveryMessages: 8,
			observeHardCapRecords: 32,
			checkpointUpdateEveryObservations: 8,
			checkpointUpdateEverySourceRecords: 32,
			maxInitialObserveTokens: 100000,
			observerToolResultSummaryMaxLines: 4,
			observerToolResultErrorMaxLines: 20,
			observerToolResultLineMaxChars: 300,
			observerToolOutputPolicies: {},
			agentMaxTurns: 4,
			checkpointPruneTargetTokens: 4000,
			checkpointPruneHardMaxTokens: 8000,
			observerThinking: "low",
			checkpointEditorThinking: "low",
			debugLog: false,
		});
		expect(loadConfig(cwd)).toEqual(DEFAULTS);
	});

	it("merges global and project settings in order", () => {
		writeJson(join(agentDir, "settings.json"), {
			"observational-memory": {
				strategy: "replacement",
				observeEveryMessages: 10,
				observeHardCapRecords: 40,
				checkpointUpdateEveryObservations: 9,
				checkpointUpdateEverySourceRecords: 36,
				maxInitialObserveTokens: 60,
				observerToolResultSummaryMaxLines: 2,
				observerToolResultErrorMaxLines: 10,
				observerToolResultLineMaxChars: 120,
				observerToolOutputPolicies: { fork: "bounded", web_fetch: "bounded", bad: "nope" },
				agentMaxTurns: 5,
				checkpointPruneTargetTokens: 3000,
				checkpointPruneHardMaxTokens: 6000,
				model: { provider: "anthropic", id: "global", thinking: "medium" },
				observerModel: { provider: "anthropic", id: "observer", thinking: "minimal" },
				checkpointEditorModel: { provider: "anthropic", id: "checkpoint", thinking: "high" },
				observerThinking: "low",
				checkpointEditorThinking: "medium",
				debugLog: true,
			},
		});
		writeJson(join(cwd, ".pi", "settings.json"), {
			"observational-memory": {
				strategy: "replacement",
				observeEveryMessages: 100,
				observerToolOutputPolicies: { fork: "full", custom_tool: "omit" },
				model: { provider: "openai", id: "project", thinking: "low" },
			},
		});

		expect(loadConfig(cwd)).toMatchObject({
			strategy: "replacement",
			observeEveryMessages: 100,
			observeHardCapRecords: 40,
			checkpointUpdateEveryObservations: 9,
			checkpointUpdateEverySourceRecords: 36,
			maxInitialObserveTokens: 60,
			observerToolResultSummaryMaxLines: 2,
			observerToolResultErrorMaxLines: 10,
			observerToolResultLineMaxChars: 120,
			observerToolOutputPolicies: { fork: "full", web_fetch: "bounded", custom_tool: "omit" },
			agentMaxTurns: 5,
			checkpointPruneTargetTokens: 3000,
			checkpointPruneHardMaxTokens: 6000,
			model: { provider: "openai", id: "project", thinking: "low" },
			observerModel: { provider: "anthropic", id: "observer", thinking: "minimal" },
			checkpointEditorModel: { provider: "anthropic", id: "checkpoint", thinking: "high" },
			observerThinking: "low",
			checkpointEditorThinking: "medium",
			debugLog: true,
		});
	});

	it("resolves per-agent model and thinking fallbacks", () => {
		const config = {
			...DEFAULTS,
			model: { provider: "anthropic", id: "fallback", thinking: "medium" as const },
			observerModel: { provider: "openai", id: "observer", thinking: "minimal" as const },
			checkpointEditorModel: { provider: "openai", id: "checkpoint", thinking: "high" as const },
			observerThinking: "low" as const,
			checkpointEditorThinking: "xhigh" as const,
		};

		expect(configuredModelForAgent(config, "observer")).toEqual(config.observerModel);
		expect(configuredModelForAgent(config, "checkpoint-editor")).toEqual(config.checkpointEditorModel);
		expect(thinkingForAgent(config, "observer")).toBe("low");
		expect(thinkingForAgent(config, "checkpoint-editor")).toBe("xhigh");
	});

	it("ignores invalid values", () => {
		writeJson(join(cwd, ".pi", "settings.json"), {
			"observational-memory": {
				strategy: "unknown",
				observeEveryMessages: -1,
				observeHardCapRecords: 0,
				checkpointUpdateEveryObservations: 0,
				checkpointUpdateEverySourceRecords: "32",
				maxInitialObserveTokens: "100000",
				observerToolResultSummaryMaxLines: "4",
				observerToolResultErrorMaxLines: -1,
				observerToolResultLineMaxChars: null,
				observerToolOutputPolicies: { fork: "giant", "": "bounded" },
				agentMaxTurns: null,
				checkpointPruneTargetTokens: 0,
				checkpointPruneHardMaxTokens: "many",
				model: { provider: "anthropic", id: "", thinking: "huge" },
				observerModel: { provider: "", id: "observer", thinking: "low" },
				checkpointEditorModel: { provider: "anthropic", id: "", thinking: "low" },
				observerThinking: "huge",
				checkpointEditorThinking: "giant",
				debugLog: "true",
			},
		});

		expect(loadConfig(cwd)).toEqual(DEFAULTS);
	});
});
