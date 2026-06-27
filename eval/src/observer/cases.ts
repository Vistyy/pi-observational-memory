import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Observation } from "../../../src/session-ledger/index.js";
import {
	gradeObserverOutput,
	observerForbidsAny,
	observerForbidsSourceIds,
	observerMaxCount,
	observerRequiresAll,
	observerSourceIdsAllowed,
	optional,
} from "./grading.js";
import { runObserverEval } from "./runner.js";
import type { ObserverEvalCase, ObserverEvalRecord, ObserverGrader } from "./types.js";
import { realObserver32 } from "./fixtures/real-session-fixtures.js";
import { realObserver64 as realObserver64v2 } from "./fixtures/real-session-fixtures-v2.js";

type ObserverFixture = {
	readonly count: number;
	readonly chunk: string;
	readonly allowedSourceEntryIds: readonly string[];
};

async function gradeObserver(args: {
	id: string;
	model: string;
	thinking: ModelThinkingLevel;
	iteration: number;
	chunk: string;
	allowedSourceEntryIds: readonly string[];
	graders: ObserverGrader[];
	diagnostics?: Record<string, unknown>;
}): Promise<ObserverEvalRecord> {
	const started = Date.now();
	const { output, usage, agentDurationMs, error } = await runObserverEval({
		id: args.id,
		model: args.model,
		thinking: args.thinking,
		chunk: args.chunk,
		allowedSourceEntryIds: [...args.allowedSourceEntryIds],
		iteration: args.iteration,
	});
	return gradeObserverOutput({
		id: args.id,
		iteration: args.iteration,
		output,
		started,
		agentDurationMs,
		usage,
		graders: args.graders,
		diagnostics: { ...args.diagnostics, chunk: args.chunk },
		error,
	});
}

function observerToolEvidenceBoundary(args: { model: string; thinking: ModelThinkingLevel; iteration: number }): Promise<ObserverEvalRecord> {
	const chunk = [
		"[Source entry id: user-tool-a] [User @ 2026-06-11 20:00]: Current route: src/app/api/[org]/route.ts for org-scoped endpoints.",
		"[Source entry id: tool-tool-b]\n[Tool evidence: bash @ 2026-06-11 20:01]\nstatus: error\ninput: pnpm test tests/api-org.test.ts\nexitCode: 1\noutput_omitted: false\nexcerpt:\nFAIL tests/api-org.test.ts > org-scoped > missing header\nExpected 401\nReceived 200",
		"[Source entry id: user-tool-e] [User @ 2026-06-11 20:04]: Use JWT not session. Add org-id claim. Keep the test blocked until the header is served.",
		"[Source entry id: user-success-a] [User @ 2026-06-11 23:00]: The db helper module is exported as `createDbClient` from src/db/client.ts and takes options `{ url, maxRetries, logQueries }`.",
		"[Source entry id: tool-success-b]\n[Tool evidence: bash @ 2026-06-11 23:01]\nstatus: ok\ninput: pnpm test tests/db-client.test.ts\nexitCode: 0\noutput_omitted: false\nexcerpt:\nPASS tests/db-client.test.ts > createDbClient defaults maxRetries to 3\nPASS tests/db-client.test.ts > createDbClient disables logQueries by default",
		"[Source entry id: tool-truncated-c]\n[Tool evidence: bash @ 2026-06-11 22:02]\nstatus: error\ninput: pnpm test tests/auth-refresh.test.ts\nexitCode: 1\noutput_omitted: true (length)\nexcerpt:\nRunning auth-refresh tests...\n… [truncated middle 80 lines]\nProcess exited with code 1",
		"[Source entry id: assistant-budget-d] [Assistant @ 2026-06-11 22:03]: I need to rerun auth with a larger excerpt before claiming the exact failure.",
	].join("\n\n");
	return gradeObserver({
		id: "observer-tool-evidence-boundary",
		model: args.model,
		thinking: args.thinking,
		iteration: args.iteration,
		chunk,
		allowedSourceEntryIds: ["user-tool-a", "tool-tool-b", "user-tool-e", "user-success-a", "tool-success-b", "tool-truncated-c", "assistant-budget-d"],
		graders: [
			observerForbidsAny("output_omitted", "payload: omitted", "Attempted tool call"),
			observerForbidsAny("A read was run", "read was run", "route file was read"),
			optional(observerRequiresAll("tests/api-org.test.ts", "401", "200")),
			optional(observerRequiresAll("JWT", "org-id")),
			optional(observerRequiresAll("createDbClient", "src/db/client.ts")),
			optional(observerRequiresAll("maxRetries", "3", "logQueries")),
			optional(observerMaxCount(8)),
		],
	});
}

