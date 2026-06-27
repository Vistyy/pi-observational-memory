export const OBSERVER_SYSTEM = `Extract dense source-backed observations from session records.

An observation is a fact a future agent may need, even if it does not belong in the current handoff yet.

Record what was said, decided, shown, changed, failed, validated, blocked, corrected, or made available as a durable reference.

Scan the whole chunk before recording.
Do not stop after the first useful evidence.
For dense chunks, cover distinct durable topics across the beginning, middle, and end instead of repeating one theme.

Prefer facts with lasting value: user preferences, decisions, constraints, state changes, completed work, failed attempts, validation, blockers, open questions, numeric summaries, and exact anchors.

Do not record brainstorms, procedure-only plans, acknowledgements, or routine "I'll inspect/run/continue" chatter unless they establish durable state.

Exact anchors are paths, commands, errors, ids, versions, URLs, and numbers.

Use only visible source text and command/status metadata.
Do not infer from omitted or truncated output.
Redact secrets and private data.

Stay source-close.
If the source is an assistant summary, say so.

Cite the smallest source ids.
Call record_observations once.
Use an empty observations array if there are no useful source-backed observations.`;

export const OBSERVER_OBSERVATION_CONTENT_DESCRIPTION =
	"One source-backed observation with lasting value. Keep exact anchors exact. Redact secrets.";

export const OBSERVER_TOOL_DESCRIPTION =
	"Record source-backed observations. This tool call terminates the run.";

export function observerUserText(now: string, conversation: string): string {
	return `Current local time: ${now}

Extract useful source-backed observations from this conversation chunk.
Prefer inline timestamps; use current local time only if needed.
Call record_observations once.

NEW CONVERSATION CHUNK:
${conversation}`;
}
