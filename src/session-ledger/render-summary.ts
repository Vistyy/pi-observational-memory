import type { Checkpoint, Observation } from "./types.js";

const CHECKPOINT_CONTEXT_USAGE_INSTRUCTIONS = `This is a checkpoint handoff for another LLM that will resume this session.

Use it to continue without repeating work.
It contains current progress, decisions, constraints, remaining work, and critical references.

Treat it as current session memory unless the recent tail or user request supersedes it.`;

export function observationToSummaryLine(observation: Observation): string {
	return `[${observation.id}] ${observation.timestamp} ${observation.content}`;
}

export function renderCheckpointSummary(checkpoint: Checkpoint | undefined): string {
	if (!checkpoint) return "";
	return `${CHECKPOINT_CONTEXT_USAGE_INSTRUCTIONS}\n\n${checkpoint.content}`;
}
