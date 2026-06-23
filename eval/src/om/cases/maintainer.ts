import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { Probe } from '../../lib/types.js';
import { runMaintainerEval } from '../agent-runner.js';
import type { AgentEvalRecord, MaintenanceResult, OmEvalSuite, OmGrader, Reflection } from '../types.js';
import { gradeAgentOutput, maintenanceEveryRetiredRefCovered, maintenanceForbidsAny, maintenanceForbidsRetireIds, maintenanceMaxNewReflections, maintenanceMaxRetiredRefs, maintenanceNoop, maintenanceRequiresAll, maintenanceRequiresAny, maintenanceRequiresRetireIds, maintenanceRetireCountBetween, maintenanceRetireIdsAllowed, maintenanceSourceIdsAllowed, maintenanceSourcesAreDirectRefs, optional } from '../diagnostics.js';
import { ref } from '../runner.js';

export type MaintainerEvalSpec = {
  id: string;
  suite: OmEvalSuite;
  reflections: Reflection[];
  probe: Probe;
  graders: OmGrader<MaintenanceResult>[];
  forceJudge?: boolean;
  skipJudge?: boolean;
};

const localReplacementGuards = (reflections: Reflection[]): OmGrader<MaintenanceResult>[] => {
  const ids = reflections.map((reflection) => reflection.id);
  return [
    maintenanceRetireIdsAllowed(ids),
    maintenanceSourceIdsAllowed(ids),
    maintenanceSourcesAreDirectRefs(),
    maintenanceEveryRetiredRefCovered(),
    maintenanceMaxRetiredRefs(4),
    maintenanceMaxNewReflections(2),
  ];
};

export const maintainerDuplicateMerge: MaintainerEvalSpec = {
  id: 'maintainer-duplicate-merge',
  suite: 'baseline',
  reflections: [
    ref('100000000001', 'Use `pnpm` instead of `npm` for this repository.', ['obs_aaaaaaaaaaaa']),
    ref('100000000002', 'Project commands should use pnpm, not npm.', ['obs_bbbbbbbbbbbb']),
    ref('100000000003', 'Compaction must not run memory agents synchronously.', ['obs_cccccccccccc']),
  ],
  probe: {
    id: 'maintainer-duplicate-merge',
    question: 'Merge only the duplicate package-manager reflections and preserve direct-parent provenance.',
    rubric: {
      pass_if: ['Retires only duplicate input refs.', 'Emits one replacement that preserves pnpm-over-npm behavior.', 'Replacement sources cite the retired ref_* parents, not obs_* ancestors.'],
      fail_if: ['Retires the unrelated compaction reflection.', 'Copies obs_* ancestry into the replacement.', 'Leaves duplicate package-manager refs unmerged.'],
    },
  },
  graders: [
    ...localReplacementGuards([
      ref('100000000001', 'Use `pnpm` instead of `npm` for this repository.', ['obs_aaaaaaaaaaaa']),
      ref('100000000002', 'Project commands should use pnpm, not npm.', ['obs_bbbbbbbbbbbb']),
      ref('100000000003', 'Compaction must not run memory agents synchronously.', ['obs_cccccccccccc']),
    ]),
    maintenanceRequiresRetireIds('ref_100000000001', 'ref_100000000002'),
    maintenanceForbidsRetireIds('ref_100000000003'),
    maintenanceRetireCountBetween(2, 2),
    maintenanceRequiresAll('pnpm'),
    maintenanceForbidsAny('obs_aaaaaaaaaaaa', 'obs_bbbbbbbbbbbb'),
  ],
};

