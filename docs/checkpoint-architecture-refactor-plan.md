# Checkpoint architecture refactor plan

## Status

This plan covers six architecture candidates around checkpoint prompts, checkpoint lifecycle, session-ledger state, observer recording, and checkpoint evals.

Accepted decisions:

- Checkpoint prune triggers use token budgets only.
- Unchanged prune emits no ledger event.
- Compaction pressure tries normal checkpoint catch-up first.
- Compaction pressure runs prune only as recovery when catch-up fails or is blocked by an invalid or over-hard-max checkpoint.

Implementation status:

- Phase 1 is implemented in `src/memory/checkpoint-format.ts` and covered by `tests/checkpoint-editor-prompts.test.ts`.
- Phase 2 is implemented in `src/agents/checkpoint-editor/prompts.ts` and `src/agents/checkpoint-editor/agent.ts`.
- Phase 3 is implemented in `eval/src/checkpoint/scenarios.ts`, `eval/src/checkpoint/grading.ts`, and `eval/src/cli/checkpoint-evals.ts`.
- Phase 4 is implemented in `src/session-ledger/memory-state.ts` and covered by `tests/session-ledger-memory-state.test.ts`.
- Phase 5 is implemented in `src/memory-update/observer-recording.ts` and covered by `tests/observer-recording.test.ts`.
- Phase 6 is implemented in `src/memory-update/checkpoint-lifecycle.ts` and covered by `tests/checkpoint-lifecycle.test.ts`.
- Phase 7 is implemented with token-budget prune triggers, status output, lifecycle tests, and the `checkpoint-e2e-prunes-bloated-checkpoint` eval.
- The previous `src/memory-update/checkpoint-stage.ts` path has been removed.

## Goals

Make `CheckpointEditor` behavior easier to understand and verify.

Make prune a first-class path instead of a confusing `purpose` flag with observation-shaped input.

Concentrate checkpoint lifecycle behavior behind deeper modules.

Keep deterministic mechanics in tests and model behavior in evals.

## Phase 1: Checkpoint format module

Goal: one source of truth for required checkpoint headings and the empty checkpoint template.

Files:

- `src/memory/checkpoint-format.ts`
- `src/memory/checkpoint.ts`
- `src/session-ledger/types.ts`
- `src/agents/checkpoint-editor/prompts.ts`

Actions:

- Add a dependency-light `checkpoint-format.ts` module.
- Move the v1 heading list into that module.
- Generate heading instructions from that module.
- Keep `EMPTY_CHECKPOINT_MARKDOWN` aligned with validation.
- Keep existing public imports stable where practical.

Tests:

- `EMPTY_CHECKPOINT_MARKDOWN` is valid.
- Missing one required heading is invalid.
- Prompt heading instructions are generated from the shared format module.

## Phase 2: Split CheckpointEditor prompt branches

Goal: make update and prune separate prompt branches.

Files:

- `src/agents/checkpoint-editor/prompts.ts`
- `src/agents/checkpoint-editor/agent.ts`
- `tests/checkpoint-editor-prompts.test.ts`
- `eval/src/checkpoint/cases.ts`

Actions:

- Keep a shared core mission for draft editing and finishing.
- Move update-only pending-observation wording into the update branch.
- Create a prune branch with no observations section.
- Make prune criteria explicit: no new facts, preserve meaning, preserve active anchors, shrink or repair only.
- Do not snapshot whole prompts in tests.
- Test prompt invariants instead.

Prompt tests:

- Update prompt contains `Pending observations:`.
- Update prompt contains supplied observation text.
- Prune prompt does not contain `Pending observations:`.
- Prune prompt does not contain supplied observation text if a wrapper remains during migration.
- Prune prompt says no new facts.
- Prune prompt says preserve meaning.

## Phase 3: Deepen checkpoint eval scenarios

Goal: make eval cases describe scenarios rather than runner mechanics.

Files:

