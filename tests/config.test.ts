import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => mock.agentDir,
}));

import { DEFAULTS, loadConfig, STRATEGY } from "../src/config.js";

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
			observeEveryMessages: 32,
			reflectEveryObservations: 8,
			maintainEveryNewReflections: 10,
			maintainerMaxInputReflections: 12,
			maxInitialObserveTokens: 100000,
			reflectionsPoolMaxTokens: 8000,
			observerToolResultSummaryMaxLines: 4,
			observerToolResultErrorMaxLines: 20,
			observerToolResultLineMaxChars: 300,
			observerToolOutputPolicies: { fork: "full-excerpt" },
			agentMaxTurns: 4,
			observerThinking: "low",
			reflectorThinking: "low",
			maintainerThinking: "low",
			rewriteThinking: "low",
			debugLog: false,
		});
		expect(loadConfig(cwd)).toEqual(DEFAULTS);
	});

	it("merges global and project settings in order", () => {
		writeJson(join(agentDir, "settings.json"), {
			"observational-memory": {
				strategy: "replacement",
				observeEveryMessages: 10,
				reflectEveryObservations: 20,
				maintainEveryNewReflections: 6,
				maintainerMaxInputReflections: 9,
				maxInitialObserveTokens: 60,
				reflectionsPoolMaxTokens: 30,
				observerToolResultSummaryMaxLines: 2,
				observerToolResultErrorMaxLines: 10,
				observerToolResultLineMaxChars: 120,
				observerToolOutputPolicies: { fork: "bounded-excerpt", web_fetch: "bounded-excerpt", bad: "nope" },
				agentMaxTurns: 5,
				model: { provider: "anthropic", id: "global", thinking: "medium" },
				observerThinking: "low",
				reflectorThinking: "high",
				maintainerThinking: "minimal",
				rewriteThinking: "medium",
				debugLog: true,
			},
		});
		writeJson(join(cwd, ".pi", "settings.json"), {
			"observational-memory": {
				strategy: "replacement",
				observeEveryMessages: 100,
				observerToolOutputPolicies: { fork: "full-excerpt", custom_tool: "metadata-only" },
				model: { provider: "openai", id: "project", thinking: "low" },
			},
		});

		expect(loadConfig(cwd)).toMatchObject({
			strategy: "replacement",
			observeEveryMessages: 100,
			reflectEveryObservations: 20,
			maintainEveryNewReflections: 6,
			maintainerMaxInputReflections: 9,
			maxInitialObserveTokens: 60,
			reflectionsPoolMaxTokens: 30,
			observerToolResultSummaryMaxLines: 2,
			observerToolResultErrorMaxLines: 10,
			observerToolResultLineMaxChars: 120,
			observerToolOutputPolicies: { fork: "full-excerpt", web_fetch: "bounded-excerpt", custom_tool: "metadata-only" },
			agentMaxTurns: 5,
			model: { provider: "openai", id: "project", thinking: "low" },
			observerThinking: "low",
			reflectorThinking: "high",
			maintainerThinking: "minimal",
			rewriteThinking: "medium",
			debugLog: true,
		});
	});

	it("ignores invalid values", () => {
		writeJson(join(cwd, ".pi", "settings.json"), {
			"observational-memory": {
				strategy: "unknown",
				observeEveryMessages: -1,
				reflectEveryObservations: 0,
				maintainEveryNewReflections: 0,
				maintainerMaxInputReflections: "12",
				maxInitialObserveTokens: "100000",
				reflectionsPoolMaxTokens: "8000",
				observerToolResultSummaryMaxLines: "4",
				observerToolResultErrorMaxLines: -1,
				observerToolResultLineMaxChars: null,
				observerToolOutputPolicies: { fork: "giant", "": "bounded-excerpt" },
				agentMaxTurns: null,
				model: { provider: "anthropic", id: "", thinking: "huge" },
				observerThinking: "huge",
				reflectorThinking: 10,
				maintainerThinking: "huge",
				rewriteThinking: "huge",
				debugLog: "true",
			},
		});

		expect(loadConfig(cwd)).toEqual(DEFAULTS);
	});

});