export const maintainerStaleCurrentPair: MaintainerEvalSpec = {
  id: 'maintainer-stale-current-pair',
  suite: 'baseline',
  forceJudge: true,
  reflections: [
    ref('200000000001', 'Old preference: generate API clients with `toolkit-v1`.', ['obs_aaaaaaaaaaaa']),
    ref('200000000002', 'Current preference: `toolkit-v2` replaced `toolkit-v1` for API client generation.', ['obs_bbbbbbbbbbbb']),
    ref('200000000003', 'Use short direct answers unless the user asks for detail.', ['obs_cccccccccccc']),
  ],
  probe: {
    id: 'maintainer-stale-current-pair',
    question: 'Combine the local stale/current pair without disturbing unrelated active memory.',
    rubric: {
      pass_if: ['Retires only the stale/current pair.', 'Emits a replacement that makes toolkit-v2 current and toolkit-v1 stale/replaced.', 'Uses direct ref_* parents as sources.'],
      fail_if: ['Keeps toolkit-v1 as current.', 'Retires the unrelated response-style preference.', 'Drops the stale/current relationship.'],
    },
  },
  graders: [
    ...localReplacementGuards([
      ref('200000000001', 'Old preference: generate API clients with `toolkit-v1`.', ['obs_aaaaaaaaaaaa']),
      ref('200000000002', 'Current preference: `toolkit-v2` replaced `toolkit-v1` for API client generation.', ['obs_bbbbbbbbbbbb']),
      ref('200000000003', 'Use short direct answers unless the user asks for detail.', ['obs_cccccccccccc']),
    ]),
    maintenanceRequiresRetireIds('ref_200000000001', 'ref_200000000002'),
    maintenanceForbidsRetireIds('ref_200000000003'),
    maintenanceRetireCountBetween(2, 2),
    maintenanceRequiresAll('toolkit-v2'),
    maintenanceRequiresAny('stale', 'replaced', 'replaces', 'replacing', 'superseded', 'no longer'),
  ],
};

export const maintainerCompletedTrailCompression: MaintainerEvalSpec = {
  id: 'maintainer-completed-trail-compression',
  suite: 'baseline',
  reflections: [
    ref('300000000001', 'Migration step 1 added typed ids to data records.', ['obs_aaaaaaaaaaaa']),
    ref('300000000002', 'Migration step 2 updated recall traversal for typed ids.', ['obs_bbbbbbbbbbbb']),
    ref('300000000003', 'The typed-id migration is complete and validation passed with the required package commands.', ['obs_cccccccccccc']),
    ref('300000000004', 'A later cost investigation remains deferred.', ['obs_dddddddddddd']),
  ],
  probe: {
    id: 'maintainer-completed-trail-compression',
    question: 'Compress completed local implementation trail into a durable current outcome.',
    rubric: {
      pass_if: ['Replaces step-by-step trail with a current completed outcome.', 'Keeps meaningful validation state.', 'Does not retire the unrelated deferred-task reflection.'],
      fail_if: ['Keeps only procedural step breadcrumbs.', 'Drops the completed/validated status.', 'Retires unrelated deferred work.'],
    },
  },
  graders: [
    ...localReplacementGuards([
      ref('300000000001', 'Migration step 1 added typed ids to data records.', ['obs_aaaaaaaaaaaa']),
      ref('300000000002', 'Migration step 2 updated recall traversal for typed ids.', ['obs_bbbbbbbbbbbb']),
      ref('300000000003', 'The typed-id migration is complete and validation passed with the required package commands.', ['obs_cccccccccccc']),
      ref('300000000004', 'A later cost investigation remains deferred.', ['obs_dddddddddddd']),
    ]),
    maintenanceRequiresRetireIds('ref_300000000001', 'ref_300000000002', 'ref_300000000003'),
    maintenanceForbidsRetireIds('ref_300000000004'),
    maintenanceRetireCountBetween(3, 3),
    maintenanceRequiresAny('complete', 'current'),
    maintenanceRequiresAny('validation', 'passed'),
    optional(maintenanceMaxNewReflections(1)),
  ],
};

