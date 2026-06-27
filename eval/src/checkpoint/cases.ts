import { EMPTY_CHECKPOINT_MARKDOWN } from "../../../src/memory/checkpoint.js";
import { CHECKPOINT_MARKDOWN_HEADINGS, isValidCheckpointMarkdown } from "../../../src/memory/checkpoint-format.js";
import { estimateStringTokens } from "../../../src/memory/token-estimate.js";
import { OM_CHECKPOINT_RECORDED, OM_OBSERVATIONS_RECORDED, foldLedger, type Entry } from "../../../src/session-ledger/index.js";
import { gradeContent, includesAll } from "./grading.js";
import { DEFAULT_REAL_SESSION_PATH, loadCheckpointUpdateFixture, loadLatestCheckpointFromSession } from "./session-fixture.js";
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
		grade: (result) => {
			if (!result) return { passed: false, reason: "checkpoint editor did not finish", missing: ["finish_checkpoint_edit"] };
			const missing = [
				...requiredHandoffHeadingProblems(result.content),
				...includesAll(result.content, [
					"019efee5-f8da-7fe4-a4a8-91009462be14",
					"/home/syzom/.pi/agent/sessions/--home-syzom-.pi-agent--/2026-06-25T13-09-04-858Z_019efee5-f8da-7fe4-a4a8-91009462be14.jsonl",
				]),
			];
			const incorrect: string[] = [];
			if (!result.changed) missing.push("changed checkpoint");
			if (!isValidCheckpointMarkdown(result.content)) incorrect.push("valid handoff checkpoint");
			return {
				passed: missing.length === 0 && incorrect.length === 0,
				reason: missing.length === 0 && incorrect.length === 0 ? "real session update checks passed" : "real session update checks failed",
				missing,
				incorrect,
			};
		},
	};
}

function gradeSessionReplay(result: SessionReplayResult | undefined) {
	if (!result?.content) return { passed: false, reason: "session replay did not produce a checkpoint", missing: ["checkpoint"] };
	const missing: string[] = [];
	const incorrect: string[] = [];
	const appendedTypes = new Set(result.appendedEntries.map((entry) => entry.customType));
	if (!appendedTypes.has(OM_OBSERVATIONS_RECORDED)) missing.push(OM_OBSERVATIONS_RECORDED);
	if (!appendedTypes.has(OM_CHECKPOINT_RECORDED)) missing.push(OM_CHECKPOINT_RECORDED);
	if (result.finalEntryCount <= result.initialEntryCount) missing.push("appended entries");
	if (result.uncheckpointedObservationCount !== 0) missing.push("checkpoint coverage for all replayed observations");
	if (!isValidCheckpointMarkdown(result.content)) incorrect.push("valid handoff checkpoint");
	return {
		passed: missing.length === 0 && incorrect.length === 0,
		reason: missing.length === 0 && incorrect.length === 0 ? "session replay checks passed" : "session replay checks failed",
		missing,
		incorrect,
	};
}