function observerHiddenMutationPayloadBoundary(args: { model: string; thinking: ModelThinkingLevel; iteration: number }): Promise<ObserverEvalRecord> {
	const chunk = "[Source entry id: user-hidden-edit] [User @ 2026-06-11 21:00]: Update the default reflector thinking setting in the config.";
	return gradeObserver({
		id: "observer-hidden-mutation-payload-boundary",
		model: args.model,
		thinking: args.thinking,
		iteration: args.iteration,
		chunk,
		allowedSourceEntryIds: ["user-hidden-edit"],
		graders: [
			observerSourceIdsAllowed(["user-hidden-edit"]),
			observerForbidsAny("xhigh", "low", "reflectorThinking changed", "now defaults", "edit succeeded", "tool reported success"),
			optional(observerRequiresAll("default reflector thinking")),
			optional(observerMaxCount(3)),
		],
	});
}

function observerHiddenMutationReplacementEvidence(args: { model: string; thinking: ModelThinkingLevel; iteration: number }): Promise<ObserverEvalRecord> {
	const chunk = [
		"[Source entry id: user-repl-a] [User @ 2026-06-16 10:00]: Change the OM default reflector thinking from `xhigh` to `low`; update `src/config.ts`, `tests/config.test.ts`, and `README.md` if needed.",
		"[Source entry id: assistant-repl-summary] [Assistant @ 2026-06-16 10:04]: Implemented the reflector thinking default change: `src/config.ts` now sets `reflectorThinking` to `low`, `tests/config.test.ts` expects `reflectorThinking: \"low\"`, and `README.md` documents the new default. The old `xhigh` default is no longer current.",
		"[Source entry id: tool-repl-validation]\n[Tool evidence: bash @ 2026-06-16 10:06]\nstatus: ok\ninput: cd extensions/pi-observational-memory && pnpm run typecheck && pnpm test\nexitCode: 0\noutput_omitted: false\nexcerpt:\n> tsc --noEmit\nPASS tests/config.test.ts > DEFAULTS uses reflectorThinking low\nTest Files 18 passed (18)\nTests 115 passed (115)",
		"[Source entry id: assistant-repl-noise] [Assistant @ 2026-06-16 10:07]: I can inspect the remaining files later if we decide to polish docs wording further.",
	].join("\n\n");
	const allowed = ["user-repl-a", "assistant-repl-summary", "tool-repl-validation", "assistant-repl-noise"];
	return gradeObserver({
		id: "observer-hidden-mutation-replacement-evidence",
		model: args.model,
		thinking: args.thinking,
		iteration: args.iteration,
		chunk,
		allowedSourceEntryIds: allowed,
		graders: [
			observerSourceIdsAllowed(allowed),
			observerForbidsAny("payload: omitted means", "from hidden edit payload", "edit succeeded", "tool reported success", "inspect the remaining files later", "polish docs wording"),
			observerRequiresAll("reflectorThinking", "low"),
			observerRequiresAll("src/config.ts", "tests/config.test.ts", "README.md"),
			observerRequiresAll("pnpm run typecheck", "pnpm test"),
			optional(observerRequiresAll("xhigh")),
			optional(observerMaxCount(5)),
		],
	});
}