export const maintainerUnrelatedNoop: MaintainerEvalSpec = {
  id: 'maintainer-unrelated-noop',
  suite: 'baseline',
  reflections: [
    ref('400000000001', 'Use `pnpm` instead of `npm` for this repository.', ['obs_aaaaaaaaaaaa']),
    ref('400000000002', 'Compaction must not run memory agents synchronously.', ['obs_bbbbbbbbbbbb']),
    ref('400000000003', 'Recall exact ids before relying on memory for exact commands or errors.', ['obs_cccccccccccc']),
  ],
  probe: {
    id: 'maintainer-unrelated-noop',
    question: 'Return no-op when a small cluster has no safe local merge or replacement.',
    rubric: {
      pass_if: ['No retire ids.', 'No replacement reflections.'],
      fail_if: ['Forces unrelated facts into a vague summary.', 'Retires any active reflection.'],
    },
  },
  graders: [maintenanceNoop()],
};

export const maintainerDirectParentProvenance: MaintainerEvalSpec = {
  id: 'maintainer-direct-parent-provenance',
  suite: 'baseline',
  reflections: [
    ref('500000000001', 'Retry policy uses one bounded provider retry for temporary provider errors.', ['obs_aaaaaaaaaaaa', 'obs_bbbbbbbbbbbb']),
    ref('500000000002', 'Provider errors surface as distinct MemoryAgentProviderError failures after retries exhaust.', ['obs_cccccccccccc']),
  ],
  probe: {
    id: 'maintainer-direct-parent-provenance',
    question: 'When merging refs with obs ancestry, cite only direct ref_* parents in the replacement.',
    rubric: {
      pass_if: ['Replacement sources are the retired ref_* parents.', 'No obs_* transitive ancestry is copied into the replacement.', 'The merged content preserves retry and provider-error behavior.'],
      fail_if: ['Sources include obs_* ids copied from parent refs.', 'Drops either retry behavior or distinct provider-error behavior.'],
    },
  },
  graders: [
    ...localReplacementGuards([
      ref('500000000001', 'Retry policy uses one bounded provider retry for temporary provider errors.', ['obs_aaaaaaaaaaaa', 'obs_bbbbbbbbbbbb']),
      ref('500000000002', 'Provider errors surface as distinct MemoryAgentProviderError failures after retries exhaust.', ['obs_cccccccccccc']),
    ]),
    maintenanceRequiresRetireIds('ref_500000000001', 'ref_500000000002'),
    maintenanceRetireCountBetween(2, 2),
    maintenanceRequiresAny('retry', 'retries'),
    maintenanceRequiresAny('ProviderError', 'provider error'),
  ],
};

export const maintainerBlastRadiusGuard: MaintainerEvalSpec = {
  id: 'maintainer-blast-radius-guard',
  suite: 'baseline',
  skipJudge: true,
  reflections: [
    ref('600000000001', 'Status command should report maintainer pressure when the active memory budget is high.', ['obs_aaaaaaaaaaaa']),
    ref('600000000002', 'Status command should avoid exposing raw observations in normal active memory output.', ['obs_bbbbbbbbbbbb']),
  ],
  probe: {
    id: 'maintainer-blast-radius-guard',
    question: 'Never retire or source refs outside the bounded maintainer input cluster.',
    rubric: {
      pass_if: ['Any retire ids are limited to the supplied cluster.', 'Any replacement sources are limited to supplied cluster refs.'],
      fail_if: ['Retires an id not present in input.', 'Uses a source id not present in input.'],
    },
  },
  graders: [
    maintenanceRetireIdsAllowed(['ref_600000000001', 'ref_600000000002']),
    maintenanceSourceIdsAllowed(['ref_600000000001', 'ref_600000000002']),
    maintenanceSourcesAreDirectRefs(),
    maintenanceMaxRetiredRefs(4),
    maintenanceMaxNewReflections(2),
  ],
};

