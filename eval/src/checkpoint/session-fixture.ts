import { readFileSync } from "node:fs";
import { renderObservationsForCheckpointEditor } from "../../../src/memory/checkpoint.js";
import { isValidCheckpointMarkdown } from "../../../src/memory/checkpoint-format.js";
import type { Checkpoint, Entry, Observation } from "../../../src/session-ledger/index.js";

export const DEFAULT_REAL_SESSION_PATH = "/home/syzom/.pi/agent/sessions/--home-syzom-.pi-agent--/2026-06-25T13-09-04-858Z_019efee5-f8da-7fe4-a4a8-91009462be14.jsonl";

function section(content: string, heading: string, nextHeadings: string[]): string {
	const start = content.indexOf(heading);
	if (start === -1) return "None known.";
	const bodyStart = start + heading.length;
	const next = nextHeadings
		.map((candidate) => content.indexOf(candidate, bodyStart))
		.filter((index) => index !== -1)
		.sort((a, b) => a - b)[0];
	const body = content.slice(bodyStart, next ?? content.length).trim();
	return body.length > 0 ? body : "None known.";
}

function joinSections(parts: string[]): string {
	const meaningful = parts.map((part) => part.trim()).filter((part) => part.length > 0 && part !== "None known.");
	return meaningful.length > 0 ? meaningful.join("\n\n") : "None known.";
}

export function rewriteCheckpointToHandoffForEval(content: string): string {
	if (isValidCheckpointMarkdown(content)) return content;
	if (!content.includes("# Checkpoint")) return content;
	const currentObjective = section(content, "## Current objective", ["## Progress and decisions", "## Important context", "## Remaining work", "## References and anchors"]);
	const progress = section(content, "## Progress and decisions", ["## Important context", "## Remaining work", "## References and anchors"]);
	const context = section(content, "## Important context", ["## Remaining work", "## References and anchors"]);
	const remaining = section(content, "## Remaining work", ["## References and anchors"]);
	const references = section(content, "## References and anchors", []);
	return `# Handoff\n\n## Focus\n\n${currentObjective}\n\n## State\n\n${joinSections([progress, context])}\n\n## Next\n\n${remaining}\n\n## References\n\n${references}`;
}

function rewriteCheckpointEntryForEval(entry: Entry): Entry {
	const data = entry.data as { checkpoint?: Checkpoint } | undefined;
	if (!data?.checkpoint?.content) return entry;
	const content = rewriteCheckpointToHandoffForEval(data.checkpoint.content);
	if (content === data.checkpoint.content) return entry;
	return {
		...entry,
		data: {
			...data,
			checkpoint: {
				...data.checkpoint,
				content,
			},
		},
	};
}

export function loadSessionEntries(path: string): Entry[] {
	return readFileSync(path, "utf-8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => rewriteCheckpointEntryForEval(JSON.parse(line) as Entry));
}

function checkpointEntryContent(entry: Entry): Checkpoint | undefined {
	const data = entry.data as { checkpoint?: unknown } | undefined;
	const checkpoint = data?.checkpoint as Checkpoint | undefined;
	return checkpoint?.content ? checkpoint : undefined;
}

function observationsEntryContent(entry: Entry): Observation[] | undefined {
	const data = entry.data as { observations?: unknown } | undefined;
	return Array.isArray(data?.observations) ? data.observations as Observation[] : undefined;
}

export function loadCheckpointFromSession(path: string, entryId: string): Checkpoint {
	const entry = loadSessionEntries(path).find((candidate) => candidate.id === entryId);
	if (!entry) throw new Error(`session fixture checkpoint entry not found: ${entryId}`);
	const checkpoint = checkpointEntryContent(entry);
	if (!checkpoint) throw new Error(`session fixture entry is not a checkpoint: ${entryId}`);
	return checkpoint;
}

export function loadLatestCheckpointFromSession(path: string = DEFAULT_REAL_SESSION_PATH): { checkpoint: Checkpoint; entryId: string; entryIndex: number } {
	const entries = loadSessionEntries(path);
	for (let index = entries.length - 1; index >= 0; index--) {
		const checkpoint = checkpointEntryContent(entries[index]);
		if (checkpoint) return { checkpoint, entryId: entries[index].id, entryIndex: index };
	}
	throw new Error(`session fixture has no checkpoint entries: ${path}`);
}

export function loadObservationsFromSession(path: string, entryId: string): Observation[] {
	const entry = loadSessionEntries(path).find((candidate) => candidate.id === entryId);
	if (!entry) throw new Error(`session fixture observations entry not found: ${entryId}`);
	const observations = observationsEntryContent(entry);
	if (!observations) throw new Error(`session fixture entry is not observations: ${entryId}`);
	return observations;
}

export function loadCheckpointUpdateFixture(args: {
	sessionPath?: string;
	checkpointEntryId: string;
	observationsEntryId: string;
}): { initialContent: string; observationsText: string; metadata: Record<string, unknown> } {
	const sessionPath = args.sessionPath ?? DEFAULT_REAL_SESSION_PATH;
	const checkpoint = loadCheckpointFromSession(sessionPath, args.checkpointEntryId);
	const observations = loadObservationsFromSession(sessionPath, args.observationsEntryId);
	return {
		initialContent: checkpoint.content,
		observationsText: renderObservationsForCheckpointEditor(observations),
		metadata: {
			sessionPath,
			checkpointEntryId: args.checkpointEntryId,
			observationsEntryId: args.observationsEntryId,
			observationIds: observations.map((observation) => observation.id),
		},
	};
}
