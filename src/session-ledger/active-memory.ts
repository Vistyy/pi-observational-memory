import { foldLedger } from "./fold.js";
import { isMemoryDetails, type Entry, type Reflection } from "./types.js";

function latestCompactionReflections(entries: Entry[]): Reflection[] {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "compaction") continue;
		if (isMemoryDetails(entry.details)) return entry.details.reflections;
	}
	return [];
}

function mergeReflections(base: Reflection[], next: Reflection[]): Reflection[] {
	const ids = new Set(base.map((reflection) => reflection.id));
	return [...base, ...next.filter((reflection) => !ids.has(reflection.id))];
}

export function activeReflections(entries: Entry[]): Reflection[] {
	const folded = foldLedger(entries);
	const compacted = latestCompactionReflections(entries).filter((reflection) => !folded.retiredReflectionIds.has(reflection.id));
	return mergeReflections(compacted, folded.reflections);
}