- `eval/src/checkpoint/scenarios.ts`
- `eval/src/checkpoint/cases.ts`
- `eval/src/checkpoint/grading.ts`
- `eval/src/checkpoint/types.ts`
- `eval/src/checkpoint/runner.ts`

Actions:

- Add scenario builders for editor update, editor prune, session replay update, and session replay prune.
- Add grading helpers for anchors, forbidden terms, no new facts, shortened output, unchanged output, and durable event shape.
- Add `--fail-fast` to the eval CLI.
- Keep `--repeat` as the stress path for now.
- Store enough input and replay summary detail in `results.json` to diagnose failures without rerunning.

New editor prune evals:

- `checkpoint-prune-preserves-active-decisions`
- `checkpoint-prune-does-not-add-new-facts`
- `checkpoint-prune-preserves-remaining-work`
- `checkpoint-prune-shrinks-bloated-checkpoint`

Validation:

```sh
pnpm checkpoint-evals -- --model openai-codex/gpt-5.4-mini --thinking low --case checkpoint-prune-does-not-add-new-facts --repeat 2 --out runs/checkpoint-evals/prune-prompt-split-smoke
pnpm checkpoint-evals -- --model openai-codex/gpt-5.4-mini --thinking low --out runs/checkpoint-evals/prompt-format-refactor-smoke
```

## Phase 4: Memory state module over ledger folding

Goal: stop callers from recomputing coverage and gap concepts from raw folded state.

Files:

- `src/session-ledger/memory-state.ts`
- `src/session-ledger/index.ts`
- `src/memory-update/due.ts`
- `src/memory-update/lifecycle.ts`
- `src/session-ledger/compaction-memory.ts`
- `src/commands/status.ts`

Actions:

- Keep `foldLedger` as a primitive.
- Add higher-level memory-state queries over folded ledger state.
- Replace repeated caller-side coverage and gap calculations.

Suggested queries:

- observer source entries after coverage
- checkpoint gap
- uncheckpointed observations before retained tail
- latest checkpoint memory details
- compaction readiness inputs

Tests:

- Add `tests/session-ledger-memory-state.test.ts`.
- Cover source entries after observation coverage.
- Cover source entries before compaction boundary.
- Cover uncheckpointed observations before retained tail.
- Cover unknown `firstKeptEntryId` behavior.
- Cover latest checkpoint details and coverage id.

## Phase 5: Observer recording module

Goal: one module owns observer serialization, model call, and observation coverage event commit.

Files:

- `src/memory-update/observer-recording.ts`
- `src/memory-update/observer-stage.ts`
- `src/memory-update/lifecycle.ts`
- `tests/observer-recording.test.ts`
- `tests/memory-lifecycle.test.ts`

Actions:

- Extract shared behavior from normal observer stage and compaction observer flush.
- Keep `observer-stage.ts` as the normal scheduling adapter.
- Route compaction observer flush through the same observer recording module.

Invariant to preserve:

- Coverage advances to rendered safe source entries.
- Empty observation output still records coverage.
- Unrenderable chunks still advance coverage with an empty observations event.
- `allowedSourceEntryIds` matches serialized source entries.

Tests:

- Normal observer records and appends `om.observations.recorded`.
- Compaction flush uses the same append path.
- Unrenderable chunk advances observation coverage with empty observations.
- Model resolve failure preserves stage failure boundaries.
- Compaction observer error records `lastObserverError`.

## Phase 6: Checkpoint lifecycle module

Goal: one deeper module owns checkpoint update and prune event semantics.

Files:

- `src/memory-update/checkpoint-lifecycle.ts`
- `src/memory-update/checkpoint-stage.ts`
- `src/memory-update/lifecycle.ts`
- `tests/checkpoint-lifecycle.test.ts`
- `tests/memory-lifecycle.test.ts`

Actions:

