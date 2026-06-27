# Checkpoint removal audit

## Status

This audit completes the in-repo removal gate for the checkpoint migration.

The legacy active-reflection architecture is not present in source, tests, eval code, or README.

Remaining references are historical or architectural documentation only.

## Audit command

```sh
rg -n "reflections?|Reflection|ref_|maintainer|rewrite|recall|om\.folded|reflector|active-memory" src tests eval README.md
```

Result:

```text
no matches
```

## Documentation matches

The same search still matches these documentation files:

- `docs/checkpoint-migration-plan.md`
- `docs/adr/0001-checkpoints-replace-active-reflections.md`
- `CONTEXT.md`

These references are retained because they describe the migration decision, not active runtime paths.

## Dispositions

### Active reflections

No active reflection source, command, test, or eval path remains in this repo.

### Reflector, maintainer, and rewrite agents

No reflector, maintainer, or rewrite agent source, command, test, or eval path remains in this repo.

### Legacy recall

No legacy model-facing recall source, command, test, or eval path remains in this repo.

Future recall work must be designed as a new checkpoint-provenance feature.

It must not revive the old reflection-pool recall path.

### `om.folded`

No source, test, eval, or README compatibility path for `om.folded` remains in this repo.

The term `folded` remains only as internal ledger folding vocabulary in source.

That internal fold state is not a durable compaction detail type and is not the old `om.folded` compatibility path.

### Reflection-oriented docs

Historical docs are retained with this audit as the explicit justification required by the migration plan.

The migration decision remains useful context for why checkpoint memory replaced active reflections.

## External note

The migration plan mentions pi-fork integration.

This repo now emits `om.checkpoint` compaction details.

Any pi-fork consumer changes must be verified in the pi-fork or Pi repo, not in this package.
