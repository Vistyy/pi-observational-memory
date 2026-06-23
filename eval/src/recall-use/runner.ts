import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runJudge } from '../lib/judge.js';
import { runPiSdk } from '../lib/pi.js';
import type { TokenUsage } from '../lib/types.js';
import type { Args, ExpectedRecallCall, RecallCall, RecallUseCase, RecallUseRecord } from './types.js';
import { makeMockRecallTool, recallArgs, repoRoot } from './tool.js';

function compareExpectedCall(expected: ExpectedRecallCall, actual: RecallCall, index: number): string[] {
  const failures: string[] = [];
  const call = index + 1;
  if (actual.id !== expected.id) failures.push(`call ${call}: expected id ${expected.id}, got ${actual.id ?? 'omitted'}`);
  if (expected.mode !== undefined && expected.mode !== 'any' && actual.mode !== expected.mode) {
    failures.push(`call ${call}: expected mode ${expected.mode}, got ${actual.mode ?? 'omitted'}`);
  }
  if (expected.depth === undefined) {
    if (actual.depth !== undefined) failures.push(`call ${call}: unexpected depth ${actual.depth}`);
  } else if (expected.depth !== 'any' && actual.depth !== expected.depth) {
    failures.push(`call ${call}: expected depth ${expected.depth}, got ${actual.depth ?? 'omitted'}`);
  }
  return failures;
}

export function compareRecallCalls(expected: ExpectedRecallCall[], calls: RecallCall[]): string[] {
  const failures: string[] = [];
  if (calls.length !== expected.length) failures.push(`expected ${expected.length} recall calls, got ${calls.length}`);
  const used = new Set<number>();
  for (let i = 0; i < expected.length; i += 1) {
    const matchIndex = calls.findIndex((call, index) => !used.has(index) && call.id === expected[i].id);
    if (matchIndex < 0) {
      failures.push(`expected recall id ${expected[i].id}`);
      continue;
    }
    used.add(matchIndex);
    failures.push(...compareExpectedCall(expected[i], calls[matchIndex], i));
  }
  return failures;
}

function answerTextFailures(testCase: RecallUseCase, answer: string): string[] {
  const failures: string[] = [];
  const lower = answer.toLowerCase();
  for (const text of testCase.requiredAnswerText ?? []) {
    if (!lower.includes(text.toLowerCase())) failures.push(`answer missing required text: ${text}`);
  }
  for (const text of testCase.forbiddenAnswerText ?? []) {
    if (lower.includes(text.toLowerCase())) failures.push(`answer included forbidden text: ${text}`);
  }
  return failures;
}

export async function judgeCase(testCase: RecallUseCase, calls: RecallCall[], answer: string, judgeModel: string) {
  if (!testCase.judge) return undefined;
  const payload = JSON.stringify({
    seedMessages: testCase.seedMessages ?? [],
    prompt: testCase.prompt,
    recallCalls: calls,
    finalAnswer: answer,
  }, null, 2);
  return runJudge(testCase.judge, payload, judgeModel);
}

export async function runMockCase(testCase: RecallUseCase, args: Args): Promise<RecallUseRecord> {
  const tool = makeMockRecallTool(testCase.mockResults ?? {});
  const run = await runPiSdk(testCase.prompt, {
    model: args.model,
    thinkingLevel: args.thinkingLevel,
    cwd: repoRoot(),
    customTools: [tool],
    allowedTools: ['recall'],
    seedMessages: testCase.seedMessages,
    maxAgentTurns: args.maxAgentTurns ?? testCase.maxAgentTurns ?? 4,
    timeoutMs: args.timeoutMs,
  });
  const allToolCalls = (run.toolCalls ?? []).map((call) => ({ toolName: call.toolName, args: call.args, isError: call.isError }));
  const calls = (run.toolCalls ?? []).filter((call) => call.toolName === 'recall').map(recallArgs);
  const failures = [...compareRecallCalls(testCase.expectedCalls, calls), ...answerTextFailures(testCase, run.stdout.trim())];
  const judged = failures.length || !args.judge ? undefined : await judgeCase(testCase, calls, run.stdout.trim(), args.judgeModel);
  if (judged && (judged.run.status !== 0 || !judged.judge.passed)) failures.push(`judge failed: ${judged.judge.reason}`);
  if (run.status !== 0) failures.push(`runtime failed: ${run.stderr}`);
  return { id: testCase.id, prompt: testCase.prompt, expectedCalls: testCase.expectedCalls, activeToolNames: run.activeToolNames, calls, allToolCalls, messageTrace: run.messageTrace, passed: failures.length === 0, durationMs: run.durationMs, answer: run.stdout.trim(), stderr: run.stderr, usage: run.usage, judge: judged?.judge, judgeUsage: judged?.run.usage, failures };
}