function realSessionReplayCase(): EvalCase {
	return {
		kind: "session-replay",
		id: "checkpoint-e2e-replays-session-slice",
		sessionPath: DEFAULT_REAL_SESSION_PATH,
		throughEntryId: "74df84d1",
		maxTurns: 8,
		runtimeConfig: {
			checkpointUpdateEveryObservations: 1,
		},
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

function shrinkPercent(initial: string, content: string): number {
	if (initial.length === 0) return 0;
	return Math.round(((initial.length - content.length) / initial.length) * 10_000) / 100;
}

function clearShrinkMissing(initial: string, content: string, minimumPercent = 10): string[] {
	return shrinkPercent(initial, content) >= minimumPercent ? [] : [`shrink >= ${minimumPercent}%`];
}

function missingPattern(content: string, label: string, pattern: RegExp): string[] {
	return pattern.test(content) ? [] : [label];
}

function requiredHandoffHeadingProblems(content: string): string[] {
	return includesAll(content, [...CHECKPOINT_MARKDOWN_HEADINGS]).map((heading) => `missing heading ${heading}`);
}

function largeSyntheticCheckpoint(): string {
	const duplicateJunk = Array.from({ length: 70 }, (_, index) => `- SYNTHETIC_REMOVE_DUPLICATE ${index}: repeated stale implementation note with no active decision. duplicate-junk duplicate-junk duplicate-junk duplicate-junk.`);
	const similarFacts = Array.from({ length: 45 }, (_, index) => `- Similar historical note ${index}: checkpoint pruning discussion variant ${index % 9} was considered, but it is not an active decision unless tied to a keep anchor.`);
	const staleBloat = Array.from({ length: 60 }, (_, index) => `- SYNTHETIC_REMOVE_STALE ${index}: obsolete temporary trace detail from an earlier debugging pass. stale-noise stale-noise stale-noise stale-noise.`);
	const noise = Array.from({ length: 45 }, (_, index) => `- SYNTHETIC_REMOVE_NOISE ${index}: raw scratchpad wording that does not affect the next action. low-value low-value low-value low-value.`);
	return `# Handoff

## Focus

Diagnose large checkpoint prune latency without losing handoff-critical facts.

## State

- SYNTHETIC_KEEP_DECISION_ALPHA: accepted that large prune diagnostics now run only the no-guidance baseline variant.
- Accepted: latency is diagnostic-only until baseline data exists.
- Accepted: synthetic and real-latest fixtures both run once in the normal checkpoint eval set.
- SYNTHETIC_KEEP_BLOCKER: compaction-pressure must not block indefinitely on hard-max CheckpointEditor prune.
${duplicateJunk.join("\n")}
${similarFacts.join("\n")}
${staleBloat.join("\n")}

## Next

- SYNTHETIC_KEEP_NEXT_STEP: add request diagnostics, edit failure reason counts, and a compact prune diagnostic table.
${noise.join("\n")}

## References

- SYNTHETIC_KEEP_PATH: keep exact anchor \`src/agents/checkpoint-editor/agent.ts\`.
- SYNTHETIC_KEEP_COMMAND: keep exact command \`pnpm checkpoint-evals -- --case checkpoint-prune-large-synthetic-baseline\`.
- \`src/agents/common.ts\`
- \`eval/src/checkpoint/cases.ts\`
- \`checkpoint-prune-real-latest-baseline\`
`;
}

type PruneGuidanceVariant = {
	suffix: string;
	promptVariant: string;
	pruneSizeGuidance?: string;
};

const PRUNE_GUIDANCE_VARIANTS: PruneGuidanceVariant[] = [
	{ suffix: "baseline", promptVariant: "none" },
];

function largePruneDiagnosticCases(): EvalCase[] {
	const synthetic = largeSyntheticCheckpoint();
	const latest = loadLatestCheckpointFromSession(DEFAULT_REAL_SESSION_PATH);
	const syntheticCases = PRUNE_GUIDANCE_VARIANTS.map((variant) => editorPruneScenario({
		id: `checkpoint-prune-large-synthetic-${variant.suffix}`,
		initialContent: synthetic,
		maxTurns: 10,
		pruneSizeGuidance: variant.pruneSizeGuidance,
		metadata: {
			pruneDiagnostic: true,
			fixtureType: "synthetic",
			promptVariant: variant.promptVariant,
			initialChars: synthetic.length,
			initialTokenEstimate: estimateStringTokens(synthetic),
		},
		grade: (result) => {
			if (!result) return { passed: false, reason: "checkpoint editor did not finish", missing: ["finish_checkpoint_edit"] };
			const missing = [
				...includesAll(result.content, [
					"src/agents/checkpoint-editor/agent.ts",
					"pnpm checkpoint-evals -- --case checkpoint-prune-large-synthetic-baseline",
				]),
				...missingPattern(result.content, "no-guidance baseline variant", /no[- ]guidance|baseline/i),
				...missingPattern(result.content, "compaction pressure must not block", /compaction[- ]pressure[\s\S]*(must not block|not block|non[- ]blocking|timeout|fallback)/i),
				...missingPattern(result.content, "request diagnostics", /request diagnostics/i),
				...missingPattern(result.content, "edit failure reason diagnostics", /edit[- ]failure|edit failure|failure reason/i),
				...missingPattern(result.content, "prune diagnostic table", /diagnostic table|prune diagnostics/i),
			];
			missing.push(...clearShrinkMissing(synthetic, result.content));
			const incorrect = requiredHandoffHeadingProblems(result.content);
			if (!isValidCheckpointMarkdown(result.content)) incorrect.push("invalid checkpoint markdown");
			for (const term of ["SYNTHETIC_REMOVE_DUPLICATE", "SYNTHETIC_REMOVE_STALE", "SYNTHETIC_REMOVE_NOISE"]) {
				if (result.content.includes(term)) incorrect.push(term);
			}
			return {
				passed: missing.length === 0 && incorrect.length === 0,
				reason: missing.length === 0 && incorrect.length === 0 ? "large synthetic prune checks passed" : "large synthetic prune checks failed",
				missing,
				incorrect,
			};
		},
	}));
	const realCases = PRUNE_GUIDANCE_VARIANTS.map((variant) => editorPruneScenario({
		id: `checkpoint-prune-real-latest-${variant.suffix}`,
		initialContent: latest.checkpoint.content,
		maxTurns: 10,
		pruneSizeGuidance: variant.pruneSizeGuidance,
		metadata: {
			pruneDiagnostic: true,
			fixtureType: "real-latest",
			promptVariant: variant.promptVariant,
			sessionPath: DEFAULT_REAL_SESSION_PATH,
			checkpointEntryId: latest.entryId,
			checkpointId: latest.checkpoint.id,
			initialChars: latest.checkpoint.content.length,
			initialTokenEstimate: estimateStringTokens(latest.checkpoint.content),
		},
		grade: (result) => {
			if (!result) return { passed: false, reason: "checkpoint editor did not finish", missing: ["finish_checkpoint_edit"] };
			const missing = clearShrinkMissing(latest.checkpoint.content, result.content);
			const incorrect: string[] = [];
			if (!isValidCheckpointMarkdown(result.content)) incorrect.push("invalid checkpoint markdown");
			return {
				passed: missing.length === 0 && incorrect.length === 0,
				reason: missing.length === 0 && incorrect.length === 0 ? "real latest prune checks passed" : "real latest prune checks failed",
				missing,
				incorrect,
			};
		},
	}));
	return [...syntheticCases, ...realCases];
}

function pruneEvalCases(): EvalCase[] {
	const activeDecisions = `# Handoff

## Focus

Continue checkpoint lifecycle refactor.

## State

- Accepted: prune triggers use token budgets only.
- Accepted: unchanged prune emits no ledger event.
- Accepted: compaction tries normal checkpoint catch-up first.
- Low-value duplicate detail: remove-this remove-this remove-this remove-this.
- Low-value duplicate detail: remove-this remove-this remove-this remove-this.

## Next

Implement first-class prune lifecycle semantics.

## References

- Preserve exact anchor \`src/memory-update/checkpoint-lifecycle.ts\`.
- Preserve exact command \`pnpm typecheck && pnpm test -- --reporter=dot\`.
- \`checkpointPruneTargetTokens\`
`;
	const remainingWork = `# Handoff

## Focus

Finish OM checkpoint memory cleanup.

## State

The prompt split is in progress.
Keep deterministic mechanics in tests and model behavior in evals.
Noise: earlier notes repeated repeated repeated repeated.
Noise: earlier notes repeated repeated repeated repeated.

## Next

- Add memory state module.
- Add observer recording module.
- Add checkpoint lifecycle module.
- Add token-budget prune triggers.

## References

- \`src/session-ledger/memory-state.ts\`
- \`src/memory-update/observer-recording.ts\`
`;
	const bloated = `# Handoff

## Focus

Make checkpoint pruning reliable.

## State

Keep anchor \`checkpoint-prune-shrinks-bloated-checkpoint\`.
Prune may shrink or repair only.
Prune may shrink or repair only.
Prune may shrink or repair only.
Duplicate filler alpha beta gamma alpha beta gamma alpha beta gamma.
Duplicate filler alpha beta gamma alpha beta gamma alpha beta gamma.
Duplicate filler alpha beta gamma alpha beta gamma alpha beta gamma.

## Next

Preserve active anchors while removing duplicate detail.

## References

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
				requireAll: ["apiMode=streaming", "legacy"],
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
			initialContent: `# Handoff

## Focus

Continue OM checkpoint migration.

## State

- Keep exact anchor \`src/agents/checkpoint-editor/prompts.ts\`.
- Checkpoint pruning must preserve active decisions and anchors.
- Duplicated low-value detail: repeat-me repeat-me repeat-me repeat-me.
- Duplicated low-value detail: repeat-me repeat-me repeat-me repeat-me.

## Next

Keep checkpoint concise.

## References

- \`src/agents/checkpoint-editor/prompts.ts\`
`,
			observationsText: "None.",
			maxTurns: 8,
			grade: (result) => gradeContent(result, {
				requireChanged: true,
				requireAll: ["src/agents/checkpoint-editor/prompts.ts", "active decisions", "anchors"],
				forbidAny: ["repeat-me repeat-me repeat-me repeat-me"],
			}),
		},
		...pruneEvalCases(),
		...largePruneDiagnosticCases(),
		realSessionWideContextCase(),
		realSessionReplayCase(),
		checkpointPruneReplayCase(),
	];
}