const noisyDuplicateReflections = [
  ref('700000000001', 'Project commands should use pnpm in this repo.', ['obs_aaaaaaaaaaaa']),
  ref('700000000002', 'The validation command for the extension is `pnpm run typecheck && pnpm test` from its package directory.', ['obs_bbbbbbbbbbbb']),
  ref('700000000003', 'Status output should report maintainer pressure when active reflection memory grows.', ['obs_cccccccccccc']),
  ref('700000000004', 'Compaction should only flush the observer tail and render deterministic active memory.', ['obs_dddddddddddd']),
  ref('700000000005', 'Recall exact ids before relying on memory for exact commands or errors.', ['obs_eeeeeeeeeeee']),
  ref('700000000006', 'Use pnpm rather than npm when running package scripts.', ['obs_ffffffffffff']),
  ref('700000000007', 'Provider stopReason error events get one bounded retry before surfacing a provider error.', ['obs_111111111111']),
  ref('700000000008', 'Observer input should not treat assistant toolCall payloads as semantic evidence.', ['obs_222222222222']),
  ref('700000000009', 'Maintainer replacements cite direct ref parents instead of flattened observation ancestry.', ['obs_333333333333']),
  ref('700000000010', 'Routine validation receipts should not become memory unless they mark a blocker or final risky state.', ['obs_444444444444']),
];

export const maintainerNoisyDuplicateMerge: MaintainerEvalSpec = {
  id: 'maintainer-noisy-duplicate-merge',
  suite: 'baseline',
  reflections: noisyDuplicateReflections,
  probe: {
    id: 'maintainer-noisy-duplicate-merge',
    question: 'In a noisy local cluster, merge only the semantic duplicate package-manager refs and leave overlapping validation/command refs alone.',
    rubric: {
      pass_if: ['Retires only the two pnpm-over-npm package-manager refs.', 'Does not retire the validation-command ref even though it also mentions pnpm.', 'Replacement is a specific package-manager policy with direct ref_* sources.'],
      fail_if: ['Merges the validation command into the package-manager policy.', 'Retires unrelated compaction/recall/status/provider refs.', 'Emits a vague project-command summary.'],
    },
  },
  graders: [
    ...localReplacementGuards(noisyDuplicateReflections),
    maintenanceRequiresRetireIds('ref_700000000001', 'ref_700000000006'),
    maintenanceForbidsRetireIds('ref_700000000002', 'ref_700000000003', 'ref_700000000004', 'ref_700000000005', 'ref_700000000007', 'ref_700000000008', 'ref_700000000009', 'ref_700000000010'),
    maintenanceRetireCountBetween(2, 2),
    maintenanceRequiresAll('pnpm'),
    maintenanceForbidsAny('typecheck && pnpm test'),
  ],
};

export const maintainerPartialOverlapNoop: MaintainerEvalSpec = {
  id: 'maintainer-partial-overlap-noop',
  suite: 'baseline',
  reflections: [
    ref('800000000001', 'Use pnpm rather than npm for package-manager commands.', ['obs_aaaaaaaaaaaa']),
    ref('800000000002', 'The required validation contract is `pnpm run typecheck && pnpm test` before claiming risky OM changes are green.', ['obs_bbbbbbbbbbbb']),
    ref('800000000003', 'Validation receipts are not durable memory unless they mark a blocker, contract, or final risky-change state.', ['obs_cccccccccccc']),
    ref('800000000004', 'Recall exact ids before relying on memory for exact commands or errors.', ['obs_dddddddddddd']),
  ],
  probe: {
    id: 'maintainer-partial-overlap-noop',
    question: 'Do not merge refs merely because they share pnpm/validation vocabulary when they have different future-use roles.',
    rubric: {
      pass_if: ['Returns no-op because the refs are related but not duplicate or safely replaceable as one claim.'],
      fail_if: ['Merges package-manager policy, validation command, and validation-memory policy into one broad reflection.', 'Retires any active ref.'],
    },
  },
  graders: [maintenanceNoop()],
};

const unlabeledStaleReflections = [
  ref('900000000001', 'Generated API clients should use transportMode=`xhr`.', ['obs_aaaaaaaaaaaa']),
  ref('900000000002', 'User corrected generated API clients to use transportMode=`fetch`; do not use xhr for new generated clients.', ['obs_bbbbbbbbbbbb']),
  ref('900000000003', 'Generated client output should stay checked into `src/generated/`.', ['obs_cccccccccccc']),
  ref('900000000004', 'Use short direct answers unless the user asks for more detail.', ['obs_dddddddddddd']),
];

