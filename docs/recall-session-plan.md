# Recall session plan

## Status

This is a handoff note only.

Do not implement recall until checkpoint architecture, checkpoint pruning, and checkpoint cost work are stable.

This document is separate from checkpoint speed, cost, and pruning work.

See [Checkpoint speed, cost, and pruning plan](checkpoint-speed-cost-and-pruning-plan.md).

## Purpose

Add truthful recall for prior context from the current session.

Recall is evidence retrieval, not memory rewriting.

Recall must not revive the old reflection-pool recall path.

## Design values

Recall is read-only.

Recall must not rewrite checkpoint memory.

Recall must not guess.

Recall should answer only from visible, source-backed evidence.

Checkpoint Markdown should stay clean and model-visible.

Provenance, if added, should live beside checkpoint events in machine-readable session data.

## V1 scope

Add one public tool:

```ts
recall_session({ question: string })
```

The public tool name is `recall_session`.

Do not also expose `recall_memory` unless this plan is changed before implementation.

The tool searches only the current session.

The tool does not search durable cross-session memory.

The normal agent should pass a question or search query.

The normal agent should not pass checkpoint ids, observation ids, or source ids.

The tool spawns a Recall agent with private deterministic search and read tools.

The Recall agent must end with a typed `finish_recall(...)` tool call.

The runtime validates the typed arguments and constructs the tool result.

No agent should print JSON manually.

## Search model

Recall should search newest to oldest within the current session.

Recall should prefer curated evidence before raw source evidence.

Recall should fetch raw source windows only after finding likely checkpoint or observation hits.

Recall should return `not_found` or `uncertain` instead of guessing.

## Search order

The Recall agent searches in this order:

1. current checkpoint
2. checkpoint provenance or observation snapshots when available
3. observations
4. exact source entries for likely observations when available
5. bounded raw session transcript windows when surrounding context matters

## Checkpoint provenance idea

A checkpoint packet may be built from checkpoint Markdown plus machine-readable provenance.

Likely provenance fields:

```ts
provenance: {
  observationIds: string[];
  sourceEntryIds: string[];
  observationSnapshots: Array<{
    id: string;
    content: string;
    timestamp: string;
    sourceEntryIds: string[];
  }>;
}
```

Raw source records should remain in the JSONL session file.

Recall should read raw session JSONL only through bounded tools.

## Possible private Recall agent tools

Possible private tools:

```ts
search_recall_evidence({ query })
read_checkpoint_provenance({ checkpointId })
read_observation_snapshot({ observationId })
read_session_entries({ entryIds })
read_session_window({ aroundEntryId, before, after })
finish_recall({ status, answer, evidence })
```

The exact private tool interface is still open.

Keep the public interface smaller than the private search mechanics.

## V1 result

```ts
type RecallSessionResult = {
  status: "answered" | "partial" | "uncertain" | "not_found";
  answer: string;
  evidence: Array<{
    source: "checkpoint" | "observation" | "session_entry";
    ref: string;
    quote: string;
  }>;
};
```

Evidence should be compact.

Use at most 3 to 5 evidence items.

Use short quotes only.

Do not dump raw transcript text.

## Open decisions

The exact evidence `ref` format still needs to be defined.

The raw transcript fallback needs hard bounds for entries, characters, and quote length.

The private deterministic tool interface still needs to be defined.

The status meanings still need acceptance criteria.

The runtime validation behavior for invalid refs or invalid quotes still needs to be defined.

The Recall model and thinking configuration still need to be defined.

The checkpoint provenance shape still needs to be defined.

The default number of searchable checkpoints or checkpoint packets still needs to be defined.

The compaction behavior still needs to be defined when raw source entries are no longer available.

Recall evals still need to prove semantic lookup when the phrasing differs from the question.

## Supersedes

This document merges and supersedes `recall-handoff-plan.md`.

It also supersedes the recall section that used to live in `checkpoint-recall-and-editor-cost-plan.md`.
