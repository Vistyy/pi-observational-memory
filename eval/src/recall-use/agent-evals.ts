import fs from 'node:fs';
import path from 'node:path';
import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import { DEFAULT_MODEL } from '../lib/pi.js';
import { cases } from './cases/index.js';
import { runMockCase, runRealSmoke, summarize } from './runner.js';
import type { Args, RecallUseRecord } from './types.js';

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback?: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  return {
    model: get('--model', DEFAULT_MODEL)!,
    judgeModel: get('--judge-model', get('--model', DEFAULT_MODEL))!,
    outDir: get('--out', path.join('runs', `recall-use-evals-${Date.now()}`))!,
    thinkingLevel: (get('--thinking', 'low') ?? 'low') as ModelThinkingLevel,
    realSmoke: argv.includes('--real-smoke'),
    caseId: get('--case'),
    all: argv.includes('--all'),
    judge: argv.includes('--judge'),
    timeoutMs: Number(get('--timeout-ms', '30000')),
    maxAgentTurns: get('--max-agent-turns') ? Number(get('--max-agent-turns')) : undefined,
  };
}

export async function main() {
  const args = parseArgs();
  fs.mkdirSync(args.outDir, { recursive: true });
  const selectedCases = args.caseId ? cases.filter((testCase) => testCase.id === args.caseId) : args.all ? cases : cases.slice(0, 1);
  if (args.caseId && selectedCases.length === 0) throw new Error(`unknown case: ${args.caseId}`);
  if (!args.caseId && !args.all) {
    console.error('No --case or --all supplied; running first case only. Use --all for the full mock suite.');
  }
  const records: RecallUseRecord[] = [];
  for (const testCase of selectedCases) records.push(await runMockCase(testCase, args));
  if (args.realSmoke) records.push(await runRealSmoke(args));
  fs.writeFileSync(path.join(args.outDir, 'results.json'), JSON.stringify(records, null, 2));
  const summary = summarize(records);
  fs.writeFileSync(path.join(args.outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.passed) process.exitCode = 1;
}
