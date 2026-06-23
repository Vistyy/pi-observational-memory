import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { TokenUsage } from '../lib/types.js';

export type Observation = { id: string; content: string; timestamp: string; sourceEntryIds: string[]; tokenCount: number };
export type Reflection = { id: string; content: string; sources: string[]; tokenCount: number };

export type RewriteResult = { reflections: Reflection[]; summary?: string };
export type MaintenanceResult = { retireReflectionIds: string[]; reflections: Reflection[] };

export type OmAgents = {
  runObserver: (args: Record<string, unknown>) => Promise<Observation[] | undefined>;
  runReflector: (args: Record<string, unknown>) => Promise<Reflection[] | undefined>;
  runRewrite: (args: Record<string, unknown>) => Promise<RewriteResult | undefined>;
  runMaintainer: (args: Record<string, unknown>) => Promise<MaintenanceResult | undefined>;
};

export type AgentEvalRecord = {
  id: string;
  agent: 'observer' | 'reflector' | 'rewrite' | 'maintainer';
  output: unknown;
  judge?: unknown;
  passed: boolean;
  durationMs: number;
  agentDurationMs?: number;
  judgeDurationMs?: number;
  usage?: TokenUsage;
  judgeUsage?: TokenUsage;
  diagnostics?: unknown;
  agentDebug?: unknown;
  agentDebugUsage?: TokenUsage;
  agentDebugDurationMs?: number;
  error?: string;
  trial?: number;
  score?: EvalScore;
};

export type OmGrader<TOutput = unknown> = {
  label: string;
  required?: boolean;
  pass: (output: TOutput | undefined) => boolean;
  detail?: (output: TOutput | undefined) => unknown;
};
export type EvalScoreDimension = { label: string; required: boolean; passed: boolean; detail?: unknown };
export type EvalScore = { hardFailed: boolean; score: number; maxScore: number; dimensions: EvalScoreDimension[] };
export type OmEvalOptions = { diagnose?: boolean };
export type OmEvalSuite = 'baseline' | 'stress';
export type OmEvalCase = {
  id: string;
  agent: AgentEvalRecord['agent'];
  suite: OmEvalSuite;
  run: (model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel, options?: OmEvalOptions) => Promise<AgentEvalRecord>;
};
