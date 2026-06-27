import { EMPTY_CHECKPOINT_MARKDOWN } from "../../../src/memory/checkpoint.js";
import { OM_CHECKPOINT_RECORDED, OM_OBSERVATIONS_RECORDED, foldLedger, type Entry } from "../../../src/session-ledger/index.js";
import { gradeContent, includesAll } from "./grading.js";
import { DEFAULT_REAL_SESSION_PATH, loadCheckpointUpdateFixture } from "./session-fixture.js";
import { editorPruneScenario, sessionReplayScenario } from "./scenarios.js";
import type { EvalCase, SessionReplayResult } from "./types.js";

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
				"session",
				"repeat",
			],
		}),
	};
}

function gradeSessionReplay(result: SessionReplayResult | undefined) {
	if (!result?.content) return { passed: false, reason: "session replay did not produce a checkpoint", missing: ["checkpoint"] };
	const missing = includesAll(result.content, [
		"ObserverRecordPlanner",
		"finish_checkpoint_edit",
		"/om:view",
		"019efee5-f8da-7fe4-a4a8-91009462be14",
		"session",
		"repeat",
	]);
	const appendedTypes = new Set(result.appendedEntries.map((entry) => entry.customType));
	if (!appendedTypes.has(OM_OBSERVATIONS_RECORDED)) missing.push(OM_OBSERVATIONS_RECORDED);
	if (!appendedTypes.has(OM_CHECKPOINT_RECORDED)) missing.push(OM_CHECKPOINT_RECORDED);
	if (result.finalEntryCount <= result.initialEntryCount) missing.push("appended entries");
	if (result.uncheckpointedObservationCount !== 0) missing.push("checkpoint coverage for all replayed observations");
	return {
		passed: missing.length === 0,
		reason: missing.length === 0 ? "session replay checks passed" : "session replay checks failed",
		missing,
	};
}

function realSessionReplayCase(): EvalCase {
	return {
		kind: "session-replay",
		id: "checkpoint-e2e-replays-session-slice",
		sessionPath: DEFAULT_REAL_SESSION_PATH,
		throughEntryId: "74df84d1",
		maxTurns: 8,
		metadata: {
			sessionPath: DEFAULT_REAL_SESSION_PATH,
			checkpointEntryId: "7fbd419c",
			omittedObservationsEntryId: "c050a7e8",
			throughEntryId: "74df84d1",
		},
		grade: gradeSessionReplay,
	};
}

function checkpointPruneReplayCase(): EvalCase {
	const bloatedCheckpoint = EMPTY_CHECKPOINT_MARKDOWN.replace("None known.", [
		"Preserve lifecycle prune replay anchor.",
		"Low-value duplicate detail: replay-noise replay-noise replay-noise replay-noise.",
		"Low-value duplicate detail: replay-noise replay-noise replay-noise replay-noise.",
	].join("\n"));
	return sessionReplayScenario({
		id: "checkpoint-e2e-prunes-bloated-checkpoint",
		sessionPath: DEFAULT_REAL_SESSION_PATH,
		throughEntryId: "74df84d1",
		maxTurns: 8,
		runtimeConfig: {
			observeEveryMessages: 999_999,
			observeHardCapRecords: 999_999,
			checkpointPruneTargetTokens: 1,
		},
		metadata: {
			sessionPath: DEFAULT_REAL_SESSION_PATH,
			throughEntryId: "74df84d1",
		},
		prepareEntries: (entries: Entry[]) => {
			const folded = foldLedger(entries);
			const coverageId = folded.observations.at(-1)?.id;
			if (!coverageId) throw new Error("prune replay fixture has no observations to cover");
			return [...entries, {
				type: "custom",
				id: "eval-seeded-bloated-checkpoint",
				parentId: entries.at(-1)?.id ?? null,
				timestamp: new Date().toISOString(),
				customType: OM_CHECKPOINT_RECORDED,
				data: {
					mode: "update",
					checkpoint: {
						id: "check_aaaaaaaaaaaa",
						content: bloatedCheckpoint,
						createdAt: new Date().toISOString(),
						contentFormat: "markdown",
					},
					coversUpToObservationId: coverageId,
					observationIds: [coverageId],
				},
			} as Entry];
		},
		grade: (result) => {
			if (!result?.content) return { passed: false, reason: "session replay prune did not produce a checkpoint", missing: ["checkpoint"] };
			const missing = includesAll(result.content, ["lifecycle prune replay anchor"]);
			const incorrect = [] as string[];
			if (result.latestCheckpointMode !== "prune") missing.push("latest checkpoint mode prune");
			if (result.latestObservationIds.length !== 0) incorrect.push("prune observation ids not empty");
			if (result.latestCoversUpToObservationId !== result.initialCheckpointCoverageObservationId) incorrect.push("prune advanced coverage");
			if (result.content.toLowerCase().includes("replay-noise replay-noise replay-noise replay-noise")) incorrect.push("replay-noise replay-noise replay-noise replay-noise");
			return {
				passed: missing.length === 0 && incorrect.length === 0,
				reason: missing.length === 0 && incorrect.length === 0 ? "session replay prune checks passed" : "session replay prune checks failed",
				missing,
				incorrect,
			};
		},
	});
}