- Move update behavior from `checkpoint-stage.ts` into `checkpoint-lifecycle.ts`.
- Add a first-class prune request path.
- Remove or fully replace the old `checkpoint-stage.ts` path.
- Do not leave dual checkpoint execution paths.

Update semantics:

- Requires observations.
- Uses previous checkpoint or empty checkpoint as draft input.
- Changed result records `om.checkpoint.recorded` with `mode: "update"`.
- Unchanged result records `om.checkpoint.coverage_advanced`.
- Invalid or unfinished result records no checkpoint event.

Prune semantics:

- Requires an existing checkpoint.
- Uses current checkpoint as draft input.
- Uses no observations.
- Changed result records `om.checkpoint.recorded` with `mode: "prune"`.
- Prune event keeps the same `coversUpToObservationId`.
- Prune event has `observationIds: []`.
- Unchanged prune emits no ledger event.
- Invalid or unfinished prune emits no ledger event.

Tests:

- Update changed records `mode: "update"`.
- Update unchanged advances coverage.
- Update invalid content records nothing.
- Prune changed records `mode: "prune"`.
- Prune changed preserves checkpoint coverage.
- Prune changed records empty `observationIds`.
- Prune unchanged records no ledger event.
- Prune with no checkpoint does not call the editor.
- Prune invalid content preserves existing checkpoint state.

## Phase 7: Token-budget prune triggers

Goal: make prune lifecycle-triggered using checkpoint token budgets only.

Files:

- `src/config.ts`
- `src/memory-update/due.ts`
- `src/memory-update/lifecycle.ts`
- `src/memory-update/checkpoint-lifecycle.ts`
- `src/memory/token-estimate.ts`
- `src/commands/status.ts`
- `tests/status-command.test.ts`
- `tests/memory-lifecycle.test.ts`

Config:

- `checkpointPruneTargetTokens`
- `checkpointPruneHardMaxTokens`

Async health prune policy:

- Estimate tokens for current checkpoint Markdown content.
- If tokens exceed `checkpointPruneTargetTokens`, schedule prune at `turn_end`.
- Do not run prune if normal checkpoint update work is pending, unless later evidence shows this is too conservative.

Compaction-pressure prune policy:

- Try normal checkpoint catch-up first.
- Run prune only if catch-up fails or is blocked because the existing checkpoint is invalid or over `checkpointPruneHardMaxTokens`.
- Retry normal checkpoint catch-up after prune if pending observations still need coverage.

Status behavior:

- Report prune due or not due.
- Report checkpoint token estimate when useful in full status.

Tests:

- Over-target checkpoint schedules prune at turn end.
- Over-target checkpoint does not prune without a current checkpoint.
- Prune records `mode: "prune"` when changed.
- Prune does not change checkpoint coverage.
- Strategy off disables prune.
- Status displays prune due.
- Compaction pressure prunes only as recovery.

Evals:

- Add `checkpoint-e2e-prunes-bloated-checkpoint` after lifecycle prune exists.
- Assert appended checkpoint event has `mode: "prune"`.
- Assert `observationIds` is empty.
- Assert coverage did not advance.
- Assert important anchors are preserved.

## Recommended implementation order

1. Checkpoint format module.
2. Split CheckpointEditor prompt branches.
3. Deepen eval scenarios and add prune evals.
4. Add memory state module.
5. Add observer recording module.
6. Add checkpoint lifecycle module.
7. Add token-budget prune triggers.

## Validation cadence

For deterministic changes:

```sh
pnpm typecheck
pnpm test -- --reporter=dot
```

For prompt and model behavior changes:

```sh
pnpm checkpoint-evals -- --model openai-codex/gpt-5.4-mini --thinking low --out runs/checkpoint-evals/<name>
```

For flaky or high-risk model behavior:

```sh
pnpm checkpoint-evals -- --model openai-codex/gpt-5.4-mini --thinking low --case <case-id> --repeat 5 --out runs/checkpoint-evals/<name>
```
