import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { AgentEvalRecord, Observation, Reflection } from '../types.js';
import { runReflectorEval } from '../agent-runner.js';
import { obs, ref } from '../runner.js';
import { gradeAgentOutput, optional, reflectorForbidsAny, reflectorForbidsSourceIds, reflectorMaxCount, reflectorRequiresAll, reflectorRequiresAny, reflectorSourceIdsAllowed } from '../diagnostics.js';
import { realReflector16 as realReflector16v2 } from './real-session-fixtures-v2.js';

async function gradeReflector(args: {
  id: string;
  model: string;
  judgeModel: string;
  thinkingLevel: ModelThinkingLevel;
  observations: Observation[];
  reflections?: Reflection[];
  touchedFiles?: string[];
  probe: Parameters<typeof gradeAgentOutput<Reflection[]>>[0]['probe'];
  graders: Parameters<typeof gradeAgentOutput<Reflection[]>>[0]['graders'];
  forceJudge?: boolean;
}): Promise<AgentEvalRecord> {
  const started = Date.now();
  const reflections = args.reflections ?? [];
  const touchedFiles = args.touchedFiles ?? [];
  const { output, usage, agentDurationMs, providerError } = await runReflectorEval(args.model, args.thinkingLevel, { reflections, observations: args.observations, touchedFiles });
  return gradeAgentOutput({ id: args.id, agent: 'reflector', output, probe: args.probe, judgeModel: args.judgeModel, started, graders: args.graders, usage: usage.total, agentDurationMs, diagnostics: { observations: args.observations, reflections, touchedFiles, forceJudge: args.forceJudge, providerError }, noToolCallLabel: 'No record_reflections tool call', providerError });
}

function normalizeFixtureObservation(observation: any): Observation {
  return { id: observation.id, content: observation.content, timestamp: observation.timestamp ?? observation.createdAt ?? '', sourceEntryIds: observation.sourceEntryIds ?? [], tokenCount: observation.tokenCount ?? Math.ceil(observation.content.length / 4) };
}

function normalizeFixtureReflection(reflection: any): Reflection {
  return { id: reflection.id, content: reflection.content, sources: reflection.sources ?? [], tokenCount: reflection.tokenCount ?? Math.ceil(reflection.content.length / 4) };
}

function realGigaReflections(): Reflection[] {
  return (realReflector16v2.reflections ?? []).map(normalizeFixtureReflection);
}

function cleanGigaCurrentReflections(): Reflection[] {
  return [
    ref('100000000001', 'OM active memory is current reflections only; observations are durable evidence used by reflector and recall, not normal assistant-visible active context.', ['obs_100000000001']),
    ref('100000000002', 'Observation ids use `obs_*`, reflection ids use `ref_*`, and reflection provenance is stored in a single typed `sources` array.', ['obs_100000000002']),
    ref('100000000003', 'Compaction stays near-instant: flush any unobserved tail through observer, then render deterministic active reflection projection without synchronous reflector/rewrite work.', ['obs_100000000003']),
    ref('100000000004', 'Recall is the evidence path for exact source context behind compacted memory ids before acting on exact paths, commands, errors, APIs, or pass/fail claims.', ['obs_100000000004']),
  ];
}

export async function reflectorTouchedFilesWeakContext(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const observations = [
    obs('aaaaaaaaaaaa', 'User asked to update the retry default, but no source output, assistant summary, read result, or validation stated the resulting value.', '2026-06-12T09:00:00.000Z'),
  ];
  return gradeReflector({
    id: 'reflector-touched-files-weak-context', model, judgeModel, thinkingLevel, observations, touchedFiles: ['src/config.ts'],
    probe: { id: 'reflector-touched-files-weak-context', question: 'Treat touched files as weak operational context, not semantic evidence for project state.', rubric: { pass_if: ['Does not infer a concrete retry default value or completed config state from touchedFiles alone.', 'Does not cite touchedFiles as reflection sources.'], fail_if: ['Claims src/config.ts now has a retry default/value from touchedFiles alone.', 'Uses touched file paths as source ids.'] } },
    graders: [reflectorSourceIdsAllowed(observations.map((o) => o.id)), reflectorForbidsAny('src/config.ts now', 'retry default is', 'retry default now', 'changed to', 'value is'), optional(reflectorMaxCount(1))],
  });
}

