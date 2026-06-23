export const RECALL_OBSERVATION_TOOL_NAME = "recall";

export const RECALL_TOOL_TEXT = {
	description: "Recover source evidence and provenance for a known observational-memory id on the current branch.",
	promptSnippet: "Use recall(<id>) when a known compacted-memory id needs exact evidence or provenance.",
	promptGuidelines: [
		"Use recall when a decision depends on details hidden behind a specific compacted-memory id.",
		"Use recall when the user asks for the evidence, source context, or provenance behind a known memory.",
		"Select only the specific memory id or ids whose hidden details are needed for the answer; do not recall every id in a memory excerpt or nearby ids from unrelated topics.",
		"Use mode: \"provenance\" only when intermediate reflection contents are needed, not just their ids; otherwise use the default evidence mode.",
		"Do not use recall as semantic search or transcript browsing; you must already have a specific obs_*, ref_*, or legacy 12-character memory id.",
		"Do not recall ids whose details are already clear from recent conversation or active context.",
	],
	idDescription: "Specific typed obs_* or ref_* memory id, or legacy 12-character lowercase hex id. This tool does not search by topic.",
	modeDescription: "Recall rendering mode. evidence returns requested memory, terminal observations, source entries, and intermediate refs as provenance ids. provenance additionally materializes intermediate reflection contents.",
	depthDescription: "Optional explicit cap on ref-to-ref provenance traversal depth. Omit to traverse all reachable supporting reflections.",
} as const;

export const MEMORY_ID_PATTERN = /^(?:[a-f0-9]{12}|obs_[a-f0-9]{12}|ref_[a-f0-9]{12})$/;
