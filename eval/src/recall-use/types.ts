import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { MessageTraceRecord } from '../lib/pi.js';
import type { Probe, TokenUsage } from '../lib/types.js';

export type SeedMessage = { role: 'user' | 'assistant'; content: string };

export type RecallMode = 'evidence' | 'provenance';

export type ExpectedRecallCall = {
  id: string;
  mode?: RecallMode | 'any';
  depth?: number | 'any';
};

export type RecallUseCase = {
  id: string;
  prompt: string;
  seedMessages?: SeedMessage[];
  expectedCalls: ExpectedRecallCall[];
  mockResults?: Record<string, string>;
  requiredAnswerText?: string[];
  forbiddenAnswerText?: string[];
  judge?: Probe;
  maxAgentTurns?: number;
};

export type RecallCall = {
  id?: string;
  mode?: RecallMode;
  depth?: number;
  result?: unknown;
  isError?: boolean;
};

export type RecallUseRecord = {
  id: string;
  prompt: string;
  expectedCalls: ExpectedRecallCall[];
  activeToolNames?: string[];
  calls: RecallCall[];
  allToolCalls?: Array<{ toolName: string; args: unknown; isError?: boolean }>;
  messageTrace?: MessageTraceRecord[];
  passed: boolean;
  durationMs: number;
  answer: string;
  stderr: string;
  usage?: TokenUsage;
  judge?: unknown;
  judgeUsage?: TokenUsage;
  failures: string[];
};

export type Args = {
  model: string;
  judgeModel: string;
  outDir: string;
  thinkingLevel: ModelThinkingLevel;
  realSmoke: boolean;
  caseId?: string;
  all: boolean;
  judge: boolean;
  timeoutMs: number;
  maxAgentTurns?: number;
};