export async function reflectorStaleCurrentReconciliation(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const observations = [
    obs('aaaaaaaaaaaa', 'Previous decision `apiMode=legacy` is no longer true; current decision is `apiMode=streaming`.', '2026-06-12T10:00:00.000Z'),
    obs('bbbbbbbbbbbb', 'Do not use the legacy API mode in new code; it was rejected after the streaming rollout passed validation.', '2026-06-12T10:01:00.000Z'),
  ];
  const reflections = [ref('eeeeeeeeeeee', 'apiMode=legacy is the current API mode.', ['aaaaaaaaaaaa'])];
  return gradeReflector({
    id: 'reflector-stale-current-reconciliation', model, judgeModel, thinkingLevel, observations, reflections,
    probe: { id: 'reflector-stale-current-reconciliation', question: 'Avoid reinforcing stale active memory and record the current replacement when new evidence says an old reflection is no longer true.', rubric: { pass_if: ['No reflection claims apiMode=legacy is current.', 'A corrective reflection says apiMode=streaming is current and legacy is rejected/stale.'], fail_if: ['Repeats/reinforces apiMode=legacy as current.', 'Ignores replacement relationship.'] } },
    graders: [reflectorForbidsAny('apiMode=legacy is the current'), reflectorSourceIdsAllowed(observations.map((o) => o.id)), optional(reflectorRequiresAll('apiMode=streaming')), optional(reflectorRequiresAll('legacy')), optional(reflectorMaxCount(2))],
  });
}

export async function reflectorDuplicateObservationNoop(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const observations = [
    obs('111111111111', 'User reiterated that compaction should only flush any unobserved tail and render the deterministic projection; no reflector, curator, rewrite, or maintenance work should run inline at the compaction boundary.', '2026-06-13T09:00:00.000Z'),
  ];
  const reflections = [ref('aaaaaaaaaaaa', 'OM compaction is near-instant and non-rewriting: it only flushes any unobserved tail through observer and renders deterministic projection; reflector/rewrite work must not run synchronously during compaction.', ['999999999999'])];
  return gradeReflector({
    id: 'reflector-duplicate-observation-noop', model, judgeModel, thinkingLevel, observations, reflections,
    probe: { id: 'reflector-duplicate-observation-noop', question: 'When pending observations restate existing active memory in different words, do not append a duplicate reflection.', rubric: { pass_if: ['Returns an empty reflections array because the current reflection already covers the semantic claim.'], fail_if: ['Adds a duplicate compaction reflection that only restates the current active reflection.'] } },
    graders: [reflectorSourceIdsAllowed(observations.map((o) => o.id)), reflectorMaxCount(0)],
  });
}

export async function reflectorAppendNewCompatibleFact(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const observations = [
    obs('222222222222', 'Production observer serialization now drops assistant `toolCall` blocks entirely from observer input; hidden edit/write payloads remain non-semantic observer evidence.', '2026-06-16T12:00:00.000Z'),
  ];
  const reflections = [ref('bbbbbbbbbbbb', 'Successful metadata-only tool results are skipped by observer serialization and are not source evidence.', ['888888888888'])];
  return gradeReflector({
    id: 'reflector-append-new-compatible-fact', model, judgeModel, thinkingLevel, observations, reflections,
    probe: { id: 'reflector-append-new-compatible-fact', question: 'Append genuinely new compatible memory from pending observations without restating unrelated current reflections.', rubric: { pass_if: ['Adds a reflection that assistant toolCall blocks are dropped from observer input.', 'Does not restate the existing metadata-only tool-result policy as if it were new.'], fail_if: ['Emits no reflection for the new toolCall policy.', 'Duplicates the existing metadata-only tool-result reflection.'] } },
    graders: [reflectorSourceIdsAllowed(observations.map((o) => o.id)), reflectorRequiresAll('toolCall', 'drop'), reflectorForbidsAny('metadata-only'), reflectorMaxCount(1)],
  });
}

export async function reflectorSubtleStaleCorrection(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const observations = [
    obs('333333333333', 'User approved changing rewrite so `runRewrite()` receives reflection records only; direct observation pools are gone, and source evidence is reached later through typed provenance/recall traversal.', '2026-06-15T13:00:00.000Z'),
    obs('444444444444', 'Older notes about feeding observations directly to rewrite should no longer guide implementation after the reflections-only rewrite input decision.', '2026-06-15T13:02:00.000Z'),
  ];
  const reflections = [ref('cccccccccccc', 'Rewrite input includes both observations and current reflections.', ['777777777777'])];
  return gradeReflector({
    id: 'reflector-subtle-stale-correction', model, judgeModel, thinkingLevel, observations, reflections,
    probe: { id: 'reflector-subtle-stale-correction', question: 'Use pending observations to append a corrective reflection when a current reflection has become stale.', rubric: { pass_if: ['Records that rewrite input is now reflections-only.', 'Preserves that direct observation pools are no longer current and evidence is reached through provenance/recall.'], fail_if: ['Leaves observations+reflections as the current rewrite input.', 'Drops the replacement relationship.'] } },
    graders: [reflectorForbidsAny('Rewrite input includes both observations and current reflections'), reflectorSourceIdsAllowed(observations.map((o) => o.id)), reflectorRequiresAll('reflection', 'only'), reflectorRequiresAny('stale', 'supersedes', 'no longer', 'replaces'), optional(reflectorRequiresAll('recall')), optional(reflectorMaxCount(2))],
  });
}

