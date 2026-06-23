import fs from 'node:fs';
import path from 'node:path';
import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { ToolCallRecord } from '../lib/pi.js';
import type { RecallCall } from './types.js';

export function repoRoot(): string {
  return path.basename(process.cwd()) === 'eval' ? path.resolve(process.cwd(), '..') : process.cwd();
}

type RecallToolText = {
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  idDescription: string;
  modeDescription: string;
  depthDescription: string;
};

export function loadRecallToolText(): RecallToolText {
  const constantsPath = path.join(repoRoot(), 'src/tools/recall/constants.ts');
  const source = fs.readFileSync(constantsPath, 'utf8');
  const match = source.match(/export const RECALL_TOOL_TEXT = (\{[\s\S]*?\n\}) as const;/);
  if (!match?.[1]) throw new Error(`failed to extract RECALL_TOOL_TEXT from ${constantsPath}`);
  return Function(`"use strict"; return (${match[1]});`)() as RecallToolText;
}

export const RECALL_TOOL_TEXT = loadRecallToolText();

export function recallArgs(call: ToolCallRecord): RecallCall {
  const args = call.args as { id?: unknown; mode?: unknown; depth?: unknown } | undefined;
  return {
    id: typeof args?.id === 'string' ? args.id : undefined,
    mode: args?.mode === 'evidence' || args?.mode === 'provenance' ? args.mode : undefined,
    depth: typeof args?.depth === 'number' ? args.depth : undefined,
    result: call.result,
    isError: call.isError,
  };
}

export function makeMockRecallTool(results: Record<string, string> = {}): ToolDefinition {
  return defineTool({
    name: 'recall',
    label: 'Recall memory evidence',
    description: RECALL_TOOL_TEXT.description,
    promptSnippet: RECALL_TOOL_TEXT.promptSnippet,
    promptGuidelines: [...RECALL_TOOL_TEXT.promptGuidelines],
    parameters: Type.Object({
      id: Type.String({
        pattern: '^(?:[a-f0-9]{12}|obs_[a-f0-9]{12}|ref_[a-f0-9]{12})$',
        description: RECALL_TOOL_TEXT.idDescription,
      }),
      mode: Type.Optional(Type.Union([Type.Literal('evidence'), Type.Literal('provenance')], { description: RECALL_TOOL_TEXT.modeDescription })),
      depth: Type.Optional(Type.Number({ description: RECALL_TOOL_TEXT.depthDescription })),
    }),
    async execute(_toolCallId, params) {
      const text = results[params.id] ?? `No mock recall fixture for ${params.id}`;
      return { content: [{ type: 'text' as const, text }], details: { mock: true, memoryId: params.id } };
    },
  });
}