export const maintainerUnlabeledStaleCurrent: MaintainerEvalSpec = {
  id: 'maintainer-unlabeled-stale-current',
  suite: 'baseline',
  forceJudge: true,
  reflections: unlabeledStaleReflections,
  probe: {
    id: 'maintainer-unlabeled-stale-current',
    question: 'Detect a stale/current correction without explicit Old/Current labels and preserve the relationship locally.',
    rubric: {
      pass_if: ['Retires only the xhr/fetch correction pair.', 'Replacement says fetch is current and xhr should not be used/new xhr guidance is stale or replaced.', 'Leaves unrelated generated-output and response-style refs active.'],
      fail_if: ['Keeps xhr as current.', 'Drops the correction relationship.', 'Retires unrelated generated-output or response-style refs.'],
    },
  },
  graders: [
    ...localReplacementGuards(unlabeledStaleReflections),
    maintenanceRequiresRetireIds('ref_900000000001', 'ref_900000000002'),
    maintenanceForbidsRetireIds('ref_900000000003', 'ref_900000000004'),
    maintenanceRetireCountBetween(2, 2),
    maintenanceRequiresAll('fetch'),
    maintenanceRequiresAny('xhr'),
    maintenanceRequiresAny('stale', 'replaced', 'replaces', 'replacing', 'superseded', 'supersedes', 'no longer', 'do not use'),
  ],
};

const completedWithBlockerReflections = [
  ref('910000000001', 'Auth refactor step: token cache was moved into `src/auth/cache.ts`.', ['obs_aaaaaaaaaaaa']),
  ref('910000000002', 'Auth refactor step: refresh handling moved into `src/auth/refresh.ts`.', ['obs_bbbbbbbbbbbb']),
  ref('910000000003', 'Auth refactor validation passed with the required package commands.', ['obs_cccccccccccc']),
  ref('910000000004', 'Auth refactor still has unresolved blocker: refresh-token rotation tests are missing.', ['obs_dddddddddddd']),
  ref('910000000005', 'User prefers concise final summaries with exact file paths when relevant.', ['obs_eeeeeeeeeeee']),
];

export const maintainerCompletedTrailWithUnresolvedSibling: MaintainerEvalSpec = {
  id: 'maintainer-completed-trail-with-unresolved-sibling',
  suite: 'baseline',
  skipJudge: true,
  reflections: completedWithBlockerReflections,
  probe: {
    id: 'maintainer-completed-trail-with-unresolved-sibling',
    question: 'Compress completed implementation trail without losing a same-topic unresolved blocker.',
    rubric: {
      pass_if: ['Retires the completed auth refactor step/validation refs.', 'Replacement preserves the completed/validated auth refactor outcome.', 'If it retires the unresolved refresh-token blocker, the replacement explicitly preserves that it is still missing/unresolved.', 'Does not retire the unrelated response preference.'],
      fail_if: ['Marks the blocker resolved.', 'Drops the unresolved blocker while retiring it.', 'Drops validation/current outcome.'],
    },
  },
  graders: [
    ...localReplacementGuards(completedWithBlockerReflections),
    maintenanceRequiresRetireIds('ref_910000000001', 'ref_910000000002'),
    maintenanceForbidsRetireIds('ref_910000000005'),
    maintenanceRetireCountBetween(2, 4),
    maintenanceRequiresAny('complete', 'completed', 'current', 'progress', 'status', 'in place', 'implementation'),
    {
      label: 'preserves validation if retiring it',
      pass: (output) => {
        const retired = new Set(output?.retireReflectionIds ?? []);
        if (!retired.has('ref_910000000003')) return true;
        const text = (output?.reflections ?? []).map((reflection) => reflection.content).join('\n').toLowerCase();
        return ['validation', 'passed'].some((needle) => text.includes(needle));
      },
      detail: (output) => ({ retireReflectionIds: output?.retireReflectionIds ?? [], content: (output?.reflections ?? []).map((reflection) => reflection.content).join('\n') }),
    },
    {
      label: 'preserves unresolved blocker if retiring it',
      pass: (output) => {
        const retired = new Set(output?.retireReflectionIds ?? []);
        if (!retired.has('ref_910000000004')) return true;
        const text = (output?.reflections ?? []).map((reflection) => reflection.content).join('\n').toLowerCase();
        const hasTopic = ['refresh-token', 'rotation tests'].some((needle) => text.includes(needle));
        const hasUnresolved = ['still missing', 'unresolved', 'blocker', 'missing', 'not yet'].some((needle) => text.includes(needle));
        return hasTopic && hasUnresolved;
      },
      detail: (output) => ({ retireReflectionIds: output?.retireReflectionIds ?? [], content: (output?.reflections ?? []).map((reflection) => reflection.content).join('\n') }),
    },
  ],
};

