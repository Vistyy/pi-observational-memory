import type { Checkpoint, Observation } from "./types.js";

const CHECKPOINT_CONTEXT_USAGE_INSTRUCTIONS = `These are condensed memories from earlier in this session.

The checkpoint below is the current handoff core.
It should be treated as current session memory unless the recent tail or user request supersedes it.`;

export function observationToSummaryLine(observation: Observation): string {
	return `[${observation.id}] ${observation.timestamp} ${observation.content}`;
}

export function renderCheckpointSummary(checkpoint: Checkpoint | undefined): string {
	if (!checkpoint) return "";
	return `${CHECKPOINT_CONTEXT_USAGE_INSTRUCTIONS}\n\n${checkpoint.content}`;
}