export async function reflectorFalseStalePrevention(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const observations = [
    obs('555555555555', 'User is uneasy about edit/write payloads in observer input; current direction is to hide mutation payloads from observer and provide touched-files as weak reflector-only operational context.', '2026-06-16T13:00:00.000Z'),
  ];
  const reflections = [ref('dddddddddddd', 'Observer should capture objective event/evidence atoms only, while reflector assigns durable meaning later.', ['666666666666'])];
  return gradeReflector({
    id: 'reflector-false-stale-prevention', model, judgeModel, thinkingLevel, observations, reflections,
    probe: { id: 'reflector-false-stale-prevention', question: 'Append compatible new policy without falsely treating compatible current reflections as stale.', rubric: { pass_if: ['May record the hidden mutation-payload/touched-files policy as compatible with objective-evidence observer design.', 'Does not say objective evidence atom capture was rejected or replaced.'], fail_if: ['Marks the objective-evidence observer policy stale.', 'Claims touched-files replaces objective evidence capture rather than supplementing it.'] } },
    graders: [reflectorSourceIdsAllowed(observations.map((o) => o.id)), reflectorRequiresAll('touched'), reflectorForbidsAny('objective event/evidence atoms is stale', 'objective evidence is stale', 'no longer capture objective', 'replaces objective evidence'), optional(reflectorRequiresAll('weak')), optional(reflectorMaxCount(2))],
  });
}

export async function reflectorChurnFilter(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const durable = obs('999999999991', 'User requires OM eval result summaries comparing reflector architectures to include pass rate, score, token usage, cost, and agent runtime.', '2026-06-16T15:00:00.000Z');
  const churn = obs('999999999992', 'Validation receipt only: cd extensions/pi-observational-memory && pnpm run typecheck && pnpm test passed with all tests green.', '2026-06-16T15:01:00.000Z');
  const observations = [durable, churn];
  return gradeReflector({
    id: 'reflector-churn-filter', model, judgeModel, thinkingLevel, observations,
    probe: { id: 'reflector-churn-filter', question: 'Record the durable eval-reporting requirement but do not promote validation-only churn.', rubric: { pass_if: ['Records that OM eval architecture comparisons should include pass rate, score, token usage, cost, and agent runtime.', 'Does not record validation/test-pass receipt as active memory.'], fail_if: ['Uses the validation-only observation as a reflection source.', 'Records typecheck/test pass as durable memory.'] } },
    graders: [reflectorSourceIdsAllowed([durable.id]), reflectorForbidsSourceIds(churn.id), reflectorRequiresAll('pass rate', 'score', 'token', 'cost'), reflectorForbidsAny('pnpm test', 'typecheck', 'tests green', 'Validation receipt'), optional(reflectorMaxCount(1))],
  });
}

export async function reflectorImplementationChurnNoop(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const observations = [
    obs('999999999981', '`src/session-ledger/index.ts` was added as a barrel re-export for ledger helper modules.', '2026-06-16T16:47:00.000Z'),
    obs('999999999982', '`src/memory-update/scheduler.ts` was edited to import a renamed helper and update internal work gate checks.', '2026-06-16T16:48:00.000Z'),
    obs('999999999983', 'Test fixtures were updated after observation record shape cleanup, and old expectations were removed from session-ledger tests.', '2026-06-16T16:49:00.000Z'),
    obs('999999999984', '`pnpm run typecheck` and `pnpm test` passed after the local implementation cleanup.', '2026-06-16T16:50:00.000Z'),
  ];
  const reflections = cleanGigaCurrentReflections();
  return gradeReflector({
    id: 'reflector-implementation-churn-noop', model, judgeModel, thinkingLevel, observations, reflections,
    probe: { id: 'reflector-implementation-churn-noop', question: 'With clean current reflections, skip local implementation mechanics that do not establish new durable handoff memory.', rubric: { pass_if: ['Returns an empty reflections array.', 'Does not turn file motion, helper renames, fixture updates, or validation receipts into active memory.'], fail_if: ['Adds changelog-style reflections.', 'Records routine validation or local code-motion as active handoff memory.'] } },
    graders: [
      reflectorSourceIdsAllowed(observations.map((o) => o.id)),
      reflectorMaxCount(0),
    ],
  });
}

