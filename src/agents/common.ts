import { agentLoop, type AgentContext, type AgentLoopConfig, type AgentTool } from "@earendil-works/pi-agent-core";
import { calculateCost, streamSimple, type Message, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { AGENT_LOOP_MAX_TOKENS, boundedMaxTokens } from "./model-budget.js";
import { debugLog } from "../debug-log.js";
import { estimateStringTokens } from "../memory/token-estimate.js";

export type MemoryAgentName = "observer" | "reflector" | "rewrite" | "maintainer";

export type MemoryAgentUsage = {
	agent: MemoryAgentName | undefined;
	requestIndex: number;
	model?: { provider?: string; id?: string };
	thinkingLevel: ModelThinkingLevel;
	durationMs: number;
	stopReason?: string;
	usage: unknown;
};

export type MemoryAgentLoopArgs = {
	model: Model<any>;
	apiKey: string;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	agentLoop?: typeof agentLoop;
	maxTurns?: number;
	thinkingLevel?: ModelThinkingLevel;
	systemPrompt: string;
	userText: string;
	tools: AgentTool<any>[];
	agentName?: MemoryAgentName;
	onUsage?: (usage: MemoryAgentUsage) => void;
	requireToolCall?: boolean;
	maxNoToolRetries?: number;
	toolCallReminder?: string;
	maxProviderErrorRetries?: number;
};

export class MemoryAgentProviderError extends Error {
	constructor(message: string, readonly details?: unknown) {
		super(message);
		this.name = "MemoryAgentProviderError";
	}
}

export function joinOrEmpty(items: readonly string[]): string {
	return items.length ? items.join("\n") : "(none yet)";
}

export function normalizeAllowedIdsStrict(
	ids: readonly string[] | undefined,
	allowedIds: readonly string[],
): string[] | undefined {
	if (!ids || ids.length === 0) return undefined;
	const allowedOrder = new Map<string, number>();
	for (let i = 0; i < allowedIds.length; i++) {
		if (!allowedOrder.has(allowedIds[i])) allowedOrder.set(allowedIds[i], i);
	}

	const seen = new Set<string>();
	for (const id of ids) {
		if (!allowedOrder.has(id)) return undefined;
		seen.add(id);
	}
	if (seen.size === 0) return undefined;
	return Array.from(seen).sort((a, b) => (allowedOrder.get(a) ?? 0) - (allowedOrder.get(b) ?? 0));
}

function estimateJsonTokens(value: unknown): number {
	try {
		return estimateStringTokens(JSON.stringify(value));
	} catch {
		return 0;
	}
}

type AssistantFailure = { stopReason: "error" | "aborted"; errorMessage?: unknown };

function assistantFailureFromEvent(event: unknown): AssistantFailure | undefined {
	if (!event || typeof event !== "object") return undefined;
	const message = (event as { message?: unknown }).message;
	if (!message || typeof message !== "object") return undefined;
	const maybeMessage = message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown };
	if (maybeMessage.role !== "assistant") return undefined;
	if (maybeMessage.stopReason !== "error" && maybeMessage.stopReason !== "aborted") return undefined;
	return { stopReason: maybeMessage.stopReason, errorMessage: maybeMessage.errorMessage };
}