export async function runMaintainerSpec(spec: MaintainerEvalSpec, model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const started = Date.now();
  const { output, usage, agentDurationMs, providerError } = await runMaintainerEval(model, thinkingLevel, spec.reflections);
  return gradeAgentOutput({
    id: spec.id,
    agent: 'maintainer',
    output,
    probe: spec.probe,
    judgeModel,
    started,
    graders: spec.graders,
    usage: usage.total,
    agentDurationMs,
    diagnostics: { reflections: spec.reflections, providerError, forceJudge: spec.forceJudge, skipJudge: spec.skipJudge },
    noToolCallLabel: 'No record_maintenance tool call',
    providerError,
  });
}

export const maintainerEvalSpecs: MaintainerEvalSpec[] = [
  maintainerDuplicateMerge,
  maintainerStaleCurrentPair,
  maintainerCompletedTrailCompression,
  maintainerUnrelatedNoop,
  maintainerDirectParentProvenance,
  maintainerBlastRadiusGuard,
  maintainerNoisyDuplicateMerge,
  maintainerPartialOverlapNoop,
  maintainerUnlabeledStaleCurrent,
  maintainerCompletedTrailWithUnresolvedSibling,
];

export const maintainerDuplicateMergeCase = (model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel) => runMaintainerSpec(maintainerDuplicateMerge, model, judgeModel, thinkingLevel);
export const maintainerStaleCurrentPairCase = (model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel) => runMaintainerSpec(maintainerStaleCurrentPair, model, judgeModel, thinkingLevel);
export const maintainerCompletedTrailCompressionCase = (model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel) => runMaintainerSpec(maintainerCompletedTrailCompression, model, judgeModel, thinkingLevel);
export const maintainerUnrelatedNoopCase = (model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel) => runMaintainerSpec(maintainerUnrelatedNoop, model, judgeModel, thinkingLevel);
export const maintainerDirectParentProvenanceCase = (model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel) => runMaintainerSpec(maintainerDirectParentProvenance, model, judgeModel, thinkingLevel);
export const maintainerBlastRadiusGuardCase = (model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel) => runMaintainerSpec(maintainerBlastRadiusGuard, model, judgeModel, thinkingLevel);
export const maintainerNoisyDuplicateMergeCase = (model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel) => runMaintainerSpec(maintainerNoisyDuplicateMerge, model, judgeModel, thinkingLevel);
export const maintainerPartialOverlapNoopCase = (model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel) => runMaintainerSpec(maintainerPartialOverlapNoop, model, judgeModel, thinkingLevel);
export const maintainerUnlabeledStaleCurrentCase = (model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel) => runMaintainerSpec(maintainerUnlabeledStaleCurrent, model, judgeModel, thinkingLevel);
export const maintainerCompletedTrailWithUnresolvedSiblingCase = (model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel) => runMaintainerSpec(maintainerCompletedTrailWithUnresolvedSibling, model, judgeModel, thinkingLevel);
