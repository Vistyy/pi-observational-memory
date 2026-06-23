# Reflection-only memory design

This is the canonical OM design note.
The README describes user-facing behavior; this file records the stable internal contract.

## Core model

```text
ledger = durable truth
active memory = current reflections only
recall = exact evidence recovery
```

The ledger stores source entries, observations, reflections, retirement events, and usage/status records.
Projection derives the current active memory from that ledger.

Observations are evidence.
They are not rendered as normal active memory.

Reflections are active memory.
They must be concise, current, and backed by typed source ids.

## Ids and records

Typed ids are required in model-facing memory data:

```text
obs_* = observation
ref_* = reflection
rw_*  = reflection rewrite or retirement event
```

A reflection has one shape regardless of producer:

```ts
interface Reflection {
  id: string;
  content: string;
  sources: string[];
  createdAt: string;
}
```

Normal reflector output cites direct `obs_*` evidence.
Maintainer and rewrite replacements cite direct parent `ref_*` ids.
They do not flatten transitive observation ancestry.
Recall traverses ancestry when needed.

Legacy records are normalized or ignored only at read boundaries.
Core projection should not keep parallel legacy behavior.

## Pipeline contracts

Observer:

- reads source chunks only
- extracts source-backed `obs_*` evidence
- does not decide active-memory worth
- does not advance coverage on invalid or no-tool output

Reflector:

- reads current reflections plus pending observations
- emits active `ref_*` reflections sourced to observations
- may emit an empty batch when nothing durable should become active memory
- does not retire reflections

Maintainer:

- reads a bounded active-reflection cluster
- merges duplicates, local stale/current pairs, and completed local trails
- emits replacement reflections sourced to direct parent refs
- retires only input-cluster refs
- no-ops on unsafe output

Emergency rewrite:

- is not the normal lifecycle
- runs only under hard active-memory pressure
- must produce a smaller safe active reflection set
- no-ops on invalid, unchanged, duplicate, or over-budget output

Compaction:

- may run only an observer tail flush for source that is about to disappear
- renders deterministic active memory
- must not synchronously run reflector, maintainer, curator, or rewrite

## Removed surfaces

The live architecture has no curator, pinning, unpinning, reviewed/unreviewed pool, dropper, or additive mode.
Old ledger events for those surfaces may be tolerated at read boundaries, but they do not define active state.

## Recall contract

Recall accepts exact `obs_*`, `ref_*`, or legacy 12-character ids.
It is not semantic search.

Traversal:

```text
ref_* -> ref_* -> obs_* -> source entries
ref_* -> obs_* -> source entries
obs_* -> source entries
```

Modes:

```text
evidence   = requested memory, provenance ids, terminal observations, source entries
provenance = evidence plus intermediate reflection contents
```

Recall output is bounded and sanitized.
Assistant thinking and assistant tool-call payloads must not be exposed.

## Safety model

Evidence loss should not happen because evidence stays in the ledger.

The main risk is discoverability loss: a fact remains recallable but no active reflection points to it.
Mitigations:

- conservative maintainer and rewrite prompts
- deterministic validation
- no-op on unsafe maintenance
- retired-reflection recall
- evals for exact anchors, stale/current relationships, user constraints, blockers, and provenance

Decision-relevant handles should stay discoverable:

- current blockers
- unresolved-vs-fixed status
- user constraints and preferences
- exact commands, paths, errors, config names, and API names
- stale/current relationships
- durable architecture decisions
- decisions not to do something

## Current status

Implemented:

- typed ids and typed `sources`
- reflection-only active projection
- observer source-only input
- reflector pending-observation input
- maintainer as normal bounded cleanup
- emergency rewrite fallback
- retirement events and retired-reflection recall
- recall `mode: "evidence" | "provenance"`
- bounded, sanitized recall source rendering
- realistic OM evals with judge scoring

Current follow-up work:

- dogfood before further prompt tuning
- keep `/om:status` useful for pressure, skips, failures, and usage
- evaluate compact fork snapshots against full snapshots
