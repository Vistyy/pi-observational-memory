import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { AgentEvalRecord, Reflection } from '../types.js';
import { runRewriteEval } from '../agent-runner.js';
import { ref } from '../runner.js';
import { gradeAgentOutput, optional, reflectorForbidsAny, reflectorMaxCount, reflectorRequiresAll, reflectorRequiresAny, reflectorSourceIdsAllowed } from '../diagnostics.js';

const directRefSources = (reflections: Reflection[]) => reflections.map((reflection) => reflection.id);

const nonEmptyRewrite = {
  label: 'produces rewritten reflections',
  pass: (output: Reflection[] | undefined) => (output ?? []).length > 0,
  detail: (output: Reflection[] | undefined) => ({ count: output?.length ?? 0 }),
};

async function gradeRewrite(args: {
  id: string;
  model: string;
  judgeModel: string;
  thinkingLevel: ModelThinkingLevel;
  reflections: Reflection[];
  probe: Parameters<typeof gradeAgentOutput<Reflection[]>>[0]['probe'];
  graders: Parameters<typeof gradeAgentOutput<Reflection[]>>[0]['graders'];
  forceJudge?: boolean;
}): Promise<AgentEvalRecord> {
  const started = Date.now();
  const { output, usage, agentDurationMs, providerError } = await runRewriteEval(args.model, args.thinkingLevel, args.reflections);
  return gradeAgentOutput({ id: args.id, agent: 'rewrite', output, probe: args.probe, judgeModel: args.judgeModel, started, graders: args.graders, usage: usage.total, agentDurationMs, diagnostics: { reflections: args.reflections, forceJudge: args.forceJudge, providerError }, providerError });
}

export async function rewriteStaleRelationshipPreservation(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const reflections = [
    ref('200000000001', 'Older plan preferred per-reflection deprecation/supersession lifecycle to retire stale memories individually.', ['obs_aaaaaaaaaaaa']),
    ref('200000000002', 'Current plan uses maintainer as the normal local cleanup path and keeps rewrite only as a rare emergency overflow fallback.', ['obs_bbbbbbbbbbbb']),
    ref('200000000003', 'Compaction is near-instant and non-rewriting: only observer tail flush plus deterministic projection, no synchronous reflector/maintainer/rewrite work.', ['obs_cccccccccccc']),
  ];
  return gradeRewrite({
    id: 'rewrite-stale-relationship-preservation', model, judgeModel, thinkingLevel, reflections,
    probe: { id: 'rewrite-stale-relationship-preservation', question: 'Emergency-rewrite contradictory memory lifecycle reflections into current operating state.', rubric: { pass_if: ['Maintainer is the normal cleanup path.', 'Rewrite is rare/emergency fallback, not normal lifecycle.', 'Near-instant compaction/no synchronous agents retained.', 'Older per-reflection lifecycle plan is stale or not current.'], fail_if: ['Makes rewrite the normal/default cleanup path.', 'Merges stale lifecycle and current maintainer plan as co-current.', 'Loses compaction boundary constraint.'] } },
    graders: [
      reflectorSourceIdsAllowed(directRefSources(reflections)),
      nonEmptyRewrite,
      optional(reflectorRequiresAny('maintainer')),
      optional(reflectorRequiresAny('emergency', 'overflow', 'fallback')),
      optional(reflectorRequiresAny('near-instant', 'non-rewriting')),
      optional(reflectorForbidsAny('curator')),
      optional(reflectorMaxCount(3)),
    ],
  });
}