export async function reflectorRealGiga16v2(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const observations = realReflector16v2.observations.map(normalizeFixtureObservation);
  const reflections = cleanGigaCurrentReflections();
  const churnSourceIds = [
    'obs_1213ce82c8f1', // session-ledger re-export barrel
    'obs_bb279199ee00', // deleted stale files/tests
    'obs_0c9a79503679', // transient typecheck failure
    'obs_251eca683f2d', // scheduler import rewrite
    'obs_5eccd71ac347', // validation receipt only
    'obs_eee294053797', // transient test failures / expectation updates
    'obs_af38122c3f37', // search receipt
    'obs_b4fbecc4334d', // validation receipt only
  ];
  return gradeReflector({
    id: 'reflector-real-giga-16-v2', model, judgeModel, thinkingLevel, observations, reflections,
    probe: { id: 'reflector-real-giga-16-v2', question: `Run a stateful reflector append pass over ${observations.length} production-shaped pending observations and ${reflections.length} clean current reflections from the giga OM session. Evaluate only the newly emitted reflections.`, rubric: { pass_if: ['Emits only durable new or changed handoff memory from pending observations.', 'Uses current reflections to avoid duplicate/churn output.', 'Skips searches, fixture/test churn, local code-motion, transient validation/process receipts, and usage/progress plumbing.', 'May no-op if non-churn observations are not durable or are already covered.'], fail_if: ['Restates existing active memory.', 'Records search/log output as semantic source evidence.', 'Turns local code-motion or transient validation churn into broad active memory.'] } },
    graders: [
      reflectorSourceIdsAllowed(observations.map((o) => o.id)),
      reflectorForbidsSourceIds(...churnSourceIds),
      reflectorForbidsAny('search was run', 'usage/progress-related symbols', 're-export barrel', 'logging plumbing'),
      optional(reflectorMaxCount(6)),
    ],
    forceJudge: true,
  });
}

export async function reflectorGigaDuplicateNoop(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const observations = [
    obs('666666666661', 'User reiterated that compaction should only flush the unobserved tail and render the projection; no reflector, rewrite, curator, or maintenance pass should run inline when compacting.', '2026-06-16T14:00:00.000Z'),
    obs('666666666662', 'The active-memory view should still be current reflections only; raw observations are durable evidence, not assistant-visible active context.', '2026-06-16T14:01:00.000Z'),
  ];
  return gradeReflector({
    id: 'reflector-giga-duplicate-noop', model, judgeModel, thinkingLevel, observations, reflections: realGigaReflections(),
    probe: { id: 'reflector-giga-duplicate-noop', question: 'With a large active-reflection pool, return no new reflections when pending observations only restate existing memory in different words.', rubric: { pass_if: ['Returns an empty reflections array.', 'Does not duplicate compaction or active-projection reflections.'], fail_if: ['Adds near-duplicate reflections for already-covered compaction/projection facts.'] } },
    graders: [reflectorSourceIdsAllowed(observations.map((o) => o.id)), reflectorMaxCount(0)],
  });
}

export async function reflectorGigaAppendNewFact(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const observations = [
    obs('777777777771', 'New accepted OM policy: reflector eval reports must separate active-memory fixture coverage from emitted-output quality, and model pass/fail should not score old anchors already present in current reflections.', '2026-06-16T14:10:00.000Z'),
  ];
  return gradeReflector({
    id: 'reflector-giga-append-new-fact', model, judgeModel, thinkingLevel, observations, reflections: realGigaReflections(),
    probe: { id: 'reflector-giga-append-new-fact', question: 'With a large active-reflection pool, append only the genuinely new durable eval policy from pending observations.', rubric: { pass_if: ['Records that reflector evals must separate fixture coverage from emitted-output quality.', 'Does not restate unrelated current OM design reflections.'], fail_if: ['Returns empty output despite a new durable eval policy.', 'Restates old compaction/provenance/pinning facts.'] } },
    graders: [reflectorSourceIdsAllowed(observations.map((o) => o.id)), reflectorRequiresAll('fixture coverage', 'emitted-output quality'), reflectorForbidsAny('near-instant', 'pinning', 'reflectionsPoolMaxTokens'), reflectorMaxCount(1)],
  });
}

