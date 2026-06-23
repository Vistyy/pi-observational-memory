import fs from 'node:fs';
import path from 'node:path';
import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import { DEFAULT_MODEL } from '../lib/pi.js';
import type { AgentEvalRecord, OmEvalOptions } from './types.js';
import { sumDuration, sumUsage } from './runner.js';
import { allCases } from './cases/index.js';
import { debugRecordFailure } from './agent-debug.js';

type Args = { model: string; judgeModel: string; outDir: string; thinkingLevel: ModelThinkingLevel; only?: string; suite: 'baseline' | 'stress' | 'all'; caseTimeoutMs: number; diagnose: boolean; trials: number };

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (name: string, fallback?: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  return {
    model: get('--model', DEFAULT_MODEL)!,
    judgeModel: get('--judge-model', get('--model', DEFAULT_MODEL))!,
    outDir: get('--out', path.join('runs', `om-agent-evals-${Date.now()}`))!,
    thinkingLevel: (get('--thinking', 'low') ?? 'low') as ModelThinkingLevel,
    only: get('--only'),
    suite: (get('--suite', 'baseline') ?? 'baseline') as Args['suite'],
    caseTimeoutMs: Number(get('--case-timeout-ms', '600000') ?? '600000'),
    diagnose: args.includes('--diagnose'),
    trials: Math.max(1, Number(get('--trials', '1') ?? '1')),
  };
}

export async function main() {
  const args = parseArgs();
  const evalOptions: OmEvalOptions = { diagnose: args.diagnose };
  fs.mkdirSync(args.outDir, { recursive: true });
  const suiteCases = allCases.filter((c) => args.suite === 'all' || c.suite === args.suite);
  const cases = args.only ? suiteCases.filter((c) => c.id.includes(args.only!)) : suiteCases;
  const records: AgentEvalRecord[] = [];
  for (const c of cases) {
    for (let trial = 1; trial <= args.trials; trial++) {
      try {
        let record = await Promise.race([
          c.run(args.model, args.judgeModel, args.thinkingLevel, evalOptions),
          new Promise<AgentEvalRecord>((_, reject) => setTimeout(() => reject(new Error(`case timed out after ${args.caseTimeoutMs}ms`)), args.caseTimeoutMs)),
        ]);
        if (record.id !== c.id || record.agent !== c.agent) throw new Error(`case metadata mismatch: registry=${c.id}/${c.agent}, record=${record.id}/${record.agent}`);
        record = { ...record, trial };
        if (args.diagnose) record = await debugRecordFailure(record, { modelSpec: args.model, thinkingLevel: args.thinkingLevel });
        records.push(record);
      }
      catch (error) {
        records.push({ id: c.id, agent: c.agent, output: undefined, passed: false, durationMs: 0, trial, error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
      }
      fs.writeFileSync(path.join(args.outDir, 'results.partial.json'), JSON.stringify(records, null, 2));
    }
  }
  const scoredRecords = records.filter((r) => r.score);
  const byAgent = Object.fromEntries(['observer', 'reflector', 'rewrite', 'maintainer'].map((agent) => {
    const agentRecords = records.filter((record) => record.agent === agent);
    return [agent, {
      passed: agentRecords.filter((record) => record.passed).length,
      total: agentRecords.length,
      agentDurationMs: sumDuration(agentRecords, 'agentDurationMs'),
      usage: sumUsage(agentRecords, 'usage'),
    }];
  }).filter(([, value]) => (value as { total: number }).total > 0));
  const perCase = records.map((record) => ({
    id: record.id,
    agent: record.agent,
    trial: record.trial,
    passed: record.passed,
    agentDurationMs: record.agentDurationMs ?? 0,
    usage: record.usage ?? {},
    score: record.score ? { score: record.score.score, maxScore: record.score.maxScore, hardFailed: record.score.hardFailed } : undefined,
  }));
  const summary = {
    passed: records.filter((r) => r.passed).length,
    total: records.length,
    score: scoredRecords.reduce((total, r) => total + (r.score?.score ?? 0), 0),
    maxScore: scoredRecords.reduce((total, r) => total + (r.score?.maxScore ?? 0), 0),
    failed: records.filter((r) => !r.passed).map((r) => ({ id: r.id, agent: r.agent, trial: r.trial, judge: r.judge, agentDebug: r.agentDebug, error: r.error })),
    durationMs: sumDuration(records, 'durationMs'),
    agentDurationMs: sumDuration(records, 'agentDurationMs'),
    judgeDurationMs: sumDuration(records, 'judgeDurationMs'),
    agentDebugDurationMs: sumDuration(records, 'agentDebugDurationMs'),
    usage: sumUsage(records, 'usage'),
    judgeUsage: sumUsage(records, 'judgeUsage'),
    agentDebugUsage: sumUsage(records, 'agentDebugUsage'),
    byAgent,
    perCase,
  };
  fs.writeFileSync(path.join(args.outDir, 'results.json'), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(args.outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.passed === summary.total ? 0 : 1);
}

