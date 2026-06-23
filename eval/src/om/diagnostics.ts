import { runJudge } from '../lib/judge.js';
import type { Probe, TokenUsage } from '../lib/types.js';
import type { AgentEvalRecord, EvalScoreDimension, MaintenanceResult, Observation, OmGrader, Reflection } from './types.js';

const MIN_SCORED_PASS_RATIO = 0.5;

export function optional<TOutput>(grader: OmGrader<TOutput>): OmGrader<TOutput> {
  return { ...grader, required: false };
}

export async function gradeAgentOutput<TOutput>(args: {
  id: string;
  agent: AgentEvalRecord['agent'];
  output: TOutput | undefined;
  probe: Probe;
  judgeModel: string;
  started: number;
  graders: OmGrader<TOutput>[];
  usage?: TokenUsage;
  agentDurationMs?: number;
  diagnostics?: unknown;
  noToolCallLabel?: string;
  providerError?: string;
}): Promise<AgentEvalRecord> {
  const outputFailureLabel = args.providerError ? `Provider error: ${args.providerError}` : args.noToolCallLabel;
  const graders: OmGrader<TOutput>[] = args.output === undefined && outputFailureLabel
    ? [{ label: outputFailureLabel, required: true, pass: () => false }, ...args.graders]
    : args.graders;
  const dimensions: EvalScoreDimension[] = graders.map((grader) => {
    const passed = grader.pass(args.output);
    const required = grader.required !== false;
    return { label: grader.label, required, passed, detail: grader.detail?.(args.output) ?? args.output };
  });
  const failedRequired = dimensions.filter((dimension) => dimension.required && !dimension.passed);
  const optionalDimensions = dimensions.filter((dimension) => !dimension.required);
  const score = optionalDimensions.filter((dimension) => dimension.passed).length;
  const maxScore = optionalDimensions.length;
  const diagnostics = args.diagnostics as { forceJudge?: boolean; skipJudge?: boolean } | undefined;
  const forceJudge = Boolean(diagnostics?.forceJudge);
  const skipJudge = Boolean(diagnostics?.skipJudge);
  const scoreFailure = failedRequired.length === 0 && maxScore > 0 && score / maxScore < MIN_SCORED_PASS_RATIO;
  const deterministicPass = !forceJudge && failedRequired.length === 0 && !scoreFailure && (skipJudge || (maxScore > 0 && score === maxScore));
  const judgeStarted = Date.now();
  const judged = failedRequired.length > 0 || scoreFailure || deterministicPass ? undefined : await runJudge(args.probe, JSON.stringify(args.output ?? [], null, 2), args.judgeModel);
  return {
    id: args.id,
    agent: args.agent,
    output: args.output ?? [],
    judge: failedRequired.length > 0
      ? { passed: false, reason: `Required graders failed: ${failedRequired.map((dimension) => dimension.label).join('; ')}`, details: failedRequired }
      : scoreFailure
        ? { passed: false, reason: `Optional grader score below threshold: ${score}/${maxScore}` }
        : deterministicPass
          ? { passed: true, reason: 'Deterministic graders passed.' }
          : judged?.judge,
    passed: deterministicPass || (failedRequired.length === 0 && !scoreFailure && judged?.run.status === 0 && judged.judge.passed),
    durationMs: Date.now() - args.started,
    agentDurationMs: args.agentDurationMs,
    judgeDurationMs: failedRequired.length > 0 || scoreFailure || deterministicPass ? undefined : Date.now() - judgeStarted,
    usage: args.usage,
    judgeUsage: judged?.run.usage,
    diagnostics: args.diagnostics,
    score: { hardFailed: failedRequired.length > 0, score, maxScore, dimensions },
  };
}

export function observerText(output: Observation[] | undefined): string {
  return (output ?? []).map((observation) => observation.content).join('\n');
}

export function observerSourceIds(output: Observation[] | undefined): string[] {
  return (output ?? []).flatMap((observation) => observation.sourceEntryIds);
}

export function observerRequiresAll(...needles: string[]): OmGrader<Observation[]> {
  return { label: `requires ${needles.join(', ')}`, pass: (output) => needles.every((needle) => observerText(output).includes(needle)), detail: (output) => observerText(output) };
}

