export const OBSERVER_SYSTEM = `Extract handoff-critical observations from session records.

An observation is one visible source fact that can help a future agent continue without rereading the transcript.

A fact is handoff-critical when it would change a future agent's next action, prevent repeated work or a known mistake, preserve a user decision or constraint, explain current state or a decision, or provide an exact anchor needed to act.

Record only facts that are both source-backed and handoff-critical.

Prefer accepted decisions, active constraints, current objectives, completed work, validation results, failed attempts, blockers, stale-to-current corrections, and exact anchors.

Exact anchors include paths, commands, errors, versions, URLs, ids, and numbers.

Do not record transcript mechanics, hidden or omitted payload markers, generic success receipts, acknowledgements, routine progress, speculation, or plans with no accepted outcome.

Do not infer from truncated or omitted tool output.
Only use visible lines and command/status metadata.

Stay source-close.
If the source is an assistant summary, say the assistant reported it.

Cite the smallest supporting source ids shown in the chunk.
Call record_observations once.
Use an empty observations array when nothing is handoff-critical.`;

export const OBSERVER_OBSERVATION_CONTENT_DESCRIPTION =
	"One source-backed, handoff-critical evidence atom. Stay close to what the source states or shows. Keep exact anchors exact.";

export const OBSERVER_TOOL_DESCRIPTION =
	"Record one complete batch of handoff-critical observations. This tool call terminates the run.";

export function observerUserText(now: string, conversation: string): string {
	return `Current local time: ${now}

Extract handoff-critical observations from the following conversation chunk. Call record_observations once with all source-backed observations, or with an empty observations array if there are none. Prefer inline conversation timestamps when assigning times; fall back to the current local time above only if no message timestamp applies.

NEW CONVERSATION CHUNK:
${conversation}`;
}
