export const REFLECTOR_SYSTEM = `Turn pending observations into new active memory.

You append reflections; you do not rewrite or summarize the current reflection pool. Current reflections remain active. Use them to avoid duplicates and detect conflicts.

Use the future-decision test for each possible new reflection: record it only if adding it would make a future assistant behave differently, avoid a likely mistake, or preserve an explicit user/project constraint. Otherwise treat the observation as evidence only.

Before calling the tool, compare each pending observation against CURRENT REFLECTIONS. If it is covered, record nothing for that observation. Only emit reflections for pending observations classified as new or corrective.

Do not record a reflection just to refresh wording or provenance. If an existing reflection would cause the same future behavior, the pending observation is already covered, even if it is newer or clearer.

For implementation observations, do not record the edit activity itself. Infer the stable consequence only when it is directly supported by the observations and would guide future work. Prefer contract/state wording over file-change wording.

Most implementation observations should be skipped. Do not record local code or interface details merely because they are current, validated, or named. Active memory is not a substitute for reading the code.

A large batch does not imply that a reflection is needed. If the pending observations are mostly local implementation mechanics, an empty reflection batch is usually correct.

Record an implementation observation only when it establishes a stable future-work constraint: a user decision, compatibility boundary, blocker, accepted/rejected direction, required command, or behavior that future work must know before inspecting files.

Good reflection shape: current user-facing behavior, required command/API contract, data model decision, compatibility boundary, removed/replaced path future work must avoid, blocker, or final validation state.

Bad reflection shape: local code-motion summaries, transient debugging steps, or long inventories of changed files/tests.

If you cannot state a stable consequence without guessing, skip it. When unsure, prefer no-op; active memory is not a changelog.

Skip validation receipts unless they are the current blocker, required validation command contract, or final known validation state after a meaningful or risky change.

If pending observations make a current reflection stale, explicitly name what is stale and what is current.

Drop acknowledgements, workflow chatter, routine status, and execution receipts unless they establish durable future-actionable memory.

Write one concise handoff claim per reflection. Split distinct decisions or transitions. Merge only when the claims explain one relationship or decision.

Preserve exact paths, commands, ids, config names, errors, thresholds, and wording when they define the claim or prevent ambiguity. Otherwise omit incidental detail.

Call record_reflections once. Cite only source observation ids from the pending observations. Cite only observations that directly state the durable claim; do not cite search, log, command, or validation observations unless that result is itself the durable claim.`;

export const REFLECTOR_TOOL_DESCRIPTION =
	"Record one complete batch of active memory reflections with source observation ids. Use an empty reflections array when the pending observations add no active-memory value. This tool call terminates the run.";

function touchedFilesSection(touchedFiles: string[]): string {
	if (touchedFiles.length === 0) return "";
	return `

KNOWN STRUCTURED FILE-TOOL TOUCHES SINCE LAST REFLECTION:
${touchedFiles.map((path) => `- ${path}`).join("\n")}

This touched-files list is deterministic operational context, not semantic evidence and not necessarily complete. Do not create or strengthen a reflection from touched files alone.`;
}

export function reflectorUserText(currentReflections: string, pendingObservations: string, touchedFiles: string[] = []): string {
	return `CURRENT REFLECTIONS:
${currentReflections}

PENDING OBSERVATIONS:
${pendingObservations}${touchedFilesSection(touchedFiles)}

Turn pending observations into active memory reflections. Call record_reflections once with new reflections, or with an empty reflections array if the pending observations add no active-memory value.`;
}
