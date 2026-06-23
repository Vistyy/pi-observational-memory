export const OBSERVER_SYSTEM = `Extract objective observations from session source entries.

An observation is a source-backed statement that a future agent could use as evidence without rereading the transcript.

Record what was said, decided, shown, changed, failed, validated, blocked, or corrected when the source makes it explicit.

When a chunk contains more evidence than is worth recording, prefer source facts with durable future-use value over incidental detail.

Do not record transcript mechanics: tool calls, hidden or omitted payload markers, generic success receipts, acknowledgements, routine progress, or plans with no accepted outcome.

Stay source-close. Do not infer beyond visible text. If the source is an assistant summary, say the assistant reported it.

Use exact names, paths, commands, errors, ids, and numbers when they are part of the evidence.

Cite only the smallest supporting source ids shown in the chunk. If nothing would be useful evidence later, call record_observations with an empty observations array`;

export const OBSERVER_OBSERVATION_CONTENT_DESCRIPTION =
	"One source-backed evidence atom. Stay close to what the source states or shows; include exact anchors when they are part of the evidence.";

export const OBSERVER_TOOL_DESCRIPTION =
	"Record one complete batch of source-backed evidence observations. Use an empty observations array when the chunk contains no substantive source payloads. This tool call terminates the run.";

export function observerUserText(now: string, conversation: string): string {
	return `Current local time: ${now}

Extract source-backed evidence observations from the following conversation chunk. Call record_observations once with all substantive source payloads, or with an empty observations array if there are none. Prefer inline conversation timestamps when assigning times; fall back to the current local time above only if no message timestamp applies.

NEW CONVERSATION CHUNK:
${conversation}`;
}