export function observerForbidsAny(...needles: string[]): OmGrader<Observation[]> {
  return { label: `forbids ${needles.join(', ')}`, pass: (output) => needles.every((needle) => !observerText(output).includes(needle)), detail: (output) => observerText(output) };
}

export function observerMaxCount(max: number): OmGrader<Observation[]> {
  return { label: `at most ${max} observations`, pass: (output) => (output ?? []).length <= max, detail: (output) => ({ count: (output ?? []).length }) };
}

export function observerForbidsSourceIds(...ids: string[]): OmGrader<Observation[]> {
  return { label: `forbids source ids ${ids.join(', ')}`, pass: (output) => ids.every((id) => !observerSourceIds(output).includes(id)), detail: (output) => observerSourceIds(output) };
}

export function observerSourceIdsAllowed(allowedIds: string[]): OmGrader<Observation[]> {
  const allowed = new Set(allowedIds);
  return { label: `source ids limited to ${allowedIds.join(', ')}`, pass: (output) => observerSourceIds(output).every((id) => allowed.has(id)), detail: (output) => observerSourceIds(output) };
}

export function reflectionText(output: Reflection[] | undefined): string {
  return (output ?? []).map((reflection) => reflection.content).join('\n');
}

export function reflectionSourceIds(output: Reflection[] | undefined): string[] {
  return (output ?? []).flatMap((reflection) => reflection.sources);
}

export function reflectorRequiresAll(...needles: string[]): OmGrader<Reflection[]> {
  return { label: `requires ${needles.join(', ')}`, pass: (output) => needles.every((needle) => reflectionText(output).includes(needle)), detail: (output) => reflectionText(output) };
}

export function reflectorRequiresAny(...needles: string[]): OmGrader<Reflection[]> {
  return { label: `requires any of ${needles.join(', ')}`, pass: (output) => {
    const text = reflectionText(output).toLowerCase();
    return needles.some((needle) => text.includes(needle.toLowerCase()));
  }, detail: (output) => reflectionText(output) };
}

export function reflectorForbidsAny(...needles: string[]): OmGrader<Reflection[]> {
  return { label: `forbids ${needles.join(', ')}`, pass: (output) => needles.every((needle) => !reflectionText(output).includes(needle)), detail: (output) => reflectionText(output) };
}

export function reflectorMaxCount(max: number): OmGrader<Reflection[]> {
  return { label: `at most ${max} reflections`, pass: (output) => (output ?? []).length <= max, detail: (output) => ({ count: (output ?? []).length }) };
}

export function reflectorForbidsSourceIds(...ids: string[]): OmGrader<Reflection[]> {
  return { label: `forbids source ids ${ids.join(', ')}`, pass: (output) => ids.every((id) => !reflectionSourceIds(output).includes(id)), detail: (output) => reflectionSourceIds(output) };
}

export function reflectorSourceIdsAllowed(allowedIds: string[]): OmGrader<Reflection[]> {
  const allowed = new Set(allowedIds);
  return { label: `source ids limited to ${allowedIds.join(', ')}`, pass: (output) => reflectionSourceIds(output).every((id) => allowed.has(id)), detail: (output) => reflectionSourceIds(output) };
}

export function maintenanceText(output: MaintenanceResult | undefined): string {
  return (output?.reflections ?? []).map((reflection) => reflection.content).join('\n');
}

export function maintenanceRetireIds(output: MaintenanceResult | undefined): string[] {
  return output?.retireReflectionIds ?? [];
}

export function maintenanceSourceIds(output: MaintenanceResult | undefined): string[] {
  return (output?.reflections ?? []).flatMap((reflection) => reflection.sources);
}

export function maintenanceNoop(): OmGrader<MaintenanceResult> {
  return {
    label: 'no maintenance output',
    pass: (output) => maintenanceRetireIds(output).length === 0 && (output?.reflections ?? []).length === 0,
    detail: (output) => ({ retireReflectionIds: maintenanceRetireIds(output), reflectionCount: output?.reflections.length ?? 0 }),
  };
}

