# pi-observational-memory

Session-local memory for Pi.

OM records source-backed observations as durable evidence and renders only current reflections as active memory.
Use recall when exact evidence is needed.

## Install locally

```bash
pi install /home/syzom/projects/pi-extensions/pi-observational-memory
```

For one-off testing:

```bash
pi -e /home/syzom/projects/pi-extensions/pi-observational-memory
```

## Install from GitHub

```bash
pi install git:github.com/Vistyy/pi-observational-memory@v0.1.1
```

## How it works

```text
source entries
  -> observer: durable obs_* evidence
  -> reflector: active ref_* memory from pending observations
  -> maintainer: small local cleanup of active reflections
  -> emergency rewrite: rare over-budget fallback
  -> compaction: observer tail flush + deterministic memory render
  -> recall: exact evidence and provenance recovery
```

Key rules:

- Active memory is current `ref_*` reflections only.
- Observations are hidden from active context but remain recallable.
- Retired reflections remain recallable by exact id.
- Compaction does not run reflector, maintainer, or rewrite synchronously.
- No-tool worker responses must not advance coverage.

## Configuration

Configure under `observational-memory`:

```json
{
  "observational-memory": {
    "strategy": "replacement",
    "observeEveryMessages": 32,
    "reflectEveryObservations": 8,
    "reflectionsPoolMaxTokens": 8000,
    "maxInitialObserveTokens": 100000,
    "observerThinking": "low",
    "reflectorThinking": "low",
    "rewriteThinking": "low",
    "debugLog": false
  }
}
```

Strategies:

- `replacement` - replace Pi compaction output with an OM summary.
- `off` - disable OM workers and OM compaction behavior.

`maxInitialObserveTokens` prevents expensive backfill when OM starts on an already-large session.
Old history may be marked covered; future turns are still observed.

`reflectionsPoolMaxTokens` is the hard pressure point for maintainer and emergency rewrite behavior.

## Commands

- `/om:status` - show memory state.
- `/om:status full` - include ledger/debug details.
- `/om:view` - show active context memory.
- `/om:view recorded` - show recorded observations and reflections.

## Recall

Memory ids look like `obs_...` and `ref_...`.
Recall is exact-id evidence navigation, not semantic search.

Use recall before relying on memory for exact paths, commands, errors, API names, pass/fail claims, stale/current relationships, or implementation-impacting user constraints.

Modes:

- `evidence` - requested memory, provenance ids, terminal observations, and source entries.
- `provenance` - evidence plus intermediate reflection contents.

Example:

```ts
recall({ id: "ref_...", mode: "evidence" })
```