function observerAssistantProseBoundary(args: { model: string; thinking: ModelThinkingLevel; iteration: number }): Promise<ObserverEvalRecord> {
	const chunk = [
		"[Source entry id: user-prose-focus] [User @ 2026-06-16 11:00]: For the next OM work, focus observer only. Do not implement recall or e2e evals now.",
		"[Source entry id: assistant-prose-brainstorm] [Assistant @ 2026-06-16 11:01]: Maybe later we could rewrite the whole harness, bring recall/e2e back as stress tests, and mine every old session for more cases.",
		"[Source entry id: assistant-prose-procedure] [Assistant @ 2026-06-16 11:02]: I’ll inspect the files and run ripgrep before deciding what to edit.",
		"[Source entry id: assistant-prose-summary] [Assistant @ 2026-06-16 11:10]: Current observer serializer behavior: metadata-only successful `toolResult` entries are skipped, assistant `toolCall` blocks are dropped from observer input, and hidden edit/write payloads are not semantic observer evidence.",
		"[Source entry id: tool-prose-validation]\n[Tool evidence: bash @ 2026-06-16 11:12]\nstatus: ok\ninput: cd eval && pnpm exec tsc --noEmit && cd ../extensions/pi-observational-memory && pnpm run typecheck && pnpm test\nexitCode: 0\noutput_omitted: false\nexcerpt:\n> pi-observational-memory@0.0.0-local typecheck\nTest Files 18 passed (18)\nTests 115 passed (115)",
		"[Source entry id: user-prose-correction] [User @ 2026-06-16 11:15]: Fork/assistant long prose dominating observer input is intentional. Do not trim that just to reduce tokens.",
		"[Source entry id: assistant-prose-ack] [Assistant @ 2026-06-16 11:16]: Sounds good, I’ll proceed.",
	].join("\n\n");
	const allowed = ["user-prose-focus", "assistant-prose-brainstorm", "assistant-prose-procedure", "assistant-prose-summary", "tool-prose-validation", "user-prose-correction", "assistant-prose-ack"];
	return gradeObserver({
		id: "observer-assistant-prose-boundary",
		model: args.model,
		thinking: args.thinking,
		iteration: args.iteration,
		chunk,
		allowedSourceEntryIds: allowed,
		graders: [
			observerSourceIdsAllowed(allowed),
			observerForbidsSourceIds("assistant-prose-brainstorm", "assistant-prose-procedure", "assistant-prose-ack"),
			observerForbidsAny("rewrite the whole harness", "recall/e2e back as stress tests", "mine every old session", "run ripgrep", "Sounds good", "I’ll proceed"),
			observerRequiresAll("observer", "only"),
			observerRequiresAll("metadata-only", "toolResult"),
			observerRequiresAll("toolCall", "drop"),
			observerRequiresAll("18", "115", "passed"),
			observerRequiresAll("long prose", "intentional"),
			optional(observerMaxCount(6)),
		],
	});
}

async function realObserver(id: string, fixture: ObserverFixture, args: { model: string; thinking: ModelThinkingLevel; iteration: number }, checks: ReturnType<typeof observerRequiresAll>[]): Promise<ObserverEvalRecord> {
	return gradeObserver({
		id,
		model: args.model,
		thinking: args.thinking,
		iteration: args.iteration,
		chunk: fixture.chunk,
		allowedSourceEntryIds: fixture.allowedSourceEntryIds,
		graders: [
			observerSourceIdsAllowed([...fixture.allowedSourceEntryIds]),
			observerForbidsAny("output omitted by observer policy", "Successfully replaced", "Successfully wrote", "Attempted tool call", "payload: omitted"),
			...checks.map(optional),
		],
		diagnostics: { sourceEntryCount: fixture.count },
	});
}

const cases: ObserverEvalCase[] = [
	{ id: "observer-tool-evidence-boundary", suite: "baseline", run: observerToolEvidenceBoundary },
	{ id: "observer-hidden-mutation-payload-boundary", suite: "baseline", run: observerHiddenMutationPayloadBoundary },
	{ id: "observer-hidden-mutation-replacement-evidence", suite: "baseline", run: observerHiddenMutationReplacementEvidence },
	{ id: "observer-assistant-prose-boundary", suite: "baseline", run: observerAssistantProseBoundary },
	{
		id: "observer-real-giga-32",
		suite: "baseline",
		run: (args) => realObserver("observer-real-giga-32", realObserver32, args, [
			observerRequiresAll("docs/ARCHITECTURE_FINDINGS.md", "docs/future-work.md"),
			observerRequiresAll("80", "observations", "cap"),
			observerRequiresAll("recall", "eval"),
			observerRequiresAll("mutable factual claims", "verify"),
		]),
	},
	{
		id: "observer-real-giga-64-v2",
		suite: "baseline",
		run: (args) => realObserver("observer-real-giga-64-v2", realObserver64v2, args, [
			observerRequiresAll("supportingObservationIds", "mechanically"),
			observerRequiresAll("613", "178"),
			observerRequiresAll("thinking", "xhigh"),
		]),
	},
];

export function loadObserverEvalCases(): ObserverEvalCase[] {
	return cases;
}