export function maintenanceRetireIdsAllowed(allowedIds: string[]): OmGrader<MaintenanceResult> {
  const allowed = new Set(allowedIds);
  return { label: `retire ids limited to ${allowedIds.join(', ')}`, pass: (output) => maintenanceRetireIds(output).every((id) => allowed.has(id)), detail: (output) => maintenanceRetireIds(output) };
}

export function maintenanceRequiresRetireIds(...ids: string[]): OmGrader<MaintenanceResult> {
  return { label: `retires ${ids.join(', ')}`, pass: (output) => {
    const retired = new Set(maintenanceRetireIds(output));
    return ids.every((id) => retired.has(id));
  }, detail: (output) => maintenanceRetireIds(output) };
}

export function maintenanceForbidsRetireIds(...ids: string[]): OmGrader<MaintenanceResult> {
  return { label: `does not retire ${ids.join(', ')}`, pass: (output) => {
    const retired = new Set(maintenanceRetireIds(output));
    return ids.every((id) => !retired.has(id));
  }, detail: (output) => maintenanceRetireIds(output) };
}

export function maintenanceRetireCountBetween(min: number, max: number): OmGrader<MaintenanceResult> {
  return { label: `retires ${min}-${max} refs`, pass: (output) => {
    const count = maintenanceRetireIds(output).length;
    return count >= min && count <= max;
  }, detail: (output) => ({ count: maintenanceRetireIds(output).length }) };
}

export function maintenanceSourceIdsAllowed(allowedIds: string[]): OmGrader<MaintenanceResult> {
  const allowed = new Set(allowedIds);
  return { label: `source ids limited to ${allowedIds.join(', ')}`, pass: (output) => maintenanceSourceIds(output).every((id) => allowed.has(id)), detail: (output) => maintenanceSourceIds(output) };
}

export function maintenanceSourcesAreDirectRefs(): OmGrader<MaintenanceResult> {
  return { label: 'sources are direct ref_* parents', pass: (output) => maintenanceSourceIds(output).every((id) => id.startsWith('ref_')), detail: (output) => maintenanceSourceIds(output) };
}

export function maintenanceEveryRetiredRefCovered(): OmGrader<MaintenanceResult> {
  return {
    label: 'every retired ref is cited by a replacement',
    pass: (output) => {
      const sources = new Set(maintenanceSourceIds(output));
      return maintenanceRetireIds(output).every((id) => sources.has(id));
    },
    detail: (output) => ({ retireReflectionIds: maintenanceRetireIds(output), sources: maintenanceSourceIds(output) }),
  };
}

export function maintenanceRequiresAll(...needles: string[]): OmGrader<MaintenanceResult> {
  return { label: `requires ${needles.join(', ')}`, pass: (output) => needles.every((needle) => maintenanceText(output).includes(needle)), detail: (output) => maintenanceText(output) };
}

export function maintenanceRequiresAny(...needles: string[]): OmGrader<MaintenanceResult> {
  return { label: `requires any of ${needles.join(', ')}`, pass: (output) => {
    const text = maintenanceText(output).toLowerCase();
    return needles.some((needle) => text.includes(needle.toLowerCase()));
  }, detail: (output) => maintenanceText(output) };
}

export function maintenanceForbidsAny(...needles: string[]): OmGrader<MaintenanceResult> {
  return { label: `forbids ${needles.join(', ')}`, pass: (output) => needles.every((needle) => !maintenanceText(output).includes(needle)), detail: (output) => maintenanceText(output) };
}

export function maintenanceMaxNewReflections(max: number): OmGrader<MaintenanceResult> {
  return { label: `at most ${max} new reflections`, pass: (output) => (output?.reflections ?? []).length <= max, detail: (output) => ({ count: output?.reflections.length ?? 0 }) };
}

export function maintenanceMaxRetiredRefs(max: number): OmGrader<MaintenanceResult> {
  return { label: `at most ${max} retired refs`, pass: (output) => maintenanceRetireIds(output).length <= max, detail: (output) => ({ count: maintenanceRetireIds(output).length }) };
}
