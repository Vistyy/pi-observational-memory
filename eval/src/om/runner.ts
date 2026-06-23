import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import type { TokenUsage } from '../lib/types.js';
import type { OmAgents, Observation, Reflection, AgentEvalRecord } from './types.js';

let omAgents: OmAgents | undefined;

export async function loadOmAgents(): Promise<OmAgents> {
  if (omAgents) return omAgents;
  const base = new URL('../../../src/agents/', import.meta.url);
  const observer = await import(new URL('observer/agent.ts', base).href) as { runObserver: OmAgents['runObserver'] };
  const reflector = await import(new URL('reflector/agent.ts', base).href) as { runReflector: OmAgents['runReflector'] };
  const rewrite = await import(new URL('rewrite/agent.ts', base).href) as { runRewrite: OmAgents['runRewrite'] };
  const maintainer = await import(new URL('maintainer/agent.ts', base).href) as { runMaintainer: OmAgents['runMaintainer'] };
  omAgents = { runObserver: observer.runObserver, runReflector: reflector.runReflector, runRewrite: rewrite.runRewrite, runMaintainer: maintainer.runMaintainer };
  return omAgents;
}

function parseModelSpec(spec: string): [provider: string, id: string] {
  const [provider, ...rest] = spec.split('/');
  const id = rest.join('/');
  if (!provider || !id) throw new Error(`model must be provider/id, got: ${spec}`);
  return [provider, id];
}

export async function resolveModel(spec: string): Promise<{ model: Model<any>; apiKey: string; headers?: Record<string, string> }> {
  const authStorage = AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const [provider, id] = parseModelSpec(spec);
  const model = registry.find(provider, id);
  if (!model) throw new Error(`unknown model: ${spec}`);
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);
  return { model, apiKey: auth.apiKey ?? '', headers: auth.headers };
}

export function obs(id: string, content: string, timestamp: string, tokenCount = 20): Observation {
  return { id: id.startsWith('obs_') ? id : `obs_${id}`, content, timestamp, sourceEntryIds: [`src-${id}`], tokenCount };
}

export function ref(id: string, content: string, sources: string[]): Reflection {
  return {
    id: id.startsWith('ref_') ? id : `ref_${id}`,
    content,
    sources: sources.map((source) => source.startsWith('obs_') || source.startsWith('ref_') ? source : `obs_${source}`),
    tokenCount: Math.ceil(content.length / 4),
  };
}

function addCost(total: TokenUsage, usage: TokenUsage): void {
  const cost = usage.cost as Record<string, number> | undefined;
  if (!cost) return;
  const totalCost = (total.cost ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }) as Record<string, number>;
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) totalCost[key] = (totalCost[key] ?? 0) + (cost[key] ?? 0);
}

export function addUsage(total: TokenUsage, usage: TokenUsage): void {
  total.input = (total.input ?? 0) + (usage.input ?? 0);
  total.output = (total.output ?? 0) + (usage.output ?? 0);
  total.cacheRead = (total.cacheRead ?? 0) + (usage.cacheRead ?? 0);
  total.cacheWrite = (total.cacheWrite ?? 0) + (usage.cacheWrite ?? 0);
  total.totalTokens = (total.totalTokens ?? 0) + (usage.totalTokens ?? 0);
  addCost(total, usage);
}

export function createUsageCollector(): { onUsage: (event: { usage?: unknown }) => void; total: TokenUsage } {
  const total: TokenUsage = {};
  return {
    total,
    onUsage: (event) => addUsage(total, (event.usage ?? {}) as TokenUsage),
  };
}

export function sumUsage(records: AgentEvalRecord[], key: 'usage' | 'judgeUsage' | 'agentDebugUsage'): TokenUsage {
  const total: TokenUsage = {};
  for (const record of records) addUsage(total, record[key] ?? {});
  return total;
}

export function sumDuration(records: AgentEvalRecord[], key: 'durationMs' | 'agentDurationMs' | 'judgeDurationMs' | 'agentDebugDurationMs'): number {
  return records.reduce((sum, record) => sum + (record[key] ?? 0), 0);
}
