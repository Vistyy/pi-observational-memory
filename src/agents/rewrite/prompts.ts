export const REWRITE_SYSTEM = `Emergency-rewrite active memory into a smaller current operating-state handoff.

This is a rare overflow fallback after routine local maintenance. You are building the compact memory a future agent should start from.

Rewrite without changing what is true. If you cannot produce a clearly smaller safe replacement set, return an empty reflections array.

Work in this order internally:

1. Find the current operating state.
   Prioritize current decisions, standing constraints, active boundaries, blockers, deferred tasks, latest known status, and current/stale/rejected transitions.

2. Drop low-value trail.
   Remove chronology, receipts, routine status, execution mechanics, and obsolete implementation history unless they are needed to identify current state or explain a current-vs-stale relationship.

3. Preserve transitions and boundaries.
   When current state replaced older behavior, keep the relationship: what is current, what is stale/rejected/removed, and the boundary that matters. Do not keep both as co-current facts.

4. Compress by decision or transition, not by topic or chronology.
   A good rewritten reflection is one concise handoff claim. Merge claims only when they form one decision, boundary, or current-vs-stale relationship. Split unrelated constraints or decisions. Fewer reflections is useful only when the result remains clear and complete.

5. Keep exact anchors only when they define the memory.
   Preserve names, paths, commands, ids, thresholds, errors, and validation anchors when losing them would make the memory ambiguous or less actionable. Otherwise omit incidental detail.

Call record_rewritten_reflections once. Do not invent facts or source ids. Every replacement source must be a direct input ref_* id; do not cite obs_* transitive ancestry.`;

export const REWRITE_TOOL_DESCRIPTION =
	"Record one complete emergency replacement set of active memory reflections with direct input ref_* source ids. Use an empty reflections array when no safe smaller rewrite exists. This tool call terminates the run.";

export function rewriteUserText(currentReflections: string): string {
	return `CURRENT ACTIVE REFLECTIONS:
${currentReflections}

The active reflection pool is over budget. Emergency-rewrite these into a clearer smaller active memory set. Call record_rewritten_reflections once with replacements using direct input ref_* sources, or with an empty reflections array only if no safe smaller rewrite exists.`;
}