export async function reflectorGigaStaleCorrection(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const observations = [
    obs('888888888881', 'User decided the old statement "reflector eval score can be based on active-memory anchors" is stale; current policy is that reflector scoring must grade emitted output behavior separately from fixture coverage.', '2026-06-16T14:20:00.000Z'),
  ];
  const reflections = [
    ...realGigaReflections(),
    ref('888888888880', 'Reflector eval score can be based on active-memory anchors already present in current reflections.', ['777777777770']),
  ];
  return gradeReflector({
    id: 'reflector-giga-stale-correction', model, judgeModel, thinkingLevel, observations, reflections,
    probe: { id: 'reflector-giga-stale-correction', question: 'With a large active-reflection pool, append a corrective current/stale relationship when pending observations invalidate an eval policy reflection.', rubric: { pass_if: ['Records that active-memory-anchor scoring is stale.', 'Records that emitted output behavior must be graded separately from fixture coverage.'], fail_if: ['Keeps active-memory-anchor scoring as current.', 'Fails to preserve the current/stale relationship.'] } },
    graders: [reflectorSourceIdsAllowed(observations.map((o) => o.id)), reflectorRequiresAny('stale', 'supersedes', 'no longer', 'replaces'), reflectorRequiresAll('emitted output'), reflectorRequiresAll('fixture coverage'), reflectorForbidsAny('can be based on active-memory anchors already present'), optional(reflectorMaxCount(2))],
  });
}

export async function reflectorRealSessionConstraintsAndState(model: string, judgeModel: string, thinkingLevel: ModelThinkingLevel): Promise<AgentEvalRecord> {
  const observations = [
    obs('aaaaaaaaaaaa', 'User wants the typed-id migration to fully refactor to Observation.id="obs_*", Reflection.id="ref_*", and Reflection.sources=["obs_*","ref_*"] with no long-lived shims; legacy entries normalize only at boundaries.', '2026-06-14T22:00:00.000Z'),
    obs('bbbbbbbbbbbb', 'User wants tests cleaned up for value, not mechanically renamed: delete curator.test.ts and curator-stage.test.ts because they preserve obsolete pin/curator behavior.', '2026-06-14T22:05:00.000Z'),
    obs('cccccccccccc', 'After cleanup, pin/unpin and curator support are gone from core OM code; MemoryUpdatePhase/MemoryStageName/ResolveMemoryModel/MemoryAgentName omit curator.', '2026-06-14T23:00:00.000Z'),
    obs('dddddddddddd', 'Validation passed: cd extensions/pi-observational-memory && pnpm run typecheck && pnpm test with 19 test files / 149 tests.', '2026-06-14T23:20:00.000Z'),
    obs('eeeeeeeeeeee', 'User decided rewrite input should stay reflections-only for now; runRewrite() takes only reflections and transitive ref -> ref -> obs recall traversal is preserved.', '2026-06-15T01:00:00.000Z'),
    obs('ffffffffffff', 'Deferred task: later investigate OM + fork interaction using instant compaction and always-on memory to send compacted context to forked agents instead of full context; do not investigate it deeply now.', '2026-06-15T01:10:00.000Z'),
  ];
  const reflections = [ref('999999999999', 'OM still has curator pinning and supportingObservationIds as active memory core.', ['aaaaaaaaaaaa'])];
  return gradeReflector({
    id: 'reflector-real-session-constraints-and-state', model, judgeModel, thinkingLevel, observations, reflections,
    probe: { id: 'reflector-real-session-constraints-and-state', question: 'Synthesize real OM session constraints/state while correcting stale curator/pinning active memory.', rubric: { pass_if: ['Typed id/no-shim boundary compatibility retained.', 'Curator/pin removal current state retained.', 'Validation pass retained.', 'Rewrite input reflections-only retained.', 'Deferred OM+fork task retained as later/not now.'], fail_if: ['Resurrects curator/pinning as active.', 'Drops user constraints.', 'Treats deferred fork work as immediate.'] } },
    graders: [reflectorForbidsAny('curator pinning and supportingObservationIds remain active', 'curator pinning and supportingObservationIds are current'), reflectorSourceIdsAllowed([...observations.map((o) => o.id), ...reflections.map((r) => r.id)]), optional(reflectorRequiresAll('obs_*', 'ref_*')), optional(reflectorRequiresAll('no long-lived shims')), optional(reflectorRequiresAll('curator')), optional(reflectorRequiresAll('19 test files', '149 tests')), optional(reflectorRequiresAll('reflections-only')), optional(reflectorRequiresAll('OM', 'fork')), optional(reflectorMaxCount(6))],
  });
}