type SessionEntry = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  customType?: string;
  content?: unknown;
  data?: unknown;
};

const TIMESTAMP = '2026-06-21T13:30:00.000Z';
const REAL_SMOKE_COMMAND = 'pnpm run typecheck && pnpm test';

function writeRealSmokeSession(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-recall-real-smoke-'));
  const file = path.join(dir, 'session.jsonl');
  const entries: SessionEntry[] = [
    {
      type: 'custom',
      id: 'om-obs-smoke',
      parentId: null,
      timestamp: TIMESTAMP,
      customType: 'om.observations.recorded',
      data: {
        observations: [{
          id: 'obs_111111111111',
          kind: 'observation',
          content: `User confirmed the required OM recall-refactor validation command is \`${REAL_SMOKE_COMMAND}\`.`,
          timestamp: TIMESTAMP,
          createdAt: TIMESTAMP,
          sourceEntryIds: ['src-smoke'],
        }],
        coversUpToId: 'src-smoke',
      },
    },
    {
      type: 'custom',
      id: 'om-ref-smoke',
      parentId: 'om-obs-smoke',
      timestamp: TIMESTAMP,
      customType: 'om.reflections.recorded',
      data: {
        reflections: [{
          id: 'ref_222222222222',
          kind: 'reflection',
          content: 'A compacted OM memory contains the required validation command for the recall refactor.',
          sources: ['obs_111111111111'],
          createdAt: TIMESTAMP,
        }],
        coversUpToId: 'om-obs-smoke',
      },
    },
  ];
  const header = { type: 'session', version: 3, id: `recall-real-smoke-${Date.now()}`, timestamp: TIMESTAMP, cwd: repoRoot() };
  fs.writeFileSync(file, `${[header, ...entries].map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return file;
}

export async function runRealSmoke(args: Args): Promise<RecallUseRecord> {
  const prompt = 'Compacted memory ref_222222222222 contains the required OM recall-refactor validation command. What exact command should I run?';
  const run = await runPiSdk(prompt, {
    model: args.model,
    thinkingLevel: args.thinkingLevel,
    cwd: repoRoot(),
    sessionFile: writeRealSmokeSession(),
    extensionPaths: [path.join(repoRoot(), 'index.ts')],
    allowedTools: ['recall'],
    maxAgentTurns: args.maxAgentTurns ?? 4,
    timeoutMs: args.timeoutMs,
  });
  const calls = (run.toolCalls ?? []).filter((call) => call.toolName === 'recall').map(recallArgs);
  const expectedCalls = [{ id: 'ref_222222222222' }];
  const failures = [...compareRecallCalls(expectedCalls, calls), ...answerTextFailures({ id: 'real-smoke', prompt, expectedCalls, requiredAnswerText: [REAL_SMOKE_COMMAND] }, run.stdout.trim())];
  if (calls[0]?.isError) failures.push('real recall tool ended with isError=true');
  if (!calls[0]?.result) failures.push('real recall tool produced no captured result');
  if (run.status !== 0) failures.push(`runtime failed: ${run.stderr}`);
  return { id: 'real-smoke', prompt, expectedCalls, activeToolNames: run.activeToolNames, calls, messageTrace: run.messageTrace, passed: failures.length === 0, durationMs: run.durationMs, answer: run.stdout.trim(), stderr: run.stderr, usage: run.usage, failures };
}

export function summarize(records: RecallUseRecord[]) {
  const passedCount = records.filter((record) => record.passed).length;
  return {
    passed: passedCount === records.length,
    total: records.length,
    passedCount,
    failed: records.filter((record) => !record.passed).map((record) => ({ id: record.id, failures: record.failures, calls: record.calls })),
    usage: records.reduce<TokenUsage>((acc, record) => ({
      input: (acc.input ?? 0) + (record.usage?.input ?? 0) + (record.judgeUsage?.input ?? 0),
      output: (acc.output ?? 0) + (record.usage?.output ?? 0) + (record.judgeUsage?.output ?? 0),
      cacheRead: (acc.cacheRead ?? 0) + (record.usage?.cacheRead ?? 0) + (record.judgeUsage?.cacheRead ?? 0),
      cacheWrite: (acc.cacheWrite ?? 0) + (record.usage?.cacheWrite ?? 0) + (record.judgeUsage?.cacheWrite ?? 0),
      totalTokens: (acc.totalTokens ?? 0) + (record.usage?.totalTokens ?? 0) + (record.judgeUsage?.totalTokens ?? 0),
    }), {}),
  };
}
