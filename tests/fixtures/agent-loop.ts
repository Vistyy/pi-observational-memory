type ToolCall = {
	name?: string;
	execute: (id: string, params: unknown) => Promise<unknown> | unknown;
};

export type CapturedAgentContext = {
	systemPrompt: string;
	tools: ToolCall[];
};

export type CapturedAgentConfig = {
	reasoning?: unknown;
	shouldStopAfterTurn?: (event: unknown) => boolean;
	getFollowUpMessages?: () => Promise<CapturedPrompt[]>;
};

export type CapturedPrompt = {
	content: Array<{ text?: string }>;
};

export type AgentLoopHandler = (
	prompts: CapturedPrompt[],
	context: CapturedAgentContext,
	config: CapturedAgentConfig,
) => Promise<void> | void;

export function fakeAgentLoop(handler: AgentLoopHandler) {
	return ((prompts: CapturedPrompt[], context: CapturedAgentContext, config: CapturedAgentConfig) => ({
		async *[Symbol.asyncIterator]() {
			// No streaming events needed for unit tests.
		},
		result: async () => {
			if (context.tools.length === 0) return [{ role: "assistant", content: [{ type: "text", text: "review" }] }];
			try {
				await handler(prompts, context, config);
			} catch (error) {
				if (error instanceof Error && error.message.startsWith("Rejected ")) return {};
				if (!(error instanceof TypeError && String(error.message).includes("undefined"))) throw error;
			}
			return {};
		},
	})) as never;
}
