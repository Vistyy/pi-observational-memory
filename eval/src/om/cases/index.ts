import type { OmEvalCase } from '../types.js';
import { maintainerBlastRadiusGuardCase, maintainerCompletedTrailCompressionCase, maintainerCompletedTrailWithUnresolvedSiblingCase, maintainerDirectParentProvenanceCase, maintainerDuplicateMergeCase, maintainerNoisyDuplicateMergeCase, maintainerPartialOverlapNoopCase, maintainerStaleCurrentPairCase, maintainerUnlabeledStaleCurrentCase, maintainerUnrelatedNoopCase } from './maintainer.js';
import { observerAssistantProseBoundary, observerHiddenMutationPayloadBoundary, observerHiddenMutationReplacementEvidence, observerRealGiga32, observerRealGiga64v2, observerToolEvidenceBoundary } from './observer.js';
import { reflectorAppendNewCompatibleFact, reflectorChurnFilter, reflectorDuplicateObservationNoop, reflectorFalseStalePrevention, reflectorGigaAppendNewFact, reflectorGigaDuplicateNoop, reflectorGigaStaleCorrection, reflectorImplementationChurnNoop, reflectorRealGiga16v2, reflectorRealSessionConstraintsAndState, reflectorStaleCurrentReconciliation, reflectorSubtleStaleCorrection, reflectorTouchedFilesWeakContext } from './reflector.js';
import { rewriteEmergencyFallbackCurrentReality, rewriteRemovedCuratorPinningCleanup, rewriteStaleRelationshipPreservation } from './rewrite.js';

const omCase = (id: string, agent: OmEvalCase['agent'], run: OmEvalCase['run'], suite: OmEvalCase['suite'] = 'baseline'): OmEvalCase => ({ id, agent, run, suite });

export const allCases: OmEvalCase[] = [
  omCase('observer-tool-evidence-boundary', 'observer', observerToolEvidenceBoundary),
  omCase('observer-hidden-mutation-payload-boundary', 'observer', observerHiddenMutationPayloadBoundary),
  omCase('observer-hidden-mutation-replacement-evidence', 'observer', observerHiddenMutationReplacementEvidence),
  omCase('observer-assistant-prose-boundary', 'observer', observerAssistantProseBoundary),
  omCase('observer-real-giga-32', 'observer', observerRealGiga32),
  omCase('observer-real-giga-64-v2', 'observer', observerRealGiga64v2),
  omCase('reflector-touched-files-weak-context', 'reflector', reflectorTouchedFilesWeakContext),
  omCase('reflector-duplicate-observation-noop', 'reflector', reflectorDuplicateObservationNoop),
  omCase('reflector-append-new-compatible-fact', 'reflector', reflectorAppendNewCompatibleFact),
  omCase('reflector-stale-current-reconciliation', 'reflector', reflectorStaleCurrentReconciliation),
  omCase('reflector-subtle-stale-correction', 'reflector', reflectorSubtleStaleCorrection),
  omCase('reflector-false-stale-prevention', 'reflector', reflectorFalseStalePrevention),
  omCase('reflector-churn-filter', 'reflector', reflectorChurnFilter),
  omCase('reflector-implementation-churn-noop', 'reflector', reflectorImplementationChurnNoop),
  omCase('reflector-real-giga-16-v2', 'reflector', reflectorRealGiga16v2),
  omCase('reflector-giga-duplicate-noop', 'reflector', reflectorGigaDuplicateNoop),
  omCase('reflector-giga-append-new-fact', 'reflector', reflectorGigaAppendNewFact),
  omCase('reflector-giga-stale-correction', 'reflector', reflectorGigaStaleCorrection),
  omCase('reflector-real-session-constraints-and-state', 'reflector', reflectorRealSessionConstraintsAndState),
  omCase('maintainer-duplicate-merge', 'maintainer', maintainerDuplicateMergeCase),
  omCase('maintainer-stale-current-pair', 'maintainer', maintainerStaleCurrentPairCase),
  omCase('maintainer-completed-trail-compression', 'maintainer', maintainerCompletedTrailCompressionCase),
  omCase('maintainer-unrelated-noop', 'maintainer', maintainerUnrelatedNoopCase),
  omCase('maintainer-direct-parent-provenance', 'maintainer', maintainerDirectParentProvenanceCase),
  omCase('maintainer-blast-radius-guard', 'maintainer', maintainerBlastRadiusGuardCase),
  omCase('maintainer-noisy-duplicate-merge', 'maintainer', maintainerNoisyDuplicateMergeCase),
  omCase('maintainer-partial-overlap-noop', 'maintainer', maintainerPartialOverlapNoopCase),
  omCase('maintainer-unlabeled-stale-current', 'maintainer', maintainerUnlabeledStaleCurrentCase),
  omCase('maintainer-completed-trail-with-unresolved-sibling', 'maintainer', maintainerCompletedTrailWithUnresolvedSiblingCase),
  omCase('rewrite-stale-relationship-preservation', 'rewrite', rewriteStaleRelationshipPreservation),
  omCase('rewrite-emergency-fallback-current-reality', 'rewrite', rewriteEmergencyFallbackCurrentReality),
  omCase('rewrite-removed-curator-pinning-cleanup', 'rewrite', rewriteRemovedCuratorPinningCleanup),
];