export async function rewriteEmergencyFallbackCurrentReality(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const reflections = [
    ref('810000000001', 'Observational memory active context is reflection-only; observations are durable evidence and recall sources, not normal assistant active-memory projection.', ['obs_100000000001']),
    ref('810000000002', 'Observation ids use `obs_*`, reflection ids use `ref_*`, and reflection provenance is stored in a single `sources` array.', ['obs_100000000002']),
    ref('810000000003', 'Legacy ledger/session ids are normalized only at boundaries; do not keep parallel legacy core paths.', ['obs_100000000003']),
    ref('810000000004', 'Maintainer runs as the normal local cleanup path after every 10 new reflections using a capped newest-window input.', ['obs_100000000004']),
    ref('810000000005', 'Maintainer replacements must cite direct parent `ref_*` sources and must not copy transitive observation ancestry.', ['obs_100000000005']),
    ref('810000000006', 'Rewrite remains wired only as an emergency overflow fallback when reflection tokens exceed budget after normal maintenance.', ['obs_100000000006']),
    ref('810000000007', 'Rewrite is destructive: a successful rewrite records replacement reflections and retires the active reflection ids.', ['obs_100000000007']),
    ref('810000000008', 'Compaction must stay near-instant: flush observer tail if needed, then render deterministic active reflection projection.', ['obs_100000000008']),
    ref('810000000009', 'Recall is the required evidence path for exact source context behind compacted memory ids.', ['obs_100000000009']),
    ref('810000000010', 'Routine validation receipts should not become memory unless they mark a blocker or final risky-change state.', ['obs_100000000010']),
    ref('810000000011', 'The old pin/unpin curator active-memory surface was removed from the live OM path.', ['obs_100000000011']),
    ref('810000000012', 'Current validation commands for the OM extension are `pnpm run typecheck` and `pnpm test` from `extensions/pi-observational-memory`.', ['obs_100000000012']),
  ];
  return gradeRewrite({
    id: 'rewrite-emergency-fallback-current-reality', model, judgeModel, thinkingLevel, reflections,
    probe: { id: 'rewrite-emergency-fallback-current-reality', question: 'Emergency-rewrite the current OM operating state after maintainer is already the default path.', rubric: { pass_if: ['Preserves reflection-only active memory.', 'Preserves typed obs/ref ids and `sources` provenance.', 'Preserves maintainer as normal local cleanup and rewrite as emergency fallback.', 'Preserves instant compaction boundary and recall evidence path.', 'Drops removed curator/pin details as current surface.'], fail_if: ['Treats curator/pin as live current surface.', 'Makes rewrite the normal lifecycle instead of emergency fallback.', 'Drops typed-id/provenance or reflection-only decisions.', 'Fails to compress.'] } },
    graders: [
      reflectorSourceIdsAllowed(directRefSources(reflections)),
      nonEmptyRewrite,
      optional(reflectorRequiresAny('reflection-only')),
      optional(reflectorRequiresAll('obs_', 'ref_', 'sources')),
      optional(reflectorRequiresAny('maintainer')),
      optional(reflectorRequiresAny('emergency', 'overflow', 'fallback')),
      optional(reflectorRequiresAny('near-instant', 'deterministic')),
      optional(reflectorRequiresAny('recall')),
      optional(reflectorMaxCount(6)),
    ],
  });
}

export async function rewriteRemovedCuratorPinningCleanup(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const reflections = [
    ref('820000000001', 'Old OM plan used curator pin/unpin/drop decisions over active observations.', ['obs_200000000001']),
    ref('820000000002', 'Current OM code removed curator and pin/unpin from the live active-memory surface.', ['obs_200000000002']),
    ref('820000000003', 'Current active projection renders reflections only; `nextContextProjection()` returns `observations: []`.', ['obs_200000000003']),
    ref('820000000004', 'Maintainer is the current normal reflection cleanup path; rewrite is only an emergency overflow fallback.', ['obs_200000000004']),
    ref('820000000005', 'Old pinned stale failures are historical context only and should not be treated as current projection behavior.', ['obs_200000000005']),
  ];
  return gradeRewrite({
    id: 'rewrite-removed-curator-pinning-cleanup', model, judgeModel, thinkingLevel, reflections,
    probe: { id: 'rewrite-removed-curator-pinning-cleanup', question: 'Emergency-rewrite stale curator/pinning memories into the current removed-surface relationship.', rubric: { pass_if: ['Says curator/pin/unpin are removed or old/stale, not current.', 'Preserves reflection-only active projection.', 'Preserves maintainer normal path and rewrite emergency fallback.'], fail_if: ['Describes pin/unpin curator as live current behavior.', 'Drops the current removed/stale relationship.', 'Drops reflection-only active projection.'] } },
    graders: [
      reflectorSourceIdsAllowed(directRefSources(reflections)),
      nonEmptyRewrite,
      optional(reflectorRequiresAny('removed', 'stale', 'old', 'historical')),
      optional(reflectorRequiresAny('curator', 'pin', 'unpin')),
      optional(reflectorRequiresAny('reflection-only', 'observations: []')),
      optional(reflectorRequiresAny('maintainer')),
      optional(reflectorRequiresAny('emergency', 'fallback', 'overflow')),
      optional(reflectorMaxCount(3)),
    ],
  });
}