export async function runMemoryAgentLoop(args: MemoryAgentLoopArgs): Promise<void> {
	const reasoning = (args.model as { reasoning?: unknown }).reasoning;
	const thinkingLevel = args.thinkingLevel ?? "low";
	const effectiveMaxTurns = args.maxTurns && args.maxTurns > 0 ? args.maxTurns : undefined;
	const maxProviderErrorRetries = args.maxProviderErrorRetries ?? 1;
	const loop = args.agentLoop ?? agentLoop;
	let providerRequestCount = 0;
	const started = Date.now();

	debugLog("memory_agent.start", {
		agent: args.agentName,
		thinkingLevel,
		maxTurns: effectiveMaxTurns,
		toolCount: args.tools.length,
		userTextLength: args.userText.length,
	});

	const runOnce = async (attempt: number): Promise<void> => {
		const prompts: Message[] = [{ role: "user", content: [{ type: "text", text: args.userText }], timestamp: Date.now() }];
		const context: AgentContext = { systemPrompt: args.systemPrompt, messages: [], tools: args.tools };
		let turnCount = 0;
		let invalidToolTurnCount = 0;
		let noToolTurnCount = 0;
		let noToolReminderCount = 0;
		const requireToolCall = args.requireToolCall ?? args.tools.length > 0;
		const maxNoToolRetries = args.maxNoToolRetries ?? 1;
		const toolCallReminder = args.toolCallReminder ?? `You must call ${args.tools.length === 1 ? `the ${args.tools[0].name}` : "one of the provided record"} tool. Use an empty array if there is no memory to record.`;
		const shouldStopAfterTurn: AgentLoopConfig["shouldStopAfterTurn"] = ({ toolResults }) => {
			turnCount++;
			const results = toolResults ?? [];
			if (results.length === 0) {
				noToolTurnCount++;
				if (requireToolCall && noToolReminderCount < maxNoToolRetries && (effectiveMaxTurns === undefined || turnCount < effectiveMaxTurns)) return false;
				return true;
			}
			if (results.some((result) => result.isError === true)) {
				invalidToolTurnCount++;
				return invalidToolTurnCount >= 2;
			}
			return effectiveMaxTurns !== undefined && turnCount >= effectiveMaxTurns;
		};
		const config: AgentLoopConfig = {
			model: args.model,
			apiKey: args.apiKey,
			headers: args.headers,
			maxTokens: boundedMaxTokens(args.model, AGENT_LOOP_MAX_TOKENS),
			convertToLlm: (msgs) => msgs as Message[],
			toolExecution: "sequential",
			...(reasoning && thinkingLevel !== "off" ? { reasoning: thinkingLevel } : {}),
			shouldStopAfterTurn,
			getFollowUpMessages: async () => {
				if (!requireToolCall || noToolTurnCount <= noToolReminderCount || noToolReminderCount >= maxNoToolRetries) return [];
				noToolReminderCount++;
				debugLog("memory_agent.required_tool_reminder", {
					agent: args.agentName,
					turnCount,
					noToolTurnCount,
				});
				return [{ role: "user", content: [{ type: "text", text: toolCallReminder }], timestamp: Date.now() }];
			},
		};

		const streamFn = async (model: Model<any>, llmContext: unknown, options?: Parameters<typeof streamSimple>[2]) => {
			providerRequestCount++;
			const requestIndex = providerRequestCount;
			const requestStarted = Date.now();
			const context = llmContext as { systemPrompt?: string; messages?: unknown[]; tools?: unknown[] };
			debugLog("memory_agent.provider_request", {
				agent: args.agentName,
				requestIndex,
				attempt,
				systemPromptTokenEstimate: estimateStringTokens(context.systemPrompt ?? ""),
				messagesTokenEstimate: estimateJsonTokens(context.messages ?? []),
				toolsTokenEstimate: estimateJsonTokens(context.tools ?? []),
				messageCount: context.messages?.length ?? 0,
				toolCount: context.tools?.length ?? 0,
			});
			const stream = streamSimple(model, llmContext as Parameters<typeof streamSimple>[1], options);
			const originalResult = stream.result.bind(stream);
			stream.result = async () => {
				const result = await originalResult();
				const usage = (result as { usage?: Parameters<typeof calculateCost>[1] }).usage;
				if (usage) calculateCost(model, usage);
				const stopReason = (result as { stopReason?: unknown }).stopReason;
				const durationMs = Date.now() - requestStarted;
				if (usage) args.onUsage?.({
					agent: args.agentName,
					requestIndex,
					model: { provider: (model as { provider?: string }).provider, id: (model as { id?: string }).id },
					thinkingLevel,
					durationMs,
					stopReason: typeof stopReason === "string" ? stopReason : undefined,
					usage,
				});
				debugLog("memory_agent.provider_result", {
					agent: args.agentName,
					requestIndex,
					attempt,
					durationMs,
					usage,
					stopReason,
				});
				return result;
			};
			return stream;
		};

		const stream = loop(prompts, context, config, args.signal, streamFn);
		let providerFailure: AssistantFailure | undefined;
		for await (const event of stream) {
			providerFailure ??= assistantFailureFromEvent(event);
		}
		const result = await stream.result();
		if (providerFailure) {
			throw new MemoryAgentProviderError(
				typeof providerFailure.errorMessage === "string" && providerFailure.errorMessage ? providerFailure.errorMessage : `Memory agent provider returned stopReason=${providerFailure.stopReason}`,
				{ result, attempt, stopReason: providerFailure.stopReason },
			);
		}
		debugLog("memory_agent.end", {
			agent: args.agentName,
			durationMs: Date.now() - started,
			usage: (result as { usage?: unknown }).usage,
			providerRequestCount,
			attempt,
		});
	};

	for (let attempt = 0; attempt <= maxProviderErrorRetries; attempt++) {
		try {
			await runOnce(attempt);
			return;
		} catch (error) {
			const isProviderError = error instanceof MemoryAgentProviderError;
			const stopReason = isProviderError ? (error.details as { stopReason?: unknown } | undefined)?.stopReason : undefined;
			const retryableProviderError = isProviderError && stopReason !== "aborted";
			if (!retryableProviderError || attempt >= maxProviderErrorRetries) {
				debugLog("memory_agent.error", {
					agent: args.agentName,
					durationMs: Date.now() - started,
					attempt,
					errorMessage: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
			debugLog("memory_agent.provider_retry", {
				agent: args.agentName,
				durationMs: Date.now() - started,
				attempt,
				nextAttempt: attempt + 1,
				errorMessage: error.message,
			});
		}
	}
}
