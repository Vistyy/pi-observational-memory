import type { RecallUseCase } from '../types.js';

const VALIDATION_COMMAND = 'cd extensions/pi-observational-memory && pnpm run typecheck && pnpm test';

export const cases: RecallUseCase[] = [
  {
    id: 'recall-seeded-noisy-command-id',
    seedMessages: [{
      role: 'assistant',
      content: `Compacted OM memory excerpt:\n- ref_100000000001: User likes compact final answers.\n- ref_100000000002: A compacted OM memory contains the exact validation command for the recall refactor.\n- ref_100000000003: Stale note about an old typecheck failure; superseded later.\n- ref_100000000004: Follow-up idea about cost telemetry, not relevant now.`,
    }],
    prompt: 'What exact validation command should I run for the recall refactor?',
    expectedCalls: [{ id: 'ref_100000000002' }],
    mockResults: {
      ref_100000000002: `Reflections:\n[ref_100000000002] A compacted OM memory contains the exact validation command for the recall refactor.\n\nProvenance:\nref_100000000002 -> obs_100000000002\n\nObservations:\n[obs_100000000002] User confirmed the recall-refactor validation command is \`${VALIDATION_COMMAND}\`.`,
    },
    requiredAnswerText: [VALIDATION_COMMAND],
  },
  {
    id: 'recall-recent-context-no-call',
    seedMessages: [{
      role: 'user',
      content: `For this next recall refactor, the exact validation command is: ${VALIDATION_COMMAND}`,
    }],
    prompt: 'What command did I just tell you to run?',
    expectedCalls: [],
    requiredAnswerText: [VALIDATION_COMMAND],
  },
  {
    id: 'recall-noisy-stale-current-status',
    seedMessages: [{
      role: 'assistant',
      content: `Compacted OM memory excerpt:\nMaintainer status:\n- ref_200000000001: Maintainer eval was not green; unresolved failures around noisy duplicate merge.\n- ref_200000000003: Maintainer hardening supersedes earlier unresolved maintainer failures and records the latest validation result.\nOther active-memory entries:\n- ref_200000000002: Rewrite eval failed on rewrite-real-giga-40-v2.\n- ref_200000000004: User prefers principle-level reflector guidance.`,
    }],
    prompt: 'I need to report the exact current maintainer hardening validation result. The compacted memories include stale and current-looking maintainer facts plus unrelated noise. Answer with the exact current status and what is stale.',
    expectedCalls: [{ id: 'ref_200000000001' }, { id: 'ref_200000000003' }],
    mockResults: {
      ref_200000000001: 'Reflections:\n[ref_200000000001] Maintainer eval is still not green; noisy duplicate-merge had unresolved failures.\n\nObservations:\n[obs_200000000001] Earlier maintainer rerun failed because one trial retired only one duplicate and another returned no accepted output.',
      ref_200000000003: 'Reflections:\n[ref_200000000003] Maintainer hardening is committed as 93048e1 and validation reported typecheck/tests passed plus maintainer evals 30/30 passed, trials=3; this supersedes earlier unresolved maintainer failures.\n\nObservations:\n[obs_200000000003] Maintainer hardening path passed after stricter contract changes.',
    },
    requiredAnswerText: ['93048e1', '30/30', 'stale'],
    judge: {
      id: 'stale-current-answer-quality',
      question: 'Did the answer clearly identify the current maintainer status and distinguish it from the stale earlier failure without treating unrelated rewrite status as part of the maintainer answer?',
      rubric: {
        pass_if: [
          'States that current maintainer hardening is green or passed after commit 93048e1.',
          'Mentions maintainer evals passed 30/30 or equivalent validation success.',
          'Identifies the earlier unresolved/noisy duplicate-merge maintainer failure as stale or superseded.',
          'Does not present rewrite eval status as the maintainer status.',
        ],
        fail_if: [
          'Treats the old maintainer failure as current.',
          'Omits the stale/current distinction.',
          'Uses unrelated rewrite status as the main answer.',
        ],
      },
    },
  },
  {
    id: 'recall-broad-provenance-include-intermediate',
    seedMessages: [{
      role: 'assistant',
      content: `Compacted OM memory excerpt:\nCurrent rewrite policy:\n- ref_300000000001: Rewrite is emergency fallback only, supported by nested maintainer/rewrite rationale.\nOther active-memory entries:\n- ref_300000000002: A local docs cleanup note.\n- ref_300000000003: A stale rewrite-green assumption rejected by later eval results.`,
    }],
    prompt: 'Why do we believe the rewrite path should stay emergency-only rather than normal cleanup? I need the intermediate rationale behind the current policy.',
    expectedCalls: [{ id: 'ref_300000000001', mode: 'provenance' }],
    mockResults: {
      ref_300000000001: 'Reflections:\n[ref_300000000001] Rewrite remains an emergency fallback; maintainer is the default cleanup path before revisiting rewrite.\n\nProvenance:\nref_300000000001 -> ref_300000000004\nref_300000000004 -> obs_300000000004\n\nSupporting reflections:\n[ref_300000000004] Maintainer hardening is green, while rewrite eval still fails on rewrite-real-giga-40-v2, so production should prefer maintainer and keep rewrite non-normal.\n\nObservations:\n[obs_300000000004] Rewrite eval rerun still failed on rewrite-real-giga-40-v2 with score 6/20 after hardening, while maintainer evals passed 30/30.',
    },
    requiredAnswerText: ['emergency', 'maintainer', 'rewrite-real-giga-40-v2'],
    judge: {
      id: 'broad-provenance-answer-quality',
      question: 'Did the answer use the recalled intermediate rationale to explain why rewrite should stay emergency-only?',
      rubric: {
        pass_if: [
          'Explains that maintainer is the preferred/default cleanup path.',
          'Explains that rewrite remains emergency-only because rewrite eval evidence is still weak or failing.',
          'Uses the intermediate rationale rather than only restating terminal observations.',
          'Mentions rewrite-real-giga-40-v2 or an equivalent specific failing rewrite eval signal.',
        ],
        fail_if: [
          'Only says rewrite is emergency-only without explaining why.',
          'Ignores the maintainer-vs-rewrite comparison.',
          'Claims rewrite is green or suitable as normal cleanup.',
        ],
      },
    },
  },
  {
    id: 'recall-partial-missing-evidence-caveat',
    seedMessages: [{
      role: 'assistant',
      content: `Compacted OM memory excerpt:\n- ref_400000000001: A remembered user constraint has partial provenance.\n- ref_400000000002: Unrelated reminder about using pnpm.`,
    }],
    prompt: 'Before I enforce the remembered constraint in ref_400000000001, recover its evidence and tell me what is known versus unavailable.',
    expectedCalls: [{ id: 'ref_400000000001' }],
    mockResults: {
      ref_400000000001: 'Reflections:\n[ref_400000000001] A remembered constraint says never leave compatibility shims in core paths.\n\nProvenance:\nref_400000000001 -> obs_400000000001\nref_400000000001 -> ref_400000000003\n\nObservations:\n[obs_400000000001] User confirmed the typed-id migration should avoid long-lived shims and keep compatibility only at boundaries.\n\nUnavailable supporting reflections: ref_400000000003\nUnavailable source entries: missing: src-400000000001',
    },
    requiredAnswerText: ['shims', 'unavailable', 'ref_400000000003'],
    judge: {
      id: 'partial-evidence-caveat-quality',
      question: 'Did the answer preserve the known constraint while clearly caveating unavailable supporting evidence?',
      rubric: {
        pass_if: [
          'States the known constraint about avoiding long-lived compatibility shims or keeping compatibility at boundaries.',
          'Clearly says some evidence is unavailable or partial.',
          'Names the unavailable supporting reflection ref_400000000003 or equivalent missing support.',
          'Does not overstate the memory as fully verified.',
        ],
        fail_if: [
          'Treats the memory as fully verified with no caveat.',
          'Omits the unavailable evidence.',
          'Fails to recover the actual shim/boundary constraint.',
        ],
      },
    },
  },
  {
    id: 'recall-no-id-no-semantic-search',
    seedMessages: [{
      role: 'assistant',
      content: 'The active context mentions that some validation commands exist in compacted OM, but no memory ids are visible in this conversation.',
    }],
    prompt: 'Use recall to find whatever memory contains the validation command. I do not have an obs/ref id.',
    expectedCalls: [],
    forbiddenAnswerText: [VALIDATION_COMMAND],
  },
];
