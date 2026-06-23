import { calculateCost, streamSimple, type Message, type ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { Probe, TokenUsage } from '../lib/types.js';
import { resolveModel } from './runner.js';
import type { AgentEvalRecord } from './types.js';

type AgentDebugArgs = {
  agent: AgentEvalRecord['agent'];
  modelSpec: string;
  thinkingLevel: ModelThinkingLevel;
  systemPrompt: string;
  userText: string;
  record: AgentEvalRecord;
  probe: Probe;
};

function assistantText(message: { content?: unknown }): string {
  const content = Array.isArray(message.content) ? message.content : [];
  return content
    .map((part) => typeof part === 'object' && part && (part as { type?: unknown }).type === 'text' ? String((part as { text?: unknown }).text ?? '') : '')
    .filter(Boolean)
    .join('\n');
}

function usageOf(message: { usage?: unknown }): TokenUsage | undefined {
  return message.usage as TokenUsage | undefined;
}

async function promptFromDiagnostics(record: AgentEvalRecord): Promise<{ systemPrompt: string; userText: string } | undefined> {
  const diagnostics = record.diagnostics as { agentInput?: { systemPrompt: string; userText: string }; chunk?: string; reflections?: unknown[]; observations?: unknown[] } | undefined;
  if (diagnostics?.agentInput) return diagnostics.agentInput;
  const base = new URL('../../../src/agents/', import.meta.url);
  const memoryBase = new URL('../../../src/memory/', import.meta.url);
  const ledgerBase = new URL('../../../src/session-ledger/', import.meta.url);
  if (record.agent === 'observer' && diagnostics?.chunk) {
    const prompts = await import(new URL('observer/prompts.ts', base).href) as { OBSERVER_SYSTEM: string; observerUserText: (now: string, conversation: string) => string };
    const recordContent = await import(new URL('record-content.ts', memoryBase).href) as { nowTimestamp: () => string };
    return { systemPrompt: prompts.OBSERVER_SYSTEM, userText: prompts.observerUserText(recordContent.nowTimestamp(), diagnostics.chunk.trim()) };
  }
  const common = await import(new URL('common.ts', base).href) as { joinOrEmpty: (items: readonly string[]) => string };
  const ledger = await import(new URL('index.ts', ledgerBase).href) as { reflectionToSummaryLine: (reflection: unknown) => string; observationToSummaryLine: (observation: unknown) => string };
  if (record.agent === 'reflector') {
    const prompts = await import(new URL('reflector/prompts.ts', base).href) as { REFLECTOR_SYSTEM: string; reflectorUserText: (reflectionsText: string, observationsText: string) => string };
    return {
      systemPrompt: prompts.REFLECTOR_SYSTEM,
      userText: prompts.reflectorUserText(
        common.joinOrEmpty((diagnostics?.reflections ?? []).map(ledger.reflectionToSummaryLine)),
        common.joinOrEmpty((diagnostics?.observations ?? []).map(ledger.observationToSummaryLine)),
      ),
    };
  }
  if (record.agent === 'rewrite') {
    const prompts = await import(new URL('rewrite/prompts.ts', base).href) as { REWRITE_SYSTEM: string; rewriteUserText: (reflectionsText: string) => string };
    return {
      systemPrompt: prompts.REWRITE_SYSTEM,
      userText: prompts.rewriteUserText(common.joinOrEmpty((diagnostics?.reflections ?? []).map(ledger.reflectionToSummaryLine))),
    };
  }
  if (record.agent === 'maintainer') {
    const prompts = await import(new URL('maintainer/prompts.ts', base).href) as { MAINTAINER_SYSTEM: string; maintainerUserText: (reflectionsText: string) => string };
    return {
      systemPrompt: prompts.MAINTAINER_SYSTEM,
      userText: prompts.maintainerUserText(common.joinOrEmpty((diagnostics?.reflections ?? []).map(ledger.reflectionToSummaryLine))),
    };
  }
  return undefined;
}

export async function debugRecordFailure(record: AgentEvalRecord, args: { modelSpec: string; thinkingLevel: ModelThinkingLevel; probe?: Probe }): Promise<AgentEvalRecord> {
  if (record.passed || record.agentDebug) return record;
  const prompt = await promptFromDiagnostics(record);
  if (!prompt) return record;
  return debugAgentFailure({ agent: record.agent, modelSpec: args.modelSpec, thinkingLevel: args.thinkingLevel, ...prompt, record, probe: args.probe ?? { id: record.id, question: 'Explain this failed eval case.', rubric: { pass_if: [], fail_if: [] } } });
}

export async function debugAgentFailure(args: AgentDebugArgs): Promise<AgentEvalRecord> {
  if (args.record.passed) return args.record;
  const auth = await resolveModel(args.modelSpec);
  const userText = `DEBUG MODE: You are reviewing your own previous ${args.agent} output for an eval case.

This is not a request to redo the task. This is not an accusation. The goal is to understand how the instructions, input, and eval expectation led to your previous behavior.

Agent: ${args.agent}
Case: ${args.record.id}

Original ${args.agent} system prompt:
${args.systemPrompt}

Original ${args.agent} user prompt/input:
${args.userText}

Your previous ${args.agent} output:
${JSON.stringify(args.record.output, null, 2)}

Eval question:
${args.probe.question}

Eval rubric:
${JSON.stringify(args.probe.rubric, null, 2)}

Failure reported by checks/judge:
${JSON.stringify(args.record.judge, null, 2)}

Score details:
${JSON.stringify(args.record.score, null, 2)}

Please explain, in debug mode:
1. What instructions you prioritized.
2. Why you included the records you included.
3. Why you omitted, compressed, or generalized expected evidence.
4. Whether any eval expectation conflicts with the task as you understood it.
5. One concrete prompt, fixture, or rubric change that would make the expected behavior clearer.

Return concise JSON with keys: prioritizedInstructions, inclusionReasoning, omissionReasoning, possibleConflict, suggestedFix.`;
  const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: userText }], timestamp: Date.now() }];
  const reasoning = (auth.model as { reasoning?: unknown }).reasoning;
  const started = Date.now();
  const stream = streamSimple(auth.model, { systemPrompt: args.systemPrompt, messages, tools: [] }, {
    apiKey: auth.apiKey,
    headers: auth.headers,
    maxTokens: 2000,
    ...(reasoning && args.thinkingLevel !== 'off' ? { reasoning: args.thinkingLevel } : {}),
  });
  for await (const _event of stream) {}
  const result = await stream.result();
  const usage = usageOf(result);
  if (usage) calculateCost(auth.model, usage as Parameters<typeof calculateCost>[1]);
  const durationMs = Date.now() - started;
  return { ...args.record, agentDebug: assistantText(result), agentDebugUsage: usage, agentDebugDurationMs: durationMs, durationMs: args.record.durationMs + durationMs };
}
