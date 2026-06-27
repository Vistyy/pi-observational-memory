import { EMPTY_CHECKPOINT_MARKDOWN } from "../../../src/memory/checkpoint.js";
import { gradeContent } from "./grading.js";
import { loadCheckpointUpdateFixture } from "./session-fixture.js";
import type { EvalCase } from "./types.js";

const baseWithObjective = EMPTY_CHECKPOINT_MARKDOWN.replace("None known.", "Continue OM checkpoint migration.");

function realSessionWideContextCase(): EvalCase {
	const fixture = loadCheckpointUpdateFixture({
		checkpointEntryId: "7fbd419c",
		observationsEntryId: "c050a7e8",
	});
	return {
		id: "checkpoint-preserves-session-wide-context",
		purpose: "update",
		initialContent: fixture.initialContent,
		observationsText: fixture.observationsText,
		metadata: fixture.metadata,
		maxTurns: 8,
		grade: (result) => gradeContent(result, {
			requireChanged: true,
			requireAll: [
				"ObserverRecordPlanner",
				"finish_checkpoint_edit",
				"/om:view",
				"deterministic",
				"model",
				"019efee5-f8da-7fe4-a4a8-91009462be14",
				"/home/syzom/.pi/agent/sessions/--home-syzom-.pi-agent--/2026-06-25T13-09-04-858Z_019efee5-f8da-7fe4-a4a8-91009462be14.jsonl",
				"session records",
				"repeat",
			],
		}),
	};
}

export function loadCheckpointEvalCases(): EvalCase[] {
	return [
		{
			id: "checkpoint-preserves-operational-anchors",
			purpose: "update",
			initialContent: EMPTY_CHECKPOINT_MARKDOWN,
			observationsText: [
				"Observation 1:",
				"id: obs_111111111111",
				"time: 2026-06-26T10:00:00.000Z",
				"sourceEntryIds: user-1, tool-1",
				"content: Current task is migrating OM to checkpoint memory in /home/syzom/projects/pi-extensions/pi-observational-memory. Validation passed with `pnpm typecheck && pnpm test -- --reporter=dot`, 14 test files and 85 tests passed.",
			].join("\n"),
			maxTurns: 8,
			grade: (result) => gradeContent(result, {
				requireChanged: true,
				requireAll: ["/home/syzom/projects/pi-extensions/pi-observational-memory", "pnpm typecheck", "pnpm test", "14", "85"],
			}),
		},
		{
			id: "checkpoint-replaces-stale-current-detail",
			purpose: "update",
			initialContent: baseWithObjective.replace("None known.", "apiMode=legacy is the current API mode."),
			observationsText: [
				"Observation 1:",
				"id: obs_222222222222",
				"time: 2026-06-26T10:05:00.000Z",
				"sourceEntryIds: user-2",
				"content: The old apiMode=legacy statement is stale. Current API mode is apiMode=streaming, and legacy must not guide implementation.",
			].join("\n"),
			grade: (result) => gradeContent(result, {
				requireChanged: true,
				requireAll: ["apiMode=streaming", "legacy", "stale"],
				forbidAny: ["apiMode=legacy is the current API mode"],
			}),
		},
		{
			id: "checkpoint-noops-already-covered-observation",
			purpose: "update",
			initialContent: baseWithObjective.replace("None known.", "Checkpoint updates preserve exact commands, paths, ids, blockers, and stale/current transitions."),
			observationsText: [
				"Observation 1:",
				"id: obs_333333333333",
				"time: 2026-06-26T10:10:00.000Z",
				"sourceEntryIds: user-3",
				"content: Reminder: checkpoint updates should preserve exact commands, paths, ids, blockers, and stale/current transitions.",
			].join("\n"),
			grade: (result) => gradeContent(result, {
				requireUnchanged: true,
				requireAll: ["exact commands", "paths", "ids", "blockers", "stale/current"],
			}),
		},
		{
			id: "checkpoint-prunes-duplicate-detail",
			purpose: "prune",
			initialContent: `# Checkpoint

## Current objective

Continue OM checkpoint migration.

## Progress and decisions

- Keep exact anchor \`src/agents/checkpoint-editor/prompts.ts\`.
- Duplicated low-value detail: repeat-me repeat-me repeat-me repeat-me.
- Duplicated low-value detail: repeat-me repeat-me repeat-me repeat-me.

## Important context

Checkpoint pruning must preserve active decisions and anchors.

## Remaining work

Keep checkpoint concise.

## References and anchors

- \`src/agents/checkpoint-editor/prompts.ts\`
`,
			observationsText: "None.",
			maxTurns: 8,
			grade: (result) => gradeContent(result, {
				requireChanged: true,
				requireAll: ["src/agents/checkpoint-editor/prompts.ts", "Checkpoint pruning"],
				forbidAny: ["repeat-me repeat-me repeat-me repeat-me"],
			}),
		},
		realSessionWideContextCase(),
	];
}
