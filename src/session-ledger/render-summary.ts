import type { Observation, Reflection } from "./types.js";

const CONTEXT_USAGE_INSTRUCTIONS = `These are condensed memories from earlier in this session.

- Reflections: stable, long-lived facts about the user, project, decisions, and constraints. Reflection lines include ids in brackets.

Treat these as past records. Work that prior reflections describe as completed should not be redone unless the user explicitly asks to revisit it.

When answering from these memories, preserve exact relationship wording that disambiguates current from stale facts, especially terms like supersedes, rejected, stale, approved, current, forbidden, allowed, and unresolved. If a probe asks for an exact current detail and a stale near-match, include both and the relationship between them.

When exact source context is needed for precision or traceability, use the recall tool with the relevant observation or reflection id. This is especially useful when a reflection materially affects a decision or is too compressed to continue confidently. Do not use recall as broad search or inject raw source unless it is needed.`;

export function observationToSummaryLine(observation: Observation): string {
	return `[${observation.id}] ${observation.timestamp} ${observation.content}`;
}

export function reflectionToSummaryLine(reflection: Reflection): string {
	return `[${reflection.id}] ${reflection.content}`;
}

export function renderSummary(reflections: Reflection[], compactionHandoffObservations: Observation[] = []): string {
	if (reflections.length === 0 && compactionHandoffObservations.length === 0) return "";

	const sections = [CONTEXT_USAGE_INSTRUCTIONS];
	if (reflections.length > 0) sections.push(`## Reflections\n${reflections.map(reflectionToSummaryLine).join("\n")}`);
	if (compactionHandoffObservations.length > 0) {
		sections.push(`## Compaction handoff observations\nThese facts were extracted from source turns that compaction removed before they were reflected. They are temporary bridge context until the reflector catches up.\n${compactionHandoffObservations.map(observationToSummaryLine).join("\n")}`);
	}
	return sections.join("\n\n");
}
