import { isSourceEntry, type Entry } from "../session-ledger/index.js";

export function sourceEntriesAfter(entries: Entry[], index: number, beforeIndex?: number): Entry[] {
	const end = beforeIndex === undefined ? entries.length : Math.max(index + 1, beforeIndex);
	return entries.slice(index + 1, end).filter(isSourceEntry);
}
