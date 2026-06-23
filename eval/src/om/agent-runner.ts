import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { MaintenanceResult, Observation, Reflection, RewriteResult } from './types.js';
import { createUsageCollector, loadOmAgents, resolveModel } from './runner.js';

export const OM_EVAL_MAX_TURNS = 4;

function providerErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.name === 'MemoryAgentProviderError') return error.message;
  return undefined;
}

export async function runObserverEval(modelSpec: string, thinkingLevel: ModelThinkingLevel, args: { chunk: string; allowedSourceEntryIds: string[] }) {
  const auth = await resolveModel(modelSpec);
  const { runObserver } = await loadOmAgents();
  const usage = createUsageCollector();
  const agentStarted = Date.now();
  try {
    const output = await runObserver({ ...auth, ...args, thinkingLevel, maxTurns: OM_EVAL_MAX_TURNS, onUsage: usage.onUsage });
    return { output, usage, agentDurationMs: Date.now() - agentStarted };
  } catch (error) {
    const providerError = providerErrorMessage(error);
    if (!providerError) throw error;
    return { output: undefined, usage, agentDurationMs: Date.now() - agentStarted, providerError };
  }
}

export async function runReflectorEval(modelSpec: string, thinkingLevel: ModelThinkingLevel, args: { reflections?: Reflection[]; observations?: Observation[]; touchedFiles?: string[] }) {
  const auth = await resolveModel(modelSpec);
  const { runReflector } = await loadOmAgents();
  const usage = createUsageCollector();
  const agentStarted = Date.now();
  try {
    const output = await runReflector({ ...auth, ...args, thinkingLevel, maxTurns: OM_EVAL_MAX_TURNS, onUsage: usage.onUsage });
    return { output, usage, agentDurationMs: Date.now() - agentStarted };
  } catch (error) {
    const providerError = providerErrorMessage(error);
    if (!providerError) throw error;
    return { output: undefined, usage, agentDurationMs: Date.now() - agentStarted, providerError };
  }
}

export async function runRewriteEval(modelSpec: string, thinkingLevel: ModelThinkingLevel, reflections: Reflection[]) {
  const auth = await resolveModel(modelSpec);
  const { runRewrite } = await loadOmAgents();
  const usage = createUsageCollector();
  const agentStarted = Date.now();
  try {
    const result = await runRewrite({ ...auth, reflections, thinkingLevel, maxTurns: OM_EVAL_MAX_TURNS, onUsage: usage.onUsage }) as RewriteResult | undefined;
    return { result, output: result?.reflections, usage, agentDurationMs: Date.now() - agentStarted };
  } catch (error) {
    const providerError = providerErrorMessage(error);
    if (!providerError) throw error;
    return { result: undefined, output: undefined, usage, agentDurationMs: Date.now() - agentStarted, providerError };
  }
}

export async function runMaintainerEval(modelSpec: string, thinkingLevel: ModelThinkingLevel, reflections: Reflection[]) {
  const auth = await resolveModel(modelSpec);
  const { runMaintainer } = await loadOmAgents();
  const usage = createUsageCollector();
  const agentStarted = Date.now();
  try {
    const output = await runMaintainer({ ...auth, reflections, thinkingLevel, maxTurns: OM_EVAL_MAX_TURNS, onUsage: usage.onUsage }) as MaintenanceResult | undefined;
    return { output, usage, agentDurationMs: Date.now() - agentStarted };
  } catch (error) {
    const providerError = providerErrorMessage(error);
    if (!providerError) throw error;
    return { output: undefined, usage, agentDurationMs: Date.now() - agentStarted, providerError };
  }
}