function pruneEvalCases(): EvalCase[] {
	const activeDecisions = `# Checkpoint

## Current objective

Continue checkpoint lifecycle refactor.

## Progress and decisions

- Accepted: prune triggers use token budgets only.
- Accepted: unchanged prune emits no ledger event.
- Accepted: compaction tries normal checkpoint catch-up first.
- Low-value duplicate detail: remove-this remove-this remove-this remove-this.
- Low-value duplicate detail: remove-this remove-this remove-this remove-this.

## Important context

Preserve exact anchor \`src/memory-update/checkpoint-lifecycle.ts\`.
Preserve exact command \`pnpm typecheck && pnpm test -- --reporter=dot\`.

## Remaining work

Implement first-class prune lifecycle semantics.

## References and anchors

- \`src/memory-update/checkpoint-lifecycle.ts\`
- \`checkpointPruneTargetTokens\`
`;
	const remainingWork = `# Checkpoint

## Current objective

Finish OM checkpoint memory cleanup.

## Progress and decisions

The prompt split is in progress.
Noise: earlier notes repeated repeated repeated repeated.
Noise: earlier notes repeated repeated repeated repeated.

## Important context

Keep deterministic mechanics in tests and model behavior in evals.

## Remaining work

- Add memory state module.
- Add observer recording module.
- Add checkpoint lifecycle module.
- Add token-budget prune triggers.

## References and anchors

- \`src/session-ledger/memory-state.ts\`
- \`src/memory-update/observer-recording.ts\`
`;
	const bloated = `# Checkpoint

## Current objective

Make checkpoint pruning reliable.

## Progress and decisions

Keep anchor \`checkpoint-prune-shrinks-bloated-checkpoint\`.
Duplicate filler alpha beta gamma alpha beta gamma alpha beta gamma.
Duplicate filler alpha beta gamma alpha beta gamma alpha beta gamma.
Duplicate filler alpha beta gamma alpha beta gamma alpha beta gamma.

## Important context

Prune may shrink or repair only.
Prune may shrink or repair only.
Prune may shrink or repair only.

## Remaining work

Preserve active anchors while removing duplicate detail.

## References and anchors

- \`checkpoint-prune-shrinks-bloated-checkpoint\`
`;
	return [
		editorPruneScenario({
			id: "checkpoint-prune-preserves-active-decisions",
			initialContent: activeDecisions,
			maxTurns: 8,
			grade: (result) => gradeContent(result, {
				requireChanged: true,
				requireAll: ["token budgets", "unchanged prune emits no ledger event", "normal checkpoint catch-up first", "src/memory-update/checkpoint-lifecycle.ts", "checkpointPruneTargetTokens"],
				forbidAny: ["remove-this remove-this remove-this remove-this"],
			}),
		}),
		editorPruneScenario({
			id: "checkpoint-prune-does-not-add-new-facts",
			initialContent: EMPTY_CHECKPOINT_MARKDOWN.replace("None known.", "Prune only existing checkpoint facts."),
			maxTurns: 8,
			grade: (result) => gradeContent(result, {
				requireUnchanged: true,
				requireAll: ["Prune only existing checkpoint facts"],
				forbidAny: ["pnpm typecheck", "openai-codex", "/home/syzom", "session replay", "ObserverRecordPlanner"],
			}),
		}),
		editorPruneScenario({
			id: "checkpoint-prune-preserves-remaining-work",
			initialContent: remainingWork,
			maxTurns: 8,
			grade: (result) => gradeContent(result, {
				requireChanged: true,
				requireAll: ["memory state", "observer recording", "checkpoint lifecycle", "token-budget prune", "src/session-ledger/memory-state.ts", "src/memory-update/observer-recording.ts"],
				forbidAny: ["repeated repeated repeated repeated"],
			}),
		}),
		editorPruneScenario({
			id: "checkpoint-prune-shrinks-bloated-checkpoint",
			initialContent: bloated,
			maxTurns: 8,
			grade: (result) => gradeContent(result, {
				requireChanged: true,
				requireAll: ["checkpoint-prune-shrinks-bloated-checkpoint", "Preserve active anchors"],
				forbidAny: ["alpha beta gamma alpha beta gamma alpha beta gamma"],
				shorterThan: bloated,
			}),
		}),
	];
}

export function loadCheckpointEvalCases(): EvalCase[] {
	return [
		{
			id: "checkpoint-preserves-operational-anchors",
			purpose: "update",
			initialContent: EMPTY_CHECKPOINT_MARKDOWN,
			observationsText: [
				"Observation 1:",
				"Current task is migrating OM to checkpoint memory in /home/syzom/projects/pi-extensions/pi-observational-memory. Validation passed with `pnpm typecheck && pnpm test -- --reporter=dot`, 14 test files and 85 tests passed.",
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
				"The old apiMode=legacy statement is stale. Current API mode is apiMode=streaming, and legacy must not guide implementation.",
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
				"Reminder: checkpoint updates should preserve exact commands, paths, ids, blockers, and stale/current transitions.",
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
		...pruneEvalCases(),
		realSessionWideContextCase(),
		realSessionReplayCase(),
		checkpointPruneReplayCase(),
	];
}
