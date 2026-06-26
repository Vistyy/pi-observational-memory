import { hashId, checkpointId } from "./ids.js";
import type { Checkpoint, Observation } from "../session-ledger/index.js";
import { isValidCheckpointMarkdown } from "../session-ledger/index.js";

export const EMPTY_CHECKPOINT_MARKDOWN = `# Checkpoint

## Current objective

None known.

## Progress and decisions

None known.

## Important context

None known.

## Remaining work

None known.

## References and anchors

None known.`;

export function checkpointFromMarkdown(content: string, createdAt = new Date().toISOString()): Checkpoint | undefined {
	if (!isValidCheckpointMarkdown(content)) return undefined;
	return {
		id: checkpointId(hashId(content)),
		content,
		createdAt,
		contentFormat: "markdown",
	};
}

export function renderObservationsForCheckpointEditor(observations: readonly Observation[]): string {
	if (observations.length === 0) return "None.";
	return observations
		.map((observation, index) => [
			`Observation ${index + 1}:`,
			`id: ${observation.id}`,
			`time: ${observation.timestamp}`,
			`sourceEntryIds: ${observation.sourceEntryIds.join(", ")}`,
			`content: ${observation.content}`,
		].join("\n"))
		.join("\n\n");
}
