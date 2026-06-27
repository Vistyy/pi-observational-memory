import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ConfiguredModel {
	provider: string;
	id: string;
	thinking?: ModelThinkingLevel;
}

export const STRATEGY = {
	replacement: "replacement",
	off: "off",
} as const;
export type MemoryStrategy = (typeof STRATEGY)[keyof typeof STRATEGY];

export type ObserverToolOutputPolicy = "omit" | "bounded" | "full";

export type MemoryAgentKind = "observer" | "checkpoint-editor";

export interface Config {
	strategy: MemoryStrategy;
	observeEveryMessages: number;
	observeHardCapRecords: number;
	checkpointUpdateEveryObservations: number;
	checkpointUpdateEverySourceRecords: number;
	maxInitialObserveTokens: number;
	observerToolResultSummaryMaxLines: number;
	observerToolResultErrorMaxLines: number;
	observerToolResultLineMaxChars: number;
	observerToolOutputPolicies: Record<string, ObserverToolOutputPolicy>;
	agentMaxTurns: number;
	checkpointPruneTargetTokens: number;
	checkpointPruneHardMaxTokens: number;
	model?: ConfiguredModel;
	observerModel?: ConfiguredModel;
	checkpointEditorModel?: ConfiguredModel;
	observerThinking?: ModelThinkingLevel;
	checkpointEditorThinking?: ModelThinkingLevel;
	debugLog: boolean;
}

export const DEFAULTS: Config = {
	strategy: STRATEGY.replacement,
	observeEveryMessages: 8,
	observeHardCapRecords: 32,
	checkpointUpdateEveryObservations: 16,
	checkpointUpdateEverySourceRecords: 64,
	maxInitialObserveTokens: 100_000,
	observerToolResultSummaryMaxLines: 4,
	observerToolResultErrorMaxLines: 20,
	observerToolResultLineMaxChars: 300,
	observerToolOutputPolicies: {},
	agentMaxTurns: 4,
	checkpointPruneTargetTokens: 4_000,
	checkpointPruneHardMaxTokens: 8_000,
	observerThinking: "low",
	checkpointEditorThinking: "low",
	debugLog: false,
};

export const THINKING_LEVEL_VALUES: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

const SETTINGS_KEY = "observational-memory";

function positiveIntegerOrUndefined(value: unknown): number | undefined {
	return Number.isInteger(value) && typeof value === "number" && value > 0 ? value : undefined;
}

function isThinkingLevel(value: unknown): value is ModelThinkingLevel {
	return typeof value === "string" && (THINKING_LEVEL_VALUES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isMemoryStrategy(value: unknown): value is MemoryStrategy {
	return typeof value === "string" && Object.values(STRATEGY).includes(value as MemoryStrategy);
}

function isObserverToolOutputPolicy(value: unknown): value is ObserverToolOutputPolicy {
	return value === "omit" || value === "bounded" || value === "full";
}

function normalizeObserverToolOutputPolicies(value: unknown): Record<string, ObserverToolOutputPolicy> | undefined {
	if (!isRecord(value)) return undefined;
	const policies: Record<string, ObserverToolOutputPolicy> = {};
	for (const [toolName, policy] of Object.entries(value)) {
		if (toolName.length > 0 && isObserverToolOutputPolicy(policy)) policies[toolName] = policy;
	}
	return Object.keys(policies).length > 0 ? policies : undefined;
}

function normalizeModel(value: unknown): ConfiguredModel | undefined {
	if (!isRecord(value)) return undefined;
	const provider = nonEmptyString(value.provider);
	const id = nonEmptyString(value.id);
	if (!provider || !id) return undefined;
	const model: ConfiguredModel = { provider, id };
	if (isThinkingLevel(value.thinking)) model.thinking = value.thinking;
	return model;
}

function normalizeSettingsConfig(value: Record<string, unknown>): Partial<Config> {
	const normalized: Partial<Config> = {};
	const numberKeys = [
		"observeEveryMessages",
		"observeHardCapRecords",
		"checkpointUpdateEveryObservations",
		"checkpointUpdateEverySourceRecords",
		"maxInitialObserveTokens",
		"observerToolResultSummaryMaxLines",
		"observerToolResultErrorMaxLines",
		"observerToolResultLineMaxChars",
		"agentMaxTurns",
		"checkpointPruneTargetTokens",
		"checkpointPruneHardMaxTokens",
	] as const;
	for (const key of numberKeys) {
		const normalizedValue = positiveIntegerOrUndefined(value[key]);
		if (normalizedValue !== undefined) normalized[key] = normalizedValue;
	}
	if (isMemoryStrategy(value.strategy)) normalized.strategy = value.strategy;
	if (typeof value.debugLog === "boolean") normalized.debugLog = value.debugLog;
	if (isThinkingLevel(value.observerThinking)) normalized.observerThinking = value.observerThinking;
	if (isThinkingLevel(value.checkpointEditorThinking)) normalized.checkpointEditorThinking = value.checkpointEditorThinking;
	const model = normalizeModel(value.model);
	if (model) normalized.model = model;
	const observerModel = normalizeModel(value.observerModel);
	if (observerModel) normalized.observerModel = observerModel;
	const checkpointEditorModel = normalizeModel(value.checkpointEditorModel);
	if (checkpointEditorModel) normalized.checkpointEditorModel = checkpointEditorModel;
	const observerToolOutputPolicies = normalizeObserverToolOutputPolicies(value.observerToolOutputPolicies);
	if (observerToolOutputPolicies) normalized.observerToolOutputPolicies = observerToolOutputPolicies;
	return normalized;
}

function readNamespacedConfig(path: string): Partial<Config> {
	if (!existsSync(path)) return {};
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
		const nested = raw[SETTINGS_KEY];
		return isRecord(nested) ? normalizeSettingsConfig(nested) : {};
	} catch {
		return {};
	}
}

export function configuredModelForAgent(config: Config, agent: MemoryAgentKind): ConfiguredModel | undefined {
	if (agent === "observer") return config.observerModel ?? config.model;
	return config.checkpointEditorModel ?? config.model;
}

export function thinkingForAgent(config: Config, agent: MemoryAgentKind): ModelThinkingLevel {
	if (agent === "observer") return config.observerThinking ?? config.observerModel?.thinking ?? config.model?.thinking ?? "low";
	return config.checkpointEditorThinking ?? config.checkpointEditorModel?.thinking ?? config.model?.thinking ?? "low";
}

export function loadConfig(cwd: string): Config {
	const globalPath = join(getAgentDir(), "settings.json");
	const projectPath = join(cwd, ".pi", "settings.json");
	const globalConfig = readNamespacedConfig(globalPath);
	const projectConfig = readNamespacedConfig(projectPath);
	return {
		...DEFAULTS,
		...globalConfig,
		...projectConfig,
		observerToolOutputPolicies: {
			...DEFAULTS.observerToolOutputPolicies,
			...globalConfig.observerToolOutputPolicies,
			...projectConfig.observerToolOutputPolicies,
		},
	};
}
