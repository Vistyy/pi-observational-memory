# Recall handoff plan

## Status

This is a handoff note only.

Do not implement recall until the checkpoint architecture and migration plans are fully green.

## Goal

Add recall as a new checkpoint-provenance feature.

Do not revive the old reflection-pool recall path.

## Working idea

Keep checkpoint Markdown clean and model-visible.

Store provenance beside checkpoint events in JSONL.

Expose one public tool to the main agent:

```ts
recall_memory({ question: string })
```

The public tool should spawn a Recall agent.

The Recall agent should search checkpoint history and bounded session evidence, then return an answer with evidence.

## Likely architecture

The normal agent should not pass ids to recall.

The normal agent should pass a question or search query.

The Recall agent should search newest to oldest across checkpoint packets.

A checkpoint packet should be built from checkpoint Markdown plus machine-readable provenance.

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

Recall should fetch raw source windows only after finding likely checkpoint or observation hits.

## Private Recall agent tools

Possible private tools:

```ts
search_checkpoints({ query })
read_checkpoint_provenance({ checkpointId })
read_session_entries({ entryIds })
read_session_window({ aroundEntryId, before, after })
finish_recall({ answer, evidence })
```

The main agent should only see `recall_memory`.

## Search order

Recall should run in passes:

1. Search checkpoint Markdown and checkpoint provenance summaries.
2. Read observation snapshots for likely checkpoints.
3. Read exact source entries for likely observations.
4. Read bounded source windows when surrounding context matters.
5. Return `not_found` or `uncertain` instead of guessing.

## Design questions for grilling

Should checkpoint events store observation snapshots, source ids, or both?

Should Recall read raw session JSONL directly, or only through bounded tools?

How many checkpoints can Recall search by default?

What evidence citations should Recall return?

What survives compaction if raw source entries are no longer available?

Should Recall have its own model and thinking config?

How should recall evals prove semantic lookup when the phrasing differs from the question?
