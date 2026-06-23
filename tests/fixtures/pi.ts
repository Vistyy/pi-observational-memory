import type { AgentEndEvent, AgentStartEvent, ExtensionAPI, ExtensionCommandContext, ExtensionHandler, MessageEndEvent, RegisteredCommand, SessionBeforeCompactEvent, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

export type RegisteredCommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;
export type CommandHandler = RegisteredCommandOptions["handler"];

export function commandApi(onRegister: (name: string, command: RegisteredCommandOptions) => void): ExtensionAPI {
	return {
		registerCommand: vi.fn(onRegister),
	} as unknown as ExtensionAPI;
}

export function commandCtx(ctx: Pick<ExtensionCommandContext, "cwd" | "ui" | "sessionManager">): ExtensionCommandContext {
	return ctx as ExtensionCommandContext;
}

export function toolApi(): ExtensionAPI {
	return {
		registerTool: vi.fn(),
	} as unknown as ExtensionAPI;
}

export type BeforeCompactHandler = ExtensionHandler<SessionBeforeCompactEvent>;
export type AgentEndHandler = ExtensionHandler<AgentEndEvent>;
export type AgentStartHandler = ExtensionHandler<AgentStartEvent>;
export type TurnEndHandler = ExtensionHandler<TurnEndEvent>;
export type MessageEndHandler = ExtensionHandler<MessageEndEvent>;

export function beforeCompactApi(onRegister: (handler: BeforeCompactHandler) => void, appendEntry = vi.fn()): ExtensionAPI {
	return {
		on: vi.fn((eventName: string, handler: BeforeCompactHandler) => {
			if (eventName !== "session_before_compact") throw new Error(`unexpected event ${eventName}`);
			onRegister(handler);
		}),
		appendEntry,
	} as unknown as ExtensionAPI;
}

export function memoryUpdateApi(handlers: { agent_start?: AgentStartHandler; message_end?: MessageEndHandler; turn_end?: TurnEndHandler }, appendEntry = vi.fn()): ExtensionAPI {
	return {
		on: vi.fn((eventName: string, handler: AgentStartHandler | MessageEndHandler | TurnEndHandler) => {
			if (eventName !== "agent_start" && eventName !== "message_end" && eventName !== "turn_end") throw new Error(`unexpected event ${eventName}`);
			handlers[eventName] = handler as never;
		}),
		appendEntry,
	} as unknown as ExtensionAPI;
}

export function agentEndApi(onRegister: (handler: AgentEndHandler) => void): ExtensionAPI {
	return {
		on: vi.fn((eventName: string, handler: AgentEndHandler) => {
			if (eventName !== "agent_end") throw new Error(`unexpected event ${eventName}`);
			onRegister(handler);
		}),
	} as unknown as ExtensionAPI;
}

export function turnEndApi(onRegister: (handler: TurnEndHandler) => void, appendEntry = vi.fn()): ExtensionAPI {
	return {
		on: vi.fn((eventName: string, handler: TurnEndHandler) => {
			if (eventName !== "turn_end") throw new Error(`unexpected event ${eventName}`);
			onRegister(handler);
		}),
		appendEntry,
	} as unknown as ExtensionAPI;
}
