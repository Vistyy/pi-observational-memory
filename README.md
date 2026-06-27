# pi-observational-memory

Session-local memory for Pi.

OM records source-backed observations as durable evidence.
It keeps one current Markdown checkpoint as the model-visible handoff.
Compaction renders that checkpoint into Pi's compacted context.

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
pi install git:github.com/Vistyy/pi-observational-memory@v0.1.2
```

## How it works

```text
source entries
  -> observer: durable obs_* evidence
  -> checkpoint editor: rolling check_* Markdown checkpoint
  -> compaction: observer tail flush + checkpoint render
```

Key rules:

- The checkpoint is the primary model-visible memory artifact.
- Observations are durable source-backed evidence for checkpoint updates.
- Checkpoint updates advance coverage when observations do not require content changes.
- Failed or invalid checkpoint drafts do not advance coverage.
- Compaction may flush unobserved tail entries before rendering the checkpoint.
- No-tool worker responses must not advance coverage.

## Configuration

Configure under `observational-memory`:

```json
{
  "observational-memory": {
    "strategy": "replacement",
    "observeEveryMessages": 8,
    "observeHardCapRecords": 32,
    "maxInitialObserveTokens": 100000,
    "observerThinking": "low",
    "debugLog": false
  }
}
```

Tool output policies are opt-in.
Use `omit`, `bounded`, or `full` per tool name:

```json
{
  "observational-memory": {
    "observerToolOutputPolicies": {
      "fork": "full",
      "subagent": "full"
    }
  }
}
```

Strategies:

- `replacement` - replace Pi compaction output with an OM checkpoint summary.
- `off` - disable OM workers and OM compaction behavior.

`observeEveryMessages` controls the turn-end observer threshold.
`observeHardCapRecords` controls the mid-turn emergency observer threshold.
`maxInitialObserveTokens` prevents expensive backfill when OM starts on an already-large session.
Old history may be marked covered, while future turns are still observed.
`agentMaxTurns` limits worker agent loops.
`model` can override the worker model with `{ "provider": "...", "id": "...", "thinking": "..." }`.

## Commands

- `/om:status` - show checkpoint health and observer coverage.
- `/om:status full` - include ledger and debug details.
- `/om:view` - show the current checkpoint content.
- `/om:view recorded` - show recorded observations and checkpoint events.

## Memory ids

Observation ids look like `obs_...`.
Checkpoint ids look like `check_...`.
Ledger entry ids are separate from memory ids.
